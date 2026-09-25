"""Jinja2 로 신문 HTML 을 만든다.

출력
  output/YYYY-MM-DD.html            완전한 HTML 문서 (GitHub Pages·브라우저용)
  output/index.html                 지난 신문 목록
  output/artifact/YYYY-MM-DD.html   claude.ai 아티팩트 게시용 (<html>/<head> 없이 본문만)
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import fmt

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"
DATE_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.html$")


def _dir(i) -> str:
    c = i.get("change") if i.get("change") is not None else i.get("change_pct")
    return _dirv(c)


def _dirv(c) -> str:
    if c is None or c == 0:
        return "flat"
    return "up" if c > 0 else "down"


def _dtime(s: str | None) -> str:
    if not s:
        return ""
    d = dt.datetime.fromisoformat(s)
    return f"{d.month}/{d.day} {d:%H:%M}"


def env() -> Environment:
    e = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape(["html", "j2"]),
                    trim_blocks=False, lstrip_blocks=False)
    e.filters.update(num=fmt.num, signed=fmt.signed, pct=fmt.pct, dshort=fmt.date_short, dir=_dir, dirv=_dirv,
                     dtime=_dtime, eok=lambda v: f"{v:+,.0f}", ro=fmt.ro)
    e.globals["dig"] = lambda i: max(fmt.digits_for(i.get("unit", ""), i.get("value")),
                                     fmt.digits_for(i.get("unit", ""), i.get("change")))
    return e


def issue_number(cfg: dict, issue: dt.date) -> int:
    first = cfg.get("newspaper", {}).get("first_issue_date")
    if not first:
        return 1
    first = first if isinstance(first, dt.date) else dt.date.fromisoformat(str(first))
    return max(1, (issue - first).days + 1)


def archive_dates(out_dir: Path, issue: dt.date) -> list[dt.date]:
    dates = {issue}
    if out_dir.exists():
        for p in out_dir.iterdir():
            m = DATE_FILE.match(p.name)
            if m:
                dates.add(dt.date.fromisoformat(m.group(1)))
    return sorted((d for d in dates if d <= issue), reverse=True)


def render_issue(cfg: dict, bundle: dict, summary: dict, out_dir: Path, standalone: bool = True,
                 extra_archive: list[str] | None = None) -> str:
    issue = dt.date.fromisoformat(bundle["issue_date"])
    paper = cfg.get("newspaper", {})
    results = bundle["results"]
    sections = [s for s in cfg.get("sections", []) if s.get("enabled", True)]
    ids = [s["id"] for s in sections]
    news_cfg = next((s for s in sections if s["id"] == "news"), {})
    pool = {a["id"]: a for a in (results.get("news") or {}).get("items", [])}
    picked = [pool[i] for i in summary.get("news", {}) if i in pool]
    news_items = (picked or list(pool.values()))[: news_cfg.get("max_items", 3)]
    stocks = build_stocks(results, summary, bundle.get("holdings") or [])
    rumors = build_rumors(results, summary, next((s.get("max_items", 5) for s in sections if s["id"] == "rumors"), 5))
    app_data = {"issue_date": bundle["issue_date"], "collected_at": bundle.get("collected_at", ""),
                "holdings_at": bundle.get("holdings_at") or bundle.get("collected_at", ""),
                "refresh_trigger": (cfg.get("app") or {}).get("refresh_trigger_id", ""),
                "refresh_after_min": (cfg.get("app") or {}).get("refresh_after_min", 30),
                "stocks": stocks, "snapshot": bundle.get("holdings") or [], "sample": bool(bundle.get("sample")),
                "names": name_lists(), "fx": usdkrw(results)}
    ear = [i for sec in ("korea_market", "us_market") for i in (results.get(sec) or {}).get("items", [])][:5]

    dates = set(archive_dates(out_dir, issue)) | {dt.date.fromisoformat(d) for d in (extra_archive or [])}
    dates = sorted((d for d in dates if d <= issue), reverse=True)[: cfg.get("output", {}).get("archive_links", 14)]
    archive = [{"file": f"{d.isoformat()}.html", "label": fmt.date_short(d.isoformat()), "current": d == issue}
               for d in dates] if len(dates) > 1 else []

    return env().get_template("newspaper.html.j2").render(
        standalone=standalone, paper=paper, colors=cfg.get("output", {}).get("colors", {"up": "#c8161d", "down": "#1b4f9c"}),
        date_ko=fmt.date_ko(issue), issue_label=fmt.date_short(issue.isoformat()), issue_no=issue_number(cfg, issue),
        status=bundle["market_status"], sample=bundle.get("sample"), results=results, sections=sections,
        summary=summary, news_items=news_items, ear_items=ear, archive=archive,
        stocks=stocks, rumors=rumors, app_data=app_data,
        show_disclaimer="disclaimer" in ids, collected_at=bundle.get("collected_at", "")[:16].replace("T", " "),
    )


def usdkrw(results: dict) -> dict | None:
    """내 종목 원화 환산용 원/달러 환율 (신문 지표에서, 기준 시점·출처 포함)."""
    for i in (results.get("indicators") or {}).get("items", []):
        if (i.get("extra") or {}).get("id") == "usdkrw" and i.get("value"):
            return {"rate": i["value"], "as_of": i.get("as_of"), "source": i.get("source")}
    return None


def name_lists(cache: Path | None = None) -> dict:
    """종목 추가 자동완성용: 국내 상장사 [이름, 코드] 전체 + 미국 종목 한글 이름 → 티커."""
    root = Path(__file__).resolve().parent.parent
    kr, us = [], {}
    cache = cache or root / "output" / "data" / "dart_corpcodes.json"
    if cache.exists():
        m = json.loads(cache.read_text(encoding="utf-8")).get("map", {})
        best: dict[str, tuple[str, str]] = {}   # 같은 이름은 가장 최근에 갱신된 회사 하나만 (상장폐지된 옛 회사 제외)
        for code, c in m.items():
            if c["name"] not in best or (c.get("date", ""), code) > best[c["name"]]:
                best[c["name"]] = (c.get("date", ""), code)
        kr = sorted(([name, code] for name, (_, code) in best.items()), key=lambda x: len(x[0]))
    usf = root / "data" / "us_names_ko.json"
    if usf.exists():
        us = json.loads(usf.read_text(encoding="utf-8"))
    return {"kr": kr, "us": us}


def build_stocks(results: dict, summary: dict, snapshot: list) -> dict:
    """내 종목 탭에 넣을 종목별 상세 (key → dict). 중요 뉴스는 Claude 가 고른 것, 없으면 최신 3개."""
    out = {}
    picks = summary.get("holdings") or {}
    for h in (results.get("holdings") or {}).get("items", []):
        by_id = {a["id"]: a for a in h.get("news", [])}
        chosen = [{**by_id[p["id"]], "summary": p["summary"]} for p in picks.get(h["key"], []) if p["id"] in by_id]
        if not chosen and h["key"] not in picks:
            chosen = [{**a, "summary": a.get("first_sentence") or ""} for a in h.get("news", [])[:3]]
        out[h["key"]] = {k: h.get(k) for k in ("key", "market", "code", "name", "exchange", "price", "earnings",
                                                "financials", "db_id")}
        fpts = summary.get("holding_filings") or {}
        out[h["key"]]["filings"] = [{**{k: f.get(k) for k in ("id", "date", "title", "url", "kind")},
                                     "points": fpts.get(f["id"], [])} for f in h.get("filings", [])]
        rpick = (summary.get("holding_rumors") or {}).get(h["key"])
        rby = {r["id"]: r for r in h.get("rumors", [])}
        if rpick is not None:
            rum = [{**rby[p["id"]], "summary": p["summary"], "status": p["status"]} for p in rpick if p["id"] in rby]
        else:
            rum = [{**r, "summary": "", "status": "회사 해명 공시" if r["kind"] == "filing" else "미확인"} for r in h.get("rumors", [])[:3]]
        out[h["key"]]["rumors"] = [{"title": (f"{r.get('headline')}" if r.get("headline") else r.get("title")),
                                    "url": r.get("url"), "date": (r.get("date") or "")[:16].replace("T", " "),
                                    "source": (f"{r.get('media') or '언론'} 보도 · 회사 해명 공시" if r.get("kind") == "filing"
                                               else r.get("source")), "summary": r.get("summary"), "status": r.get("status")}
                                   for r in rum]
        out[h["key"]]["news"] = [{k: a.get(k) for k in ("title", "url", "source", "published", "summary", "lang")}
                                 for a in chosen]
        out[h["key"]]["picked"] = h["key"] in picks
    return out


def build_rumors(results: dict, summary: dict, limit: int) -> list[dict]:
    r = results.get("rumors") or {}
    reports = {x["rid"]: x for x in r.get("items", [])}
    filings = {x["rid"]: x for x in (r.get("data") or {}).get("filings", [])}
    out = []
    for s in summary.get("rumors") or []:
        src = reports.get(s["id"]) or filings.get(s["id"])
        if src:
            is_f = s["id"] in filings
            title = f"{src['corp']} — {src.get('headline') or src['title']}" if is_f else src.get("title")
            source = f"{src.get('media') or '언론'} 보도 · {src['corp']} 해명 공시" if is_f else src.get("source")
            out.append({"title": title, "url": src.get("url"), "source": source,
                        "date": (src.get("published") or src.get("date") or "")[:16],
                        "summary": s["summary"], "status": s["status"], "kind": "filing" if s["id"] in filings else "report"})
    if not out and not summary.get("rumors"):
        for f in filings.values():
            out.append({"title": f"{f['corp']} — {f.get('headline') or f['title']}", "url": f["url"],
                        "source": f"{f.get('media') or '언론'} 보도 · 회사 해명 공시", "date": f["date"],
                        "summary": "", "status": "회사 해명 공시" if f["kind"] == "해명" else "조회공시", "kind": "filing"})
        for x in reports.values():
            out.append({"title": x["title"], "url": x["url"], "source": x["source"], "date": x["published"][:16],
                        "summary": "", "status": "미확인", "kind": "report"})
    return out[:limit]


def write_issue(cfg: dict, issue: dt.date, html: str, out_dir: Path, bundle: dict | None = None,
                summary: dict | None = None, extra_archive: list[str] | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{issue.isoformat()}.html"
    path.write_text(html, encoding="utf-8")
    if bundle is not None and summary is not None:
        art_dir = out_dir / "artifact"
        art_dir.mkdir(exist_ok=True)
        frag = render_issue(cfg, bundle, summary, out_dir, standalone=False, extra_archive=extra_archive)
        (art_dir / f"{issue.isoformat()}.html").write_text(frag, encoding="utf-8")
    if cfg.get("output", {}).get("archive_index", True):
        dates = archive_dates(out_dir, issue)
        issues = [{"file": f"{d.isoformat()}.html", "label_long": fmt.date_ko(d), "no": issue_number(cfg, d)}
                  for d in sorted(dates, reverse=True)]
        (out_dir / "index.html").write_text(
            env().get_template("index.html.j2").render(paper=cfg.get("newspaper", {}), issues=issues), encoding="utf-8")
    return path
