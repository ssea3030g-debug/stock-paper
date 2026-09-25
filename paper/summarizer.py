"""요약: 머리기사 한 단락, 기사별 2~3줄 요약, 핵심 3줄.

provider
  session    예약 실행 세션의 Claude 가 prompt 파일을 읽고 summary 파일을 써 둔 것을 사용
  api        ANTHROPIC_API_KEY 로 Claude API 호출 (anthropic 패키지 필요)
  extractive 수집한 수치로 만든 문장 + 기사 제목/첫 문장 (AI 없음)
  auto       summary 파일 → API 키 → extractive 순

어떤 방식이든 결과는 validate() 를 통과해야 하며, 걸러진 부분은 extractive 로 채운다.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

from . import fmt

log = logging.getLogger("summarizer")

RULES = """당신은 한국어 증권 신문의 편집장입니다. 아래 [데이터]만 근거로 씁니다.

반드시 지킬 규칙
1. [데이터]에 없는 사실·수치·원인·전망을 만들어 내지 마세요. 원인이 데이터에 없으면 원인을 쓰지 마세요.
2. 수치는 [데이터]의 값을 그대로(반올림은 표시 자릿수까지만) 쓰고, 기준일을 헷갈리지 않게 쓰세요.
3. value 가 null 인 항목은 "데이터 없음", change 가 null 이면 전일 대비 변동을 쓰지 마세요.
4. 투자 권유·종목 추천·매수/매도 의견·목표가·수익 전망 표현 금지. 사실 전달만 합니다.
5. 기사 요약은 그 기사의 title 과 description 에 있는 내용만 씁니다. 영어 기사는 한국어로 옮겨 씁니다.
6. 휴장 정보(market_status)가 있으면 머리기사에서 국내 수치가 어느 거래일 기준인지 밝히세요.
7. 문체: 신문 기사체(~했다, ~이다). 과장·감탄 없이 담담하게.

고르는 기준
- news: 후보 중 '시장 전체에 파장이 가장 큰' 기사 정확히 {news_items}개. 금리·물가·중앙은행, 전쟁·지정학, 대형 기업 실적·가이던스,
  규제·정책, 대형 인수합병, 시장 급변 순으로 중요. 생활·부동산 일반·칼럼·광고성·종목 추천 기사는 고르지 마세요.
- holdings: 종목마다 그 회사 주가에 직접 영향을 줄 기사 최대 {holding_news}개(실적·가이던스·대형 계약·규제·소송·경영진·제품 발표 우선,
  단순 시세 해설·'살까 말까' 류 기사는 제외). 적당한 기사가 없으면 빈 배열.
- rumors: 찌라시·풍문 후보(reports 의 rid, filings 의 rid) 중 파장이 큰 것 최대 {rumor_items}개.
  status 는 데이터로만 판단: 해명 공시가 부인하면 "회사 부인", 검토 중·미확정이라고 하면 "회사 확인·검토 중", 확정 공시로 사실이라고 하면 "사실로 확인", 그 밖엔 "미확인".
  summary 는 '무슨 소문(보도)인지'를 한두 문장으로. 사실처럼 단정하지 말고 '~라는 보도', '~설' 형태로 쓰세요.

출력 형식 (JSON 하나만 출력)
{
  "headline": {"title": "머리기사 제목 (30자 이내)", "body": "머리기사 한 단락 (3~5문장)"},
  "news": [{"id": "n1", "summary": "2~3문장"}],
  "holdings": [{"key": "US-NVDA", "news": [{"id": "US-NVDA-n1", "summary": "2문장"}]}],
  "rumors": [{"id": "r1", "summary": "1~2문장", "status": "미확인"}],
  "key_points": ["핵심 1", "핵심 2", "핵심 3"]
}
- key_points 는 정확히 {key_points}개, 각 60자 이내.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
                     "required": ["title", "body"], "additionalProperties": False},
        "news": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "summary": {"type": "string"}},
            "required": ["id", "summary"], "additionalProperties": False}},
        "holdings": {"type": "array", "items": {"type": "object", "properties": {
            "key": {"type": "string"},
            "news": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "summary": {"type": "string"}},
                "required": ["id", "summary"], "additionalProperties": False}}},
            "required": ["key", "news"], "additionalProperties": False}},
        "rumors": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "summary": {"type": "string"},
            "status": {"type": "string", "enum": ["미확인", "회사 부인", "회사 확인·검토 중", "사실로 확인"]}},
            "required": ["id", "summary", "status"], "additionalProperties": False}},
        "key_points": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "news", "holdings", "rumors", "key_points"],
    "additionalProperties": False,
}


