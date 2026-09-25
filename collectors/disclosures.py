"""주요 공시: 금융감독원 OpenDART 공시검색 API.

전 거래일부터 발행일 전날까지 공시된 목록에서, 설정한 시장·공시유형·키워드에 맞는 것을 고른다.
관심 종목(watchlist)의 공시는 키워드와 상관없이 맨 앞에 둔다.
"""
from __future__ import annotations

import datetime as dt

from paper.models import SectionResult

from .base import BaseCollector

LIST_URL = "https://opendart.fss.or.kr/api/list.json"
VIEW_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={no}"
PUBLIC = "https://dart.fss.or.kr/"
MARKET = {"Y": "코스피", "K": "코스닥", "N": "코넥스", "E": "기타"}


class DisclosuresCollector(BaseCollector):
    id = "disclosures"

    def collect(self) -> SectionResult:
        key = self.key("DART_API_KEY")
        if not key:
            raise RuntimeError("DART_API_KEY 없음")
        status = self.ctx.market_status
        end = self.ctx.issue_date - dt.timedelta(days=1)
        begin = min(dt.date.fromisoformat(status["last_session"]), end)
        watch = {s["code"]: s["name"] for s in (self.cfg.get("watchlist") or [])
                 if s.get("market", "KOSPI").upper() in ("KOSPI", "KOSDAQ")}
        markets = set(self.cfg.get("markets", ["Y", "K"]))
        keywords = self.cfg.get("keywords") or []
        exclude = self.cfg.get("exclude") or []

        rows: list[dict] = []
        for ty in self.cfg.get("types", ["I"]):
            for page in range(1, self.cfg.get("max_pages", 5) + 1):
                data = self.ctx.http.get_json(LIST_URL, params={
                    "crtfc_key": key, "bgn_de": begin.strftime("%Y%m%d"), "end_de": end.strftime("%Y%m%d"),
                    "pblntf_ty": ty, "page_no": page, "page_count": 100, "sort": "date", "sort_mth": "desc"})
                st = data.get("status")
                if st == "013":          # 조회된 데이터 없음
                    break
                if st != "000":
                    raise ValueError(f"OpenDART {st}: {data.get('message')}")
                rows += data.get("list") or []
                if page >= int(data.get("total_page") or 1):
                    break

        picked, seen = [], set()
        for r in rows:
            name = r.get("report_nm", "").strip()
            if r.get("rcept_no") in seen or any(x in name for x in exclude):
                continue
            is_watch = r.get("stock_code") in watch
            if not is_watch and (r.get("corp_cls") not in markets or not any(k in name for k in keywords)):
                continue
            seen.add(r.get("rcept_no"))
            d = r.get("rcept_dt", "")
            picked.append({
                "corp": r.get("corp_name", ""), "stock_code": r.get("stock_code", ""),
                "market": MARKET.get(r.get("corp_cls", ""), ""), "title": " ".join(name.split()),
                "date": f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else d,
                "url": VIEW_URL.format(no=r.get("rcept_no", "")), "watch": is_watch,
                "correction": "[기재정정]" in name or "정정" in (r.get("rm") or ""),
            })
        picked.sort(key=lambda x: not x["watch"])       # 관심 종목 먼저 (API 가 최신순으로 주므로 나머지 순서 유지)
        limit = self.cfg.get("max_collect", 20)
        return SectionResult(
            id=self.id, ok=True, items=picked[:limit],
            data={"window": [begin.isoformat(), end.isoformat()], "total_scanned": len(rows)},
            note=None if picked else "해당 기간에 조건에 맞는 공시가 없습니다.",
            sources=[{"name": "금융감독원 DART", "url": PUBLIC}])
