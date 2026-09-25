"""Jinja2 로 신문 HTML 을 만든다.

출력
  output/YYYY-MM-DD.html            완전한 HTML 문서 (GitHub Pages·브라우저용)
  output/index.html                 지난 신문 목록
  output/artifact/YYYY-MM-DD.html   claude.ai 아티팩트 게시용 (<html>/<head> 없이 본문만)
"""
from __future__ import annotations

import datetime as dt
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
                "stocks": stocks, "snapshot": bundle.get("holdings") or [], "sample": bool(bundle.get("sample"))}
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


def build_stocks(results: dict, summary: dict, snapshot: list) -> dict:
    """내 종목 탭에 넣을 종목별 상세 (key → dict). 중요 뉴스는 Claude 가 고른 것, 없으면 최신 3개."""
    out = {}
    picks = summary.get("holdings") or {}
    for h in (results.get("holdings") or {}).get("items", []):
        by_id = {a["id"]: a for a in h.get("news", [])}
        chosen = [{**by_id[p["id"]], "summary": p["summary"]} for p in picks.get(h["key"], []) if p["id"] in by_id]
        if not chosen and h["key"] not in picks:
            chosen = [{**a, "summary": a.get("first_sentence") or ""} for a in h.get("news", [])[:3]]
        out[h["key"]] = {k: h.get(k) for k in ("key", "market", "code", "name", "exchange", "price", "earnings", "filings")}
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
            title = f"{src['corp']} — {src['title']}" if s["id"] in filings else src.get("title")
            out.append({"title": title, "url": src.get("url"), "source": src.get("source") or
                        f"{src.get('corp')} 공시", "date": (src.get("published") or src.get("date") or "")[:16],
                        "summary": s["summary"], "status": s["status"], "kind": "filing" if s["id"] in filings else "report"})
    if not out and not summary.get("rumors"):
        for f in filings.values():
            out.append({"title": f"{f['corp']} — {f['title']}", "url": f["url"], "source": "DART", "date": f["date"],
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