# ── 요약에 넘길 데이터 (수집 결과에서 필요한 것만) ──────────────
def build_payload(results: dict, market_status: dict, issue_date: str, cfg: dict) -> dict:
    def points(sec):
        r = results.get(sec)
        if not r:
            return None
        return [{k: i.get(k) for k in ("name", "value", "unit", "change", "change_pct", "as_of", "source")}
                for i in r["items"]]

    news = results.get("news", {}).get("items", [])[:40]
    cut = lambda a, n=300: {**{k: a.get(k) for k in ("id", "title", "source", "published")},
                            "description": (a.get("description") or "")[:n]}
    holdings = [{"key": h["key"], "name": h["name"], "market": h["market"],
                 "price": h.get("price") and {k: h["price"].get(k) for k in ("value", "change", "change_pct", "as_of")},
                 "earnings": h.get("earnings"), "filings": h.get("filings"),
                 "news": [cut(a) for a in h.get("news", [])]}
                for h in (results.get("holdings") or {}).get("items", [])]
    rum = results.get("rumors") or {}
    return {
        "issue_date": issue_date,
        "market_status": market_status,
        "korea_market": points("korea_market"),
        "investor_flows": (results.get("korea_market") or {}).get("data", {}).get("flows") or None,
        "us_market": points("us_market"),
        "indicators": points("indicators"),
        "watchlist": points("watchlist"),
        "news": [cut(a, 250) for a in news],
        "holdings": holdings,
        "rumors": {"reports": [{**cut(r, 200), "rid": r.get("rid")} for r in rum.get("items", [])],
                   "filings": [{k: f.get(k) for k in ("rid", "corp", "headline", "media", "date", "kind", "detail")}
                               for f in (rum.get("data") or {}).get("filings", [])]},
        "disclosures": [{k: d.get(k) for k in ("corp", "market", "title", "date", "watch")}
                        for d in (results.get("disclosures") or {}).get("items", [])[:10]],
        "calendar": [{k: e.get(k) for k in ("date", "time", "title", "region")}
                     for e in (results.get("calendar") or {}).get("items", [])],
    }


def build_prompt(payload: dict, cfg: dict) -> str:
    rules = RULES
    for k, d in (("news_items", 3), ("key_points", 3), ("holding_news", 3), ("rumor_items", 5)):
        rules = rules.replace("{" + k + "}", str(cfg.get(k, d)))
    return f"{rules}\n[데이터]\n```json\n{json.dumps(payload, ensure_ascii=False, indent=1)}\n```\n"


# ── 검증 ───────────────────────────────────────────────────────
NUM_RE = re.compile(r"\d[\d,]*\.?\d*")


def _numbers_in(obj) -> set[str]:
    out = set()
    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, (int, float)) and not isinstance(o, bool):
            for d in (0, 1, 2, 3):
                out.add(f"{round(abs(o), d):.{d}f}")
                out.add(f"{round(abs(o) / 100, d):.{d}f}")        # 억원→조원 등 단위 변환 대비는 하지 않음
        elif isinstance(o, str):
            out.update(n.replace(",", "") for n in NUM_RE.findall(o))
    walk(obj)
    return out


