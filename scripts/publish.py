#!/usr/bin/env python3
"""예약 세션용 발행 묶음 — 도구 호출을 줄이려고 수집·확인·렌더·커밋을 한 번에.

  python scripts/publish.py prepare morning|evening|refresh   수집 → 확인 → 요약용 다이제스트 출력
  python scripts/publish.py finish  morning|evening|refresh   summary.json 병합·검증·렌더 → 경고 출력 → 커밋·푸시

prepare 출력의 첫 줄이 'STOP:' 이면 게시하지 말고 그 이유만 보고, 'SKIP:' 이면 아무것도 하지 않고 끝.
refresh 는 다이제스트 없이 바로 렌더까지 하고, 요약에 없는 새 종목이 있을 때만 그 종목 후보를 출력한다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from paper import summarizer  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
MARKETS = ("korea_market", "us_market", "indicators")
RULES = """[규칙] 데이터(아래 다이제스트)에 없는 사실·숫자·원인 금지. 투자 권유·추천·목표가 금지. 기사체(~했다).
[규칙] change·change_pct 가 없으면(-) 변동 언급 금지. 국내 수치는 기준 거래일을 밝힌다. 영문 기사는 한국어로.
[규칙] ⚠의심 표시 수치는 머리기사·핵심 3줄에 쓰지 말고 보고에만. 찌라시는 '~라는 보도/~설'로, 단정 금지.
[규칙] summary.json: {"headline":{"title","body"},"news":[{"id","summary"}]x3,"holdings":[{"key","news":[{"id","summary"}]<=3,"filings":[{"id","points":[2~3줄]}],"rumors":[{"id","summary","status"}]<=3}],"rumors":[{"id","summary","status"}]<=5,"key_points":[3개, 60자 이내]}
[규칙] status: 미확인 | 회사 부인 | 회사 확인·검토 중 | 사실로 확인. '재사용'으로 표시된 공시 points 는 finish 가 자동으로 채우니 쓰지 말 것."""


class Paths:
    def __init__(self, out: Path, issue: dt.date):
        self.out, self.issue = out, issue
        self.data = out / "data"
        self.bundle = self.data / f"{issue}.json"
        self.summary = self.data / f"{issue}.summary.json"
        self.morning = self.data / f"{issue}.morning.json"
        self.reuse = self.data / f"{issue}.reuse.json"
        self.holdings = self.data / "holdings.json"


def load(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def cut(s, n: int) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def num(v, d=2) -> str:
    return "-" if v is None else f"{v:,.{d}f}"


def archive_dates(out: Path) -> str:
    return ",".join(sorted(p.stem for p in out.glob("20*.html")))


def git(*args, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=check, text=True, capture_output=True)


def run_main(args: list[str], opts) -> tuple[int, str]:
    cmd = [sys.executable, str(ROOT / "main.py"), "--date", opts.issue.isoformat(), "--out", str(opts.out), *args]
    if opts.sample:
        cmd.append("--sample")
    p = subprocess.run(cmd, text=True, capture_output=True)
    return p.returncode, p.stdout + p.stderr


def holding_ids(items) -> list[str]:
    return sorted(str(h.get("id") or h.get("db_id") or "") for h in items or [])


# ── 지난 호 공시 요약 재사용 ─────────────────────────────────────
def filing_key(f: dict) -> str:
    return f.get("rcept_no") or f.get("url") or f"{f.get('date')}|{f.get('title')}"


def build_reuse_map(p: Paths, days: int = 10) -> dict:
    """지난 호(오늘 이미 쓴 것 포함)의 내 종목 공시 points 를 공시 번호로 모은다 → {"<종목키>|<공시키>": points}."""
    out = {}
    for i in range(days, -1, -1):          # 오래된 것부터 → 최신 것이 덮어씀
        day = p.issue - dt.timedelta(days=i)
        b, s = load(p.data / f"{day}.json"), load(p.data / f"{day}.summary.json")
        if not (b and s):
            continue
        by_id = {}
        for h in (b["results"].get("holdings") or {}).get("items") or []:
            for f in h.get("filings") or []:
                by_id[f["id"]] = f"{h['key']}|{filing_key(f)}"
        for hs in s.get("holdings") or []:
            for f in hs.get("filings") or []:
                if f.get("points") and f.get("id") in by_id:
                    out[by_id[f["id"]]] = f["points"]
    return out


def reusable_today(bundle: dict, reuse: dict) -> dict:
    """오늘 공시 id → 재사용할 points."""
    out = {}
    for h in (bundle["results"].get("holdings") or {}).get("items") or []:
        for f in h.get("filings") or []:
            pts = reuse.get(f"{h['key']}|{filing_key(f)}")
            if pts:
                out[f["id"]] = pts
    return out


def merge_reused(summary: dict, bundle: dict, reuse_ids: dict) -> int:
    """summary.json 의 내 종목 공시에 재사용 points 를 채운다(이미 쓴 것은 그대로). 채운 개수 반환."""
    n = 0
    keys = {h["key"]: h for h in (bundle["results"].get("holdings") or {}).get("items") or []}
    rows = {hs.get("key"): hs for hs in summary.setdefault("holdings", [])}
    for key, h in keys.items():
        todo = [f["id"] for f in h.get("filings") or [] if f["id"] in reuse_ids]
        if not todo:
            continue
        hs = rows.get(key)
        if hs is None:
            hs = rows[key] = {"key": key, "news": [], "filings": [], "rumors": []}
            summary["holdings"].append(hs)
        have = {f.get("id") for f in hs.setdefault("filings", []) if f.get("points")}
        for fid in todo:
            if fid not in have:
                hs["filings"].append({"id": fid, "points": reuse_ids[fid]})
                n += 1
        hs.setdefault("news", []); hs.setdefault("rumors", [])
    return n


# ── 다이제스트 ─────────────────────────────────────────────────
def suspicious(payload: dict) -> dict[str, str]:
    """같은 묶음 대비 유독 큰 변동(선물 월물 교체 등 의심) → {이름: 이유}."""
    flags = {}
    for sec in ("korea_market", "us_market", "indicators", "watchlist"):
        rows = [r for r in payload.get(sec) or [] if r.get("change_pct") is not None]
        for r in rows:
            others = sorted(abs(o["change_pct"]) for o in rows if o is not r)
            if not others:
                continue
            med = others[len(others) // 2]
            if abs(r["change_pct"]) >= 3 and abs(r["change_pct"]) >= 3 * max(med, 0.3):
                flags[r["name"]] = f"묶음 중앙값 {med:.2f}% 대비 {r['change_pct']:+.2f}%"
    ind = {r["name"]: r for r in payload.get("indicators") or []}
    for a, b in (("WTI 유가", "브렌트유"),):
        x, y = (ind.get(a) or {}).get("change_pct"), (ind.get(b) or {}).get("change_pct")
        if x is not None and y is not None and abs(x - y) >= 3:
            big = a if abs(x) > abs(y) else b
            flags[big] = f"{a} {x:+.2f}% vs {b} {y:+.2f}% — 같이 움직여야 할 지표가 엇갈림"
    return flags


def market_lines(payload: dict, flags: dict) -> list[str]:
    out = []
    for sec, label in (("korea_market", "국내"), ("us_market", "미국"), ("indicators", "지표"), ("watchlist", "관심")):
        for r in payload.get(sec) or []:
            ch = num(r.get("change_pct")) + "%" if r.get("change_pct") is not None else (
                f"{r['change']:+.3f}" if r.get("change") is not None else "-")
            mark = f"  ⚠의심: {flags[r['name']]}" if r["name"] in flags else ""
            out.append(f"{label} | {r['name']} | {num(r.get('value'))}{r.get('unit') or ''} | {ch} | {r.get('as_of') or '-'}{mark}")
    fl = payload.get("investor_flows")
    if fl:
        out.append("수급 | " + cut(json.dumps(fl, ensure_ascii=False), 300))
    return out


def article_line(a: dict, n: int = 80) -> str:
    when = (a.get("published") or a.get("date") or "")[5:16].replace("T", " ")
    return f"{a['id']} | {cut(a.get('source'), 14)} | {when} | {cut(a.get('title'), 70)} | {cut(a.get('description'), n)}"


def holding_block(h: dict, reuse_ids: dict) -> list[str]:
    pr = h.get("price") or {}
    out = [f"## {h['key']} {h['name']} | 시세 {num(pr.get('value'))} ({num(pr.get('change_pct'))}%) {pr.get('as_of') or ''}"]
    if (h.get("earnings") or {}).get("next"):
        out.append("다음 실적 | " + cut(json.dumps(h["earnings"]["next"], ensure_ascii=False), 160))
    if h.get("financials") and any(f["id"] not in reuse_ids for f in h.get("filings") or []):
        out.append("재무(원) | " + cut(json.dumps(h["financials"][-4:], ensure_ascii=False), 500))
    for a in (h.get("news") or [])[:8]:
        out.append("뉴스 " + article_line(a))
    for f in h.get("filings") or []:
        if f["id"] in reuse_ids:
            out.append(f"공시 {f['id']} | {f.get('date')} | {cut(f.get('title'), 50)} | 재사용(쓰지 말 것)")
        else:
            out.append(f"공시 {f['id']} | {f.get('date')} | {cut(f.get('title'), 50)} | {cut(f.get('detail'), 300) or '본문 없음 → 빼기'}")
    for r in h.get("rumors") or []:
        out.append(f"찌라시 {r['id']} | {r.get('date')} | {cut(r.get('headline') or r.get('title'), 70)} | "
                   f"{cut(r.get('media') or r.get('source'), 12)} | {cut(r.get('detail'), 200)}")
    return out


def digest(payload: dict, reuse_ids: dict, mode: str, only_keys: set | None = None) -> str:
    ms = payload["market_status"]
    lines = [RULES, "",
             f"# {mode} {payload['issue_date']} | 국내 기준 거래일 {ms.get('last_session_label') or ms.get('last_session')}"
             f" | 오늘 휴장={ms.get('today_closed')}({ms.get('today_reason') or '-'})"]
    if only_keys is None:
        flags = suspicious(payload)
        lines += ["", "# 시장 (구분 | 이름 | 값 | 등락 | 기준)", *market_lines(payload, flags)]
        if payload.get("calendar"):
            lines += ["", "# 일정", *[f"{e.get('date')} {e.get('time') or ''} {e.get('region') or ''} {cut(e.get('title'), 60)}"
                                    for e in payload["calendar"][:10]]]
        if payload.get("disclosures"):
            lines += ["", "# 주요 공시", *[f"{d.get('corp')} | {d.get('date')} | {cut(d.get('title'), 50)}"
                                       f"{' | 내 종목' if d.get('watch') else ''}" for d in payload["disclosures"]]]
        lines += ["", "# 뉴스 후보 (id | 출처 | 시각 | 제목 | 설명)", *[article_line(a) for a in payload.get("news", [])[:40]]]
    hs = [h for h in payload.get("holdings") or [] if only_keys is None or h["key"] in only_keys]
    if hs:
        lines += ["", "# 내 종목"]
        for h in hs:
            lines += holding_block(h, reuse_ids)
    if only_keys is None:
        rum = payload.get("rumors") or {}
        reps = sorted(rum.get("reports") or [], key=lambda r: bool(r.get("seen_before")))
        fils = sorted(rum.get("filings") or [], key=lambda f: (bool(f.get("seen_before")), bool(f.get("repost"))))
        lines += ["", "# 찌라시 후보 (지난 호 실림=seen 은 새 것이 모자랄 때만)"]
        for f in fils:
            lines.append(f"{f['rid']} | 해명공시 {f.get('corp')} {f.get('date')} | {cut(f.get('headline'), 70)} | "
                         f"{f.get('media') or '-'} 최초 {f.get('occurred') or '-'}{' | 재공시' if f.get('repost') else ''}"
                         f"{' | seen' if f.get('seen_before') else ''} | {cut(f.get('detail'), 200)}")
        for r in reps:
            lines.append(f"{r['rid']} | 보도 {cut(r.get('source'), 12)} {(r.get('published') or '')[5:16].replace('T', ' ')} | "
                         f"{cut(r.get('title'), 70)}{' | seen' if r.get('seen_before') else ''} | {cut(r.get('description'), 200)}")
    return "\n".join(lines)


def make_payload(bundle: dict, cfg: dict) -> dict:
    morning = bundle.get("morning") or {}
    status = (bundle.get("morning_status") or bundle["market_status"]) if morning else bundle["market_status"]
    return summarizer.build_payload({**bundle["results"], **morning}, status, bundle["issue_date"], cfg.get("summary", {}))


def q_cleanup(bundle: dict, p: Paths) -> list[str]:
    """Q- 로 들어온 종목 정리 안내 (ArtifactData 로 Claude 가 실행)."""
    local = {h.get("id"): h for h in load(p.holdings, []) or []}
    out = []
    for h in (bundle["results"].get("holdings") or {}).get("items") or []:
        if str(h.get("db_id") or "").startswith("Q-"):
            src = local.get(h["db_id"], {})
            doc = {"market": h["market"], "code": h["code"], "name": h["name"], "qty": src.get("qty"),
                   "avg": src.get("avg"), "added_at": src.get("added_at") or dt.datetime.now(KST).isoformat(timespec="seconds")}
            out.append(f"Q- 정리: set holdings/{h['key']} {json.dumps(doc, ensure_ascii=False)} ; delete holdings/{h['db_id']}")
    return out


def kospi_date(bundle: dict) -> str:
    for i in (bundle["results"].get("korea_market") or {}).get("items") or []:
        if i.get("name") == "코스피":
            return (i.get("as_of") or "")[:10]
    return ""


# ── prepare / finish ───────────────────────────────────────────
def prepare(mode: str, opts, cfg: dict, p: Paths) -> int:
    if opts.pull:
        git("pull", "-q", "origin", "main", check=False)
    holdings = load(p.holdings, [])
    if mode == "refresh":
        b = load(p.bundle)
        if b:
            at = dt.datetime.fromisoformat(b.get("holdings_at") or b.get("collected_at"))
            age = (dt.datetime.now(KST) - at).total_seconds() / 60
            if age < (cfg.get("app") or {}).get("refresh_after_min", 60) and holding_ids(holdings) == holding_ids(b.get("holdings")):
                print(f"SKIP: 이미 최신 ({age:.0f}분 전 갱신, 종목 목록 같음)")
                return 0
        else:
            print("오늘 호가 아직 없음 → 아침판처럼 다이제스트로 summary.json 을 쓰고 finish refresh")
            mode = "morning"

    reuse = build_reuse_map(p)
    today = opts.issue.isoformat()
    if mode == "morning":
        rc, log = run_main(["--collect-only"], opts)
    elif mode == "evening":
        if p.bundle.exists():
            shutil.copy(p.bundle, p.morning)
        rc, log = run_main(["--collect-only", "--live"], opts)
    else:
        rc, log = run_main(["--only", "korea_market,us_market,indicators,holdings", "--live",
                            "--archive", archive_dates(p.out)], opts)
    if rc != 0:
        print("STOP: 수집 실패\n" + log[-1500:])
        return 2
    bundle = load(p.bundle)
    res = bundle["results"]
    if mode != "refresh" and not any((res.get(k) or {}).get("ok") for k in MARKETS):
        print("STOP: 국내·미국·지표 수집이 모두 실패 — 게시하지 말 것\n" + "\n".join(
            f"{k}: {(res.get(k) or {}).get('error')}" for k in MARKETS))
        return 2

    want = today if mode == "evening" else bundle["market_status"].get("last_session")
    if mode in ("morning", "evening") and kospi_date(bundle) and kospi_date(bundle) < (want or ""):
        if not opts.sample:
            time.sleep(60)
        run_main(["--only", "korea_market"] + (["--live"] if mode == "evening" else []), opts)
        bundle = load(p.bundle)
        if mode == "evening" and kospi_date(bundle) != today:
            if p.morning.exists():
                shutil.move(p.morning, p.bundle)
            print(f"STOP: 코스피 기준일 {kospi_date(bundle) or '없음'} — 오늘({today}) 마감 수치가 없음(휴장·미수신). 게시하지 말 것")
            return 2
    if "429" in log:
        print("주의: Yahoo 429 — 일부 시세는 이전 값일 수 있음")

    reuse_ids = reusable_today(bundle, reuse)
    p.reuse.write_text(json.dumps(reuse_ids, ensure_ascii=False), encoding="utf-8")
    payload = make_payload(bundle, cfg)
    for line in q_cleanup(bundle, p):
        print(line)
    if mode == "refresh":
        summ = load(p.summary, {}) or {}
        have = {h.get("key") for h in summ.get("holdings") or []}
        new = {h["key"] for h in payload.get("holdings") or []} - have
        km = {i["name"]: i for i in res["korea_market"].get("items") or []}
        fx = {i["name"]: i for i in res["indicators"].get("items") or []}
        kos, usd = km.get("코스피") or {}, fx.get("원/달러 환율") or {}
        print(f"갱신됨: 코스피 {num(kos.get('value'))} ({num(kos.get('change_pct'))}%) · 원/달러 {num(usd.get('value'), 1)}")
        if new:
            print(f"새 종목 {len(new)}개 — summary.json holdings 에 추가 후 finish refresh")
            print(digest(payload, reuse_ids, mode, only_keys=new))
        else:
            print("새 종목 없음 → finish refresh")
        return 0
    print(digest(payload, reuse_ids, mode))
    return 0


def finish(mode: str, opts, cfg: dict, p: Paths) -> int:
    bundle = load(p.bundle)
    summ = load(p.summary)
    if bundle is None:
        print(f"오류: {p.bundle} 없음 — prepare 먼저"); return 2
    if summ is None and p.summary.exists():
        print(f"오류: {p.summary} 가 올바른 JSON 이 아님"); return 2
    if summ is not None:
        n = merge_reused(summ, bundle, load(p.reuse, {}) or {})
        if n:
            p.summary.write_text(json.dumps(summ, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"공시 points {n}개 재사용")
    rc, log = run_main(["--render-only", "--archive", archive_dates(p.out)], opts)
    warns = [l.split("요약 검증: ", 1)[1] for l in log.splitlines() if "요약 검증: " in l]
    if rc != 0:
        print("오류: 렌더 실패\n" + log[-1500:]); return 2
    print(f"렌더 완료: {p.out / 'artifact' / f'{opts.issue}.html'} | 요약 경고 {len(warns)}건")
    for w in warns:
        print("경고: " + w)
    if opts.check:
        return 0
    p.reuse.unlink(missing_ok=True)
    if mode == "evening":
        p.morning.unlink(missing_ok=True)
    if not opts.push:
        return 0
    label = {"morning": "아침판 발행", "evening": "오후판 발행", "refresh": "시세·내 종목 갱신"}[mode]
    msg = f"{opts.issue.month}/{opts.issue.day} {label}" + (f"\n\n{opts.trailer}" if opts.trailer else "")
    git("add", "-A")
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        print("커밋할 변경 없음"); return 0
    git("commit", "-q", "-m", msg)
    for wait in (0, 2, 4, 8, 16):
        time.sleep(wait)
        r = git("push", "-q", "origin", "HEAD:main", check=False)
        if r.returncode == 0:
            print("커밋·푸시 완료"); return 0
        if "rejected" in r.stderr:
            git("pull", "-q", "--rebase", "origin", "main", check=False)
    print("오류: 푸시 실패\n" + r.stderr[-500:])
    return 2


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=("prepare", "finish"))
    ap.add_argument("mode", choices=("morning", "evening", "refresh"))
    ap.add_argument("--date", help="발행일 (기본: 오늘 KST)")
    ap.add_argument("--out", help="출력 폴더 (기본: config output.dir)")
    ap.add_argument("--trailer", default="", help="커밋 메시지 끝에 붙일 줄 (공동 작성자 등)")
    ap.add_argument("--check", action="store_true", help="finish: 렌더·경고만, 커밋하지 않음")
    ap.add_argument("--no-pull", dest="pull", action="store_false")
    ap.add_argument("--no-push", dest="push", action="store_false")
    ap.add_argument("--sample", action="store_true", help=argparse.SUPPRESS)
    opts = ap.parse_args(argv)
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
    opts.issue = dt.date.fromisoformat(opts.date) if opts.date else dt.datetime.now(KST).date()
    opts.out = Path(opts.out) if opts.out else ROOT / cfg.get("output", {}).get("dir", "output")
    p = Paths(opts.out, opts.issue)
    return (prepare if opts.step == "prepare" else finish)(opts.mode, opts, cfg, p)


if __name__ == "__main__":
    sys.exit(main())
