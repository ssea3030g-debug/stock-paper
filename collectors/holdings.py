"""내 종목: 앱에서 추가한 보유 종목별 시세·뉴스·실적.

입력은 앱 저장소(db)의 holdings 목록을 매일 아침 파일로 내려받은 것 (main.py --holdings).
  국내(KR) : 시세 Yahoo(.KS→.KQ) · 뉴스 네이버 뉴스 검색 API(키 있을 때) 또는 오늘 수집한 RSS 에서 회사명 검색
             · 실적/공시 OpenDART(최근 정기보고서·잠정실적)
  미국(US) : 시세 Yahoo · 뉴스 Finnhub company-news · 실적 Finnhub(다가오는 발표일, 최근 4분기)
어느 한 항목이 실패해도 그 종목의 나머지 정보는 채운다.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from paper import yahoo

from .base import KST, BaseCollector
from .news import clean, first_sentence, parse_date, parse_feed
from paper.models import SectionResult

FINNHUB = "https://finnhub.io/api/v1"
DART_LIST = "https://opendart.fss.or.kr/api/list.json"
DART_CORP = "https://opendart.fss.or.kr/api/corpCode.xml"
DART_VIEW = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={no}"
NAVER_NEWS = "https://openapi.naver.com/v1/search/news.json"   # 네이버 공식 검색 API (Google 뉴스는 robots.txt 로 금지)
CACHE = Path(__file__).resolve().parent.parent / "output" / "data" / "dart_corpcodes.json"
FILING_WORDS = ("잠정", "영업실적", "매출액또는손익구조", "분기보고서", "반기보고서", "사업보고서", "실적")


def key_of(h: dict) -> str:
    return f"{h['market']}-{str(h['code']).upper()}"


class HoldingsCollector(BaseCollector):
    id = "holdings"

    def collect(self) -> SectionResult:
        items = self.cfg.get("items") or []
        if not items:
            return SectionResult(id=self.id, ok=True, note="앱의 ‘내 종목’ 탭에서 종목을 추가하세요.")
        out, errors = [], []
        self._corp_map: dict | None = None
        for h in items:
            h = {**h, "market": str(h.get("market", "KR")).upper(), "code": str(h.get("code", "")).strip().upper()}
            info = {"key": key_of(h), "market": h["market"], "code": h["code"], "name": h.get("name") or h["code"],
                    "qty": h.get("qty"), "avg": h.get("avg"), "price": None, "news": [], "earnings": {},
                    "filings": [], "errors": []}
            for part in (self._price, self._news, self._earnings):
                try:
                    part(h, info)
                except Exception as e:  # noqa: BLE001 — 한 항목 실패는 그 칸만 비움
                    msg = f"{info['key']} {part.__name__[1:]}: {self.ctx.http.redact(str(e)) if hasattr(self.ctx.http, 'redact') else e}"
                    info["errors"].append(msg)
                    errors.append(msg)
                    self.log.warning(msg)
            out.append(info)
        return SectionResult(id=self.id, ok=any(i["price"] for i in out), items=out,
                             error="; ".join(errors) or None,
                             sources=[{"name": "Yahoo Finance", "url": "https://finance.yahoo.com/"},
                                      {"name": "Finnhub", "url": "https://finnhub.io/"},
                                      {"name": "금융감독원 DART", "url": "https://dart.fss.or.kr/"}])

    # ── 시세 ─────────────────────────────────────────────
    def _price(self, h, info):
        live = self.cfg.get("live")
        if h["market"] == "US":
            cutoff, label, symbols = self.ctx.issue_date - dt.timedelta(days=1), "16:00 ET", [h["code"]]
        else:
            cutoff = dt.date.fromisoformat(self.ctx.market_status["last_session"])
            label, symbols = "15:30 KST", [h["code"] + ".KS", h["code"] + ".KQ"]
        if live:   # 앱을 열 때 갱신: 오늘 장중 가격까지 (Yahoo 는 수 분~20분 지연)
            cutoff, label = dt.date.today() + dt.timedelta(days=1), "최근가"
        last_err = None
        for sym in symbols:
            try:
                dp = yahoo.last_close(self.ctx.http, sym, info["name"], on_or_before=cutoff, close_label=label)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
        else:
            raise last_err or ValueError("시세 없음")
        if not h.get("name") and dp.extra.get("long_name"):
            info["name"] = dp.extra["long_name"]
        info["exchange"] = {"KS": "코스피", "KQ": "코스닥"}.get(dp.extra["symbol"].rsplit(".", 1)[-1], "미국") \
            if h["market"] == "KR" else "미국"
        info["price"] = {"value": dp.value, "change": dp.change, "change_pct": dp.change_pct, "as_of": dp.as_of,
                         "currency": dp.extra.get("currency") or ("KRW" if h["market"] == "KR" else "USD"),
                         "high52": dp.extra.get("high52"), "low52": dp.extra.get("low52"),
                         "source": "Yahoo Finance", "url": dp.source_url}

    # ── 뉴스 ─────────────────────────────────────────────
    def _news(self, h, info):
        end = self.ctx.issue_time
        start = end - dt.timedelta(days=self.cfg.get("news_days", 7))
        arts = []
        if h["market"] == "US":
            key = self.key("FINNHUB_API_KEY")
            if not key:
                raise RuntimeError("FINNHUB_API_KEY 없음")
            data = self.ctx.http.get_json(f"{FINNHUB}/company-news", params={
                "symbol": h["code"], "from": start.date().isoformat(), "to": end.date().isoformat(), "token": key})
            for a in data if isinstance(data, list) else []:
                ts = dt.datetime.fromtimestamp(a.get("datetime", 0), KST)
                arts.append({"title": clean(a.get("headline")), "url": a.get("url", ""), "source": a.get("source", ""),
                             "published": ts.isoformat(timespec="minutes"), "description": clean(a.get("summary"))[:400],
                             "lang": "en"})
        else:
            cid, secret = self.key("NAVER_CLIENT_ID"), self.key("NAVER_CLIENT_SECRET")
            if cid and secret:
                data = self.ctx.http.get_json(NAVER_NEWS, params={"query": info["name"], "display": 30, "sort": "date"},
                                              headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret})
                for it in data.get("items") or []:
                    d = parse_date(it.get("pubDate"))
                    if d and start <= d <= end:
                        url = it.get("originallink") or it.get("link", "")
                        host = url.split("/")[2].replace("www.", "") if url.count("/") >= 2 else "네이버 뉴스"
                        arts.append({"title": clean(it.get("title")), "url": url, "source": host,
                                     "published": d.astimezone(KST).isoformat(timespec="minutes"),
                                     "description": clean(it.get("description"))[:400], "lang": "ko"})
            else:
                self.log.info("NAVER_CLIENT_ID/SECRET 없음 → 오늘 수집한 RSS 에서 회사명으로 검색")
            if not arts:
                names = {info["name"], info["name"].replace(" ", "")} | set(h.get("aliases") or [])
                for a in self.cfg.get("news_pool") or []:
                    if any(n and n in a.get("title", "") + a.get("description", "") for n in names):
                        arts.append({**{k: a.get(k) for k in ("title", "url", "source", "published", "description")},
                                     "lang": "ko"})
        arts = [a for a in arts if a["title"]]
        arts.sort(key=lambda a: a["published"], reverse=True)
        seen, uniq = set(), []
        for a in arts:
            k = a["title"][:40]
            if k not in seen:
                seen.add(k); uniq.append(a)
        for i, a in enumerate(uniq[: self.cfg.get("news_candidates", 12)], 1):
            a["id"] = f"{info['key']}-n{i}"
            a["first_sentence"] = first_sentence(a["description"]) if a["description"] else ""
            info["news"].append(a)

    # ── 실적 ─────────────────────────────────────────────
    def _earnings(self, h, info):
        if h["market"] == "US":
            key = self.key("FINNHUB_API_KEY")
            if not key:
                raise RuntimeError("FINNHUB_API_KEY 없음")
            d0 = self.ctx.issue_date
            cal = self.ctx.http.get_json(f"{FINNHUB}/calendar/earnings", params={
                "symbol": h["code"], "from": d0.isoformat(), "to": (d0 + dt.timedelta(days=180)).isoformat(),
                "token": key}).get("earningsCalendar") or []
            if cal:
                n = sorted(cal, key=lambda x: x["date"])[0]
                info["earnings"]["next"] = {
                    "date": n["date"], "hour": {"bmo": "장 시작 전", "amc": "장 마감 후"}.get(n.get("hour"), ""),
                    "quarter": f"FY{n.get('year')} Q{n.get('quarter')}" if n.get("quarter") else "",
                    "eps_est": n.get("epsEstimate"), "rev_est": n.get("revenueEstimate")}
            hist = self.ctx.http.get_json(f"{FINNHUB}/stock/earnings", params={
                "symbol": h["code"], "limit": 4, "token": key})
            info["earnings"]["history"] = [
                {"period": x.get("period"), "quarter": f"FY{x.get('year')} Q{x.get('quarter')}",
                 "eps_est": x.get("estimate"), "eps_act": x.get("actual"), "surprise_pct": x.get("surprisePercent")}
                for x in (hist if isinstance(hist, list) else [])][:4]
            info["earnings"]["source"] = "Finnhub"
        else:
            key = self.key("DART_API_KEY")
            if not key:
                raise RuntimeError("DART_API_KEY 없음")
            corp = self._corp_code(key, h["code"])
            if not corp:
                raise ValueError(f"DART 기업코드를 찾지 못함: {h['code']}")
            if not info.get("name") or info["name"] == h["code"]:
                info["name"] = corp["name"]
            end = self.ctx.issue_date - dt.timedelta(days=1)
            rows = []
            for ty in ("A", "I"):
                data = self.ctx.http.get_json(DART_LIST, params={
                    "crtfc_key": key, "corp_code": corp["corp_code"], "pblntf_ty": ty,
                    "bgn_de": (end - dt.timedelta(days=self.cfg.get("filing_days", 180))).strftime("%Y%m%d"),
                    "end_de": end.strftime("%Y%m%d"), "page_count": 30})
                if data.get("status") == "000":
                    rows += data.get("list") or []
                elif data.get("status") != "013":
                    raise ValueError(f"OpenDART {data.get('status')}: {data.get('message')}")
            rows.sort(key=lambda r: r.get("rcept_dt", ""), reverse=True)
            for r in rows:
                name = " ".join(r.get("report_nm", "").split())
                if any(w in name for w in FILING_WORDS) and "[기재정정]" not in name:
                    d = r.get("rcept_dt", "")
                    info["filings"].append({"date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "title": name,
                                            "url": DART_VIEW.format(no=r.get("rcept_no"))})
                if len(info["filings"]) >= 5:
                    break
            info["earnings"]["source"] = "금융감독원 DART"
            info["earnings"]["note"] = "국내 기업은 실적 발표 예정일을 미리 공시하지 않는 경우가 많아, 최근 실적 관련 공시를 보여 줍니다."

    def _corp_code(self, key: str, stock_code: str) -> dict | None:
        if self._corp_map is None:
            today = dt.date.today().isoformat()
            if CACHE.exists():
                cached = json.loads(CACHE.read_text(encoding="utf-8"))
                if cached.get("date") == today:
                    self._corp_map = cached["map"]
            if self._corp_map is None:
                r = self.ctx.http.request("GET", DART_CORP, params={"crtfc_key": key})
                with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                    root = ET.fromstring(z.read(z.namelist()[0]))
                self._corp_map = {}
                for el in root.iter("list"):
                    sc = (el.findtext("stock_code") or "").strip()
                    if sc:
                        self._corp_map[sc] = {"corp_code": el.findtext("corp_code"),
                                              "name": (el.findtext("corp_name") or "").strip()}
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps({"date": today, "map": self._corp_map}, ensure_ascii=False),
                                 encoding="utf-8")
        return self._corp_map.get(stock_code)
