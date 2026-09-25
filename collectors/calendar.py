"""일정: 미국 경제지표 발표(FRED), 다가오는 국내 휴장일, config 의 반복·수동 일정."""
from __future__ import annotations

import datetime as dt

from paper.models import SectionResult

from .base import BaseCollector

FRED_URL = "https://api.stlouisfed.org/fred/releases/dates"
FRED_PUBLIC = "https://fred.stlouisfed.org/releases/calendar"
WEEKDAYS = "월화수목금토일"


class CalendarCollector(BaseCollector):
    id = "calendar"

    def collect(self) -> SectionResult:
        d0 = self.ctx.issue_date
        d1 = d0 + dt.timedelta(days=self.cfg.get("lookahead_days", 1))
        events, errors, sources = [], [], []
        src = self.cfg.get("sources", {})

        if src.get("fred_releases", {}).get("enabled", True):
            try:
                events += self._fred(d0, d1, src.get("fred_releases", {}).get("watch", {}))
                sources.append({"name": "FRED 발표 일정", "url": FRED_PUBLIC})
            except Exception as e:  # noqa: BLE001
                errors.append(f"fred: {e}")
                self.log.warning("FRED 일정 실패: %s", e)

        if src.get("krx_holidays", True):
            cur = d0
            while cur <= d1:
                name = self.ctx.calendar.holiday_name(cur)
                if name and cur.weekday() < 5:
                    events.append({"date": cur.isoformat(), "time": "", "title": f"국내 증시 휴장 ({name})",
                                   "region": "KR", "kind": "holiday", "source": "KRX 휴장일"})
                cur += dt.timedelta(days=1)

        for r in self.cfg.get("recurring", []) or []:
            cur = d0
            while cur <= d1:
                hit = ("monthday" in r and cur.day == int(r["monthday"])) or \
                      ("weekday" in r and WEEKDAYS[cur.weekday()] == str(r["weekday"]))
                if hit:
                    events.append({"date": cur.isoformat(), "time": r.get("time", ""), "title": r["title"],
                                   "region": r.get("region", "KR"), "kind": "indicator", "source": "설정(반복)"})
                cur += dt.timedelta(days=1)

        for m in self.cfg.get("manual_events", []) or []:
            md = m["date"] if isinstance(m["date"], dt.date) else dt.date.fromisoformat(str(m["date"]))
            if d0 <= md <= d1:
                events.append({"date": md.isoformat(), "time": m.get("time", ""), "title": m["title"],
                               "region": m.get("region", "KR"), "kind": m.get("kind", "event"),
                               "source": "설정(수동)"})

        events.sort(key=lambda e: (e["date"], e["time"] or "99:99"))
        for e in events:
            d = dt.date.fromisoformat(e["date"])
            e["date_label"] = f"{d.month}/{d.day}({WEEKDAYS[d.weekday()]})"
        return SectionResult(id=self.id, ok=True, items=events, error="; ".join(errors) or None,
                             note=None if events else "예정된 주요 일정이 없습니다.", sources=sources)

    def _fred(self, d0: dt.date, d1: dt.date, watch: dict) -> list[dict]:
        key = self.key("FRED_API_KEY")
        if not key:
            raise RuntimeError("FRED_API_KEY 없음")
        data = self.ctx.http.get_json(FRED_URL, params={
            "api_key": key, "file_type": "json", "realtime_start": d0.isoformat(), "realtime_end": d1.isoformat(),
            "include_release_dates_with_no_data": "true", "sort_order": "asc", "limit": 1000})
        out = []
        for r in data.get("release_dates", []):
            ko = watch.get(r.get("release_name"))
            if ko and d0.isoformat() <= r.get("date", "") <= d1.isoformat():  # 관심 목록에 있는 발표만 (FRED 는 하루 수십 건)
                out.append({"date": r["date"], "time": "", "title": ko, "region": "US", "kind": "indicator",
                            "source": "FRED", "original": r["release_name"]})
        return out