def validate(summary: dict, payload: dict, cfg: dict) -> tuple[dict, list[str]]:
    """문제가 있는 부분은 제거하고 (정리된 요약, 경고 목록) 반환."""
    warnings: list[str] = []
    banned = cfg.get("banned_phrases", [])
    known_nums = _numbers_in(payload)

    def ok_text(label: str, text) -> bool:
        if not isinstance(text, str) or not text.strip():
            warnings.append(f"{label}: 비어 있음"); return False
        hit = [b for b in banned if b in text]
        if hit:
            warnings.append(f"{label}: 금지 표현 {hit} → 제외"); return False
        unknown = [n for n in NUM_RE.findall(text) if n.replace(",", "") not in known_nums
                   and len(n.replace(",", "").split(".")[0]) > 1]
        if unknown:
            warnings.append(f"{label}: 데이터에 없는 숫자 {unknown} → 제외"); return False
        return True

    out: dict = {}
    h = summary.get("headline") or {}
    if ok_text("머리기사 제목", h.get("title")) and ok_text("머리기사 본문", h.get("body")):
        out["headline"] = {"title": h["title"].strip(), "body": h["body"].strip()}
    ids = {a["id"] for a in payload.get("news", [])}
    out["news"] = {}
    for n in summary.get("news") or []:
        if n.get("id") not in ids:
            warnings.append(f"뉴스 id {n.get('id')} 없음 → 제외"); continue
        if ok_text(f"뉴스 {n['id']}", n.get("summary")):
            out["news"][n["id"]] = n["summary"].strip()
    out["news"] = dict(list(out["news"].items())[: cfg.get("news_items", 3)])

    hids = {h["key"]: {a["id"] for a in h.get("news", [])} for h in payload.get("holdings", [])}
    out["holdings"] = {}
    for hk in summary.get("holdings") or []:
        k = hk.get("key")
        if k not in hids:
            warnings.append(f"내 종목 {k} 없음 → 제외"); continue
        picked = [{"id": n["id"], "summary": n["summary"].strip()} for n in hk.get("news") or []
                  if n.get("id") in hids[k] and ok_text(f"{k} {n.get('id')}", n.get("summary"))]
        out["holdings"][k] = picked[: cfg.get("holding_news", 3)]

    rum = payload.get("rumors") or {}
    rids = {r["rid"] for r in rum.get("reports", [])} | {f["rid"] for f in rum.get("filings", [])}
    out["rumors"] = []
    for r in summary.get("rumors") or []:
        if r.get("id") not in rids:
            warnings.append(f"찌라시 id {r.get('id')} 없음 → 제외"); continue
        status = r.get("status") if r.get("status") in ("미확인", "회사 부인", "회사 확인·검토 중", "사실로 확인") else "미확인"
        if ok_text(f"찌라시 {r['id']}", r.get("summary")):
            out["rumors"].append({"id": r["id"], "summary": r["summary"].strip(), "status": status})
    out["rumors"] = out["rumors"][: cfg.get("rumor_items", 5)]

    kps = [k.strip() for i, k in enumerate(summary.get("key_points") or []) if ok_text(f"핵심 {i+1}", k)]
    if len(kps) >= cfg.get("key_points", 3):
        out["key_points"] = kps[: cfg.get("key_points", 3)]
    elif summary.get("key_points"):
        warnings.append("핵심 줄 수 부족 → 자동 문장 사용")
    return out, warnings


# ── extractive (AI 없이) ────────────────────────────────────────
def _move(dp: dict, digits=2) -> str:
    if dp.get("value") is None:
        return ""
    s = f"{dp['name']} {fmt.num(dp['value'], digits)}{dp.get('unit') or ''}"
    if dp.get("change_pct") is not None:
        s += f"({fmt.pct(dp['change_pct'])})"
    elif dp.get("change") is not None:
        s += f"({'+' if dp['change'] > 0 else ''}{dp['change']:.3f}%p)" if dp.get("unit") == "%" else ""
    return s


