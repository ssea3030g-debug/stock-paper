"""주요 지표: 환율·유가·금리·금. 지표마다 출처를 순서대로 시도 (ECOS → FRED → Yahoo)."""
from __future__ import annotations

import datetime as dt

from paper import yahoo
from paper.models import DataPoint, SectionResult

from .base import BaseCollector
from .korea_market import _uniq

ECOS_URL = "https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/100/{stat}/{cycle}/{start}/{end}/{item}"
ECOS_PUBLIC = "https://ecos.bok.or.kr/#/SearchStat"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_PUBLIC = "https://fred.stlouisfed.org/series/{sid}"


class IndicatorsCollector(BaseCollector):
    id = "indicators"

    def collect(self) -> SectionResult:
        cutoff = self.ctx.issue_date - dt.timedelta(days=1)
        items, errors = [], []
        for spec in self.cfg.get("items", []):
            dp = None
            for src in spec.get("sources", []):
                try:
                    if src == "ecos":
                        dp = self._ecos(spec, cutoff)
                    elif src == "fred":
                        dp = self._fred(spec, cutoff)
                    elif src == "yfinance":
                        dp = yahoo.last_close(self.ctx.http, spec["yf"], spec["name"],
                                              on_or_before=cutoff, unit=spec.get("unit", ""))
                    if dp:
                        break
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{spec['id']}/{src}: {e}")
                    self.log.warning("%s %s 실패: %s", spec["id"], src, e)
            if dp:
                dp.unit = spec.get("unit", dp.unit)
                dp.extra["id"] = spec["id"]
                if dp.unit == "%":          # 금리는 %p 로 표시
                    dp.change_pct = None
            items.append(dp or DataPoint(name=spec["name"], value=None, unit=spec.get("unit", ""),
                                         extra={"id": spec["id"]}))
        return SectionResult(id=self.id, ok=any(i.value is not None for i in items), items=items,
                             error="; ".join(errors) or None,
                             sources=_uniq([{"name": i.source, "url": i.source_url} for i in items if i.source]))

    @staticmethod
    def _from_series(spec, rows: list[tuple[dt.date, float]], source: str, url: str) -> DataPoint:
        if not rows:
            raise ValueError("관측값 없음")
        rows.sort()
        d, v = rows[-1]
        prev = rows[-2][1] if len(rows) > 1 else None
        ch = v - prev if prev is not None else None
        return DataPoint(name=spec["name"], value=v, change=ch,
                         change_pct=(ch / prev * 100) if prev else None,
                         as_of=d.isoformat(), source=source, source_url=url)

    def _ecos(self, spec, cutoff: dt.date) -> DataPoint:
        key = self.key("ECOS_API_KEY")
        if not key:
            raise RuntimeError("ECOS_API_KEY 없음")
        stat, cycle, item = spec["ecos"].split("/")
        start = cutoff - dt.timedelta(days=20)
        data = self.ctx.http.get_json(ECOS_URL.format(key=key, stat=stat, cycle=cycle, item=item,
                                                      start=start.strftime("%Y%m%d"), end=cutoff.strftime("%Y%m%d")))
        if "RESULT" in data:   # 오류 응답 형식: {"RESULT": {"CODE": "...", "MESSAGE": "..."}}
            raise ValueError(f"ECOS {data['RESULT'].get('CODE')}: {data['RESULT'].get('MESSAGE')}")
        rows = [(dt.datetime.strptime(r["TIME"], "%Y%m%d").date(), float(r["DATA_VALUE"].replace(",", "")))
                for r in data["StatisticSearch"]["row"] if r.get("DATA_VALUE") not in (None, "", "-")]
        return self._from_series(spec, rows, "한국은행 ECOS", ECOS_PUBLIC)

    def _fred(self, spec, cutoff: dt.date) -> DataPoint:
        key = self.key("FRED_API_KEY")
        if not key:
            raise RuntimeError("FRED_API_KEY 없음")
        sid = spec["fred"]
        data = self.ctx.http.get_json(FRED_URL, params={
            "series_id": sid, "api_key": key, "file_type": "json", "sort_order": "desc", "limit": 10,
            "observation_end": cutoff.isoformat()})
        rows = [(dt.date.fromisoformat(o["date"]), float(o["value"]))
                for o in data.get("observations", []) if o.get("value") not in (".", "", None)]
        return self._from_series(spec, rows, "FRED (세인트루이스 연준)", FRED_PUBLIC.format(sid=sid))
