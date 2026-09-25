#!/usr/bin/env python3
"""아침 증권 신문 발행기.

  python main.py                          오늘 신문: 수집 → 요약 → HTML
  python main.py --date 2026-09-25        특정 날짜 기준으로 발행
  python main.py --dry-run                파일을 쓰지 않고 결과만 콘솔에 출력
  python main.py --collect-only           수집 + 요약용 프롬프트 파일까지만 (세션 요약용 1단계)
  python main.py --render-only            저장된 수집 결과 + 요약 파일로 HTML 만 생성 (2단계)
  python main.py --sample                 네트워크 없이 샘플 응답으로 지면 미리보기 (견본 표시)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from collectors import REGISTRY, Context  # noqa: E402
from paper import render, summarizer  # noqa: E402
from paper.http import HttpClient  # noqa: E402
from paper.market_calendar import KrxCalendar  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger("main")


def load_env(path: Path) -> None:
    """python-dotenv 없이 .env 읽기 (이미 설정된 환경변수는 덮어쓰지 않음)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def setup_logging(cfg: dict, issue: dt.date, write_file: bool) -> None:
    level = getattr(logging, cfg.get("level", "INFO").upper(), logging.INFO)
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if write_file:
        d = ROOT / cfg.get("dir", "logs")
        d.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(d / f"{issue.isoformat()}.log", encoding="utf-8"))
    logging.basicConfig(level=level, handlers=handlers, force=True,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")


def collect(cfg: dict, ctx: Context, holdings: list | None = None) -> dict:
    results = {}
    for cid, ccfg in (cfg.get("collectors") or {}).items():
        if not (ccfg or {}).get("enabled", True):
            log.info("[%s] 꺼짐", cid)
            continue
        if cid not in REGISTRY:
            log.warning("[%s] 알 수 없는 수집기 — 건너뜀", cid)
            continue
        log.info("[%s] 수집 시작", cid)
        news_res = results.get("news") or {}
        pool = (news_res.get("data") or {}).get("pool") or news_res.get("items") or []
        if cid == "disclosures":   # 내 종목 공시를 우선 보여 주기 위해 목록을 함께 넘김
            ccfg = {**ccfg, "watchlist": [{"code": h["code"], "market": "KOSPI"} for h in holdings or []
                                          if str(h.get("market", "")).upper() == "KR"]}
        elif cid == "holdings":
            ccfg = {**ccfg, "items": holdings or [], "news_pool": pool}
        elif cid == "rumors":
            ccfg = {**ccfg, "news_pool": pool}
        results[cid] = REGISTRY[cid](ccfg, ctx).run().to_dict()
    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="아침 증권 신문 발행기")
    ap.add_argument("--date", help="발행일 YYYY-MM-DD (기본: 오늘, KST)")
    ap.add_argument("--config", default=str(ROOT / "config.yaml"))
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 출력")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--collect-only", action="store_true", help="수집 + 요약 프롬프트 파일 생성까지만")
    g.add_argument("--render-only", action="store_true", help="저장된 수집 결과로 요약·HTML 만")
    ap.add_argument("--sample", action="store_true", help="샘플 응답으로 실행 (지면 미리보기)")
    ap.add_argument("--out", help="출력 폴더 (기본: config output.dir)")
    ap.add_argument("--holdings", help="내 종목 목록 JSON 파일 (앱 저장소에서 내려받은 것). 기본: output/data/holdings.json")
    ap.add_argument("--archive", default="", help="지난 호 날짜 목록(쉼표 구분) — 출력 폴더에 없는 과거 호를 링크에 포함")
    args = ap.parse_args(argv)

    load_env(ROOT / ".env")
    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    issue = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(KST).date()
    setup_logging(cfg.get("logging", {}), issue, write_file=not args.dry_run)

    out_dir = Path(args.out) if args.out else ROOT / cfg.get("output", {}).get("dir", "output")
    data_dir = out_dir / "data"
    raw_path = data_dir / f"{issue}.json"
    prompt_path = data_dir / f"{issue}.prompt.md"
    summary_path = data_dir / f"{issue}.summary.json"

    calendar = KrxCalendar(extra_holidays=(cfg.get("market_calendar") or {}).get("extra_holidays"))
    status = calendar.status(issue)
    log.info("발행일 %s | 오늘 휴장=%s(%s) | 국내 기준 거래일 %s", issue, status["today_closed"],
             status["today_reason"], status["last_session"])

    if args.render_only:
        bundle = json.loads(raw_path.read_text(encoding="utf-8"))
        results = bundle["results"]
    else:
        if args.sample:
            from paper.fixture_http import FixtureHttp
            http = FixtureHttp()
            env = {"KRX_API_KEY": "sample", "ECOS_API_KEY": "sample", "FRED_API_KEY": "sample", "DART_API_KEY": "sample", "FINNHUB_API_KEY": "sample", "NAVER_CLIENT_ID": "sample", "NAVER_CLIENT_SECRET": "sample",
                   "KIS_APP_KEY": "sample", "KIS_APP_SECRET": "sample"}
        else:
            http, env = HttpClient.from_config(cfg.get("http")), dict(os.environ)
        ctx = Context(issue_date=issue, http=http, calendar=calendar, env=env)
        hp = Path(args.holdings) if args.holdings else data_dir / "holdings.json"
        holdings = []
        if args.sample:
            holdings = [{"market": "KR", "code": "005930", "name": "삼성전자", "qty": 10, "avg": 3000},
                        {"market": "US", "code": "NVDA", "name": "엔비디아", "qty": 5, "avg": 150}]
        elif hp.exists():
            raw = json.loads(hp.read_text(encoding="utf-8"))
            holdings = raw.get("holdings", raw) if isinstance(raw, dict) else raw
        log.info("내 종목 %d개", len(holdings))
        results = collect(cfg, ctx, holdings)
        bundle = {"issue_date": issue.isoformat(), "sample": args.sample, "market_status": status, "holdings": holdings,
                  "collected_at": dt.datetime.now(KST).isoformat(timespec="seconds"), "results": results}

    scfg = cfg.get("summary", {})
    payload = summarizer.build_payload(results, status, issue.isoformat(), scfg)

    if not args.dry_run and not args.render_only:
        data_dir.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
        prompt_path.write_text(summarizer.build_prompt(payload, scfg), encoding="utf-8")
        log.info("수집 결과 저장: %s", raw_path.relative_to(ROOT) if raw_path.is_relative_to(ROOT) else raw_path)

    ok = {k: v["ok"] for k, v in results.items()}
    log.info("수집 요약: %s", ", ".join(f"{k}={'성공' if v else '데이터 없음'}" for k, v in ok.items()))
    if args.collect_only:
        print(prompt_path)
        return 0

    summary = summarizer.summarize(payload, scfg, summary_path)
    log.info("요약 방식: %s (경고 %d건)", summary["provider"], len(summary["warnings"]))

    extra = [d for d in args.archive.split(",") if d.strip()]
    html = render.render_issue(cfg, bundle, summary, out_dir, extra_archive=extra)
    if args.dry_run:
        print(json.dumps({"status": status, "collected": ok, "summary": summary}, ensure_ascii=False, indent=1))
        log.info("dry-run: HTML %d자 생성, 파일은 쓰지 않음", len(html))
        return 0
    path = render.write_issue(cfg, issue, html, out_dir, bundle=bundle, summary=summary, extra_archive=extra)
    log.info("발행 완료: %s", path)
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