def extractive(payload: dict, cfg: dict) -> dict:
    ms = payload["market_status"]
    kr = [d for d in payload.get("korea_market") or [] if d.get("value") is not None]
    us = [d for d in payload.get("us_market") or [] if d.get("value") is not None]
    ind = {d["name"]: d for d in payload.get("indicators") or [] if d.get("value") is not None}

    sentences, title_bits = [], []
    if kr:
        sentences.append(f"{fmt.date_short(ms['last_session'])} 국내 증시에서 " + ", ".join(_move(d) for d in kr) + "로 마감했다.")
        title_bits.append(_move(kr[0]))
    if us:
        sentences.append("뉴욕증시는 " + ", ".join(_move(d) for d in us) + "로 거래를 마쳤다.")
        title_bits.append(_move(us[-1]))
    extra = [_move(d) for d in ind.values()][:3]
    if extra:
        sentences.append("주요 지표는 " + ", ".join(extra) + "였다.")
    if ms.get("today_closed") and ms.get("today_reason") and ms["today_reason"] != "주말":
        sentences.insert(0, f"오늘은 {fmt.ro(ms['today_reason'])} 국내 증시가 휴장한다.")
    if not sentences:
        sentences = ["수집된 시장 데이터가 없습니다."]
    headline = {"title": " · ".join(title_bits) or "오늘의 시장", "body": " ".join(sentences)}

    kps = []
    if kr: kps.append("국내: " + ", ".join(_move(d) for d in kr))
    if us: kps.append("미국: " + ", ".join(_move(d) for d in us))
    if extra: kps.append("지표: " + ", ".join(extra[:2]))
    for a in payload.get("news", []):
        if len(kps) >= cfg.get("key_points", 3):
            break
        kps.append("뉴스: " + a["title"])
    while len(kps) < cfg.get("key_points", 3):
        kps.append("데이터 없음")
    # 기사별 요약은 비워 두면 지면에서 기사 첫 문장을 사용한다
    return {"headline": headline, "news": {}, "holdings": {}, "rumors": [], "key_points": kps[: cfg.get("key_points", 3)]}


# ── API ────────────────────────────────────────────────────────
def call_api(prompt: str, cfg: dict) -> dict:
    import anthropic  # 선택 의존성: pip install anthropic

    client = anthropic.Anthropic()
    kwargs = dict(
        model=cfg.get("model", "claude-opus-5"),
        max_tokens=cfg.get("max_tokens", 16000),
        messages=[{"role": "user", "content": prompt}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )
    try:
        # 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도 (server-side fallback)
        resp = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
    except TypeError:
        resp = client.messages.create(**kwargs)   # 구버전 SDK
    if resp.stop_reason == "refusal":
        raise RuntimeError("모델이 요청을 거절했습니다 (refusal)")
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


# ── 진입점 ─────────────────────────────────────────────────────
def summarize(payload: dict, cfg: dict, summary_file: Path | None = None) -> dict:
    base = extractive(payload, cfg)
    provider = cfg.get("provider", "auto")
    raw, used = None, "extractive"
    if cfg.get("enabled", True) and provider != "extractive":
        if provider in ("session", "auto") and summary_file and summary_file.exists():
            raw, used = json.loads(summary_file.read_text(encoding="utf-8")), "session"
        elif provider in ("api", "auto") and os.environ.get("ANTHROPIC_API_KEY"):
            try:
                raw, used = call_api(build_prompt(payload, cfg), cfg), "api"
            except Exception as e:  # noqa: BLE001
                log.warning("Claude API 요약 실패, 제목+첫 문장 방식으로 대체: %s", e)
        elif provider == "session":
            log.warning("요약 파일이 없습니다 (%s) → 제목+첫 문장 방식", summary_file)
    result = {**base, "provider": "extractive", "warnings": []}
    if raw:
        clean, warnings = validate(raw, payload, cfg)
        for w in warnings:
            log.warning("요약 검증: %s", w)
        result.update({k: v for k, v in clean.items() if v or k in ("holdings", "rumors")})
        result["provider"], result["warnings"] = used, warnings
    return result
