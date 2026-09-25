"""한국 증시 휴장일 판단.

우선순위: config 의 extra_holidays → data/krx_holidays.yaml → (설치돼 있으면) holidays 패키지의 한국 공휴일.
표에 없는 연도는 holidays 패키지로 보완하되, 그것도 없으면 경고 로그를 남긴다.
"""
from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path

import yaml

log = logging.getLogger(__name__)
DEFAULT_TABLE = Path(__file__).resolve().parent.parent / "data" / "krx_holidays.yaml"
WEEKDAYS = "월화수목금토일"


class KrxCalendar:
    def __init__(self, extra_holidays: list | None = None, table_path: Path = DEFAULT_TABLE):
        self.holidays: dict[dt.date, str] = {}
        self.years_known: set[int] = set()
        if table_path.exists():
            raw = yaml.safe_load(table_path.read_text(encoding="utf-8")) or {}
            for year, days in raw.items():
                self.years_known.add(int(year))
                for d, name in (days or {}).items():
                    self.holidays[_to_date(d)] = str(name)
        for item in extra_holidays or []:
            if isinstance(item, dict):
                self.holidays[_to_date(item["date"])] = item.get("name", "임시 휴장")
            else:
                self.holidays[_to_date(item)] = "임시 휴장"
        self._lib = None
        try:
            import holidays  # type: ignore
            self._lib = holidays
        except ImportError:
            pass
        self._warned: set[int] = set()

    def holiday_name(self, d: dt.date) -> str | None:
        if d in self.holidays:
            return self.holidays[d]
        if d.year not in self.years_known:
            if self._lib is not None:
                kr = self._lib.country_holidays("KR", years=d.year, language="ko")
                if d in kr:
                    return kr.get(d)
                if (d.month, d.day) in ((5, 1), (12, 31)):
                    return "근로자의 날" if d.month == 5 else "연말 휴장"
            elif d.year not in self._warned:
                self._warned.add(d.year)
                log.warning("%d년 휴장일 표가 없습니다. data/krx_holidays.yaml 을 갱신하세요.", d.year)
        return None

    def is_session(self, d: dt.date) -> bool:
        return d.weekday() < 5 and self.holiday_name(d) is None

    def previous_session(self, d: dt.date) -> dt.date:
        """d 이전(당일 제외)의 마지막 거래일."""
        cur = d - dt.timedelta(days=1)
        for _ in range(30):
            if self.is_session(cur):
                return cur
            cur -= dt.timedelta(days=1)
        raise RuntimeError("30일 안에 거래일을 찾지 못했습니다")

    def status(self, issue_date: dt.date) -> dict:
        """신문 발행일 기준 휴장 정보.

        - today_closed: 발행일 당일 휴장 여부와 사유
        - last_session: 국내 수치의 기준이 되는 최근 거래일
        - skipped_holidays: 최근 거래일과 발행일 사이의 평일 휴장일 (→ '휴장, 최근 거래일 기준' 표기)
        """
        last = self.previous_session(issue_date)
        skipped = []
        cur = last + dt.timedelta(days=1)
        while cur < issue_date:
            name = self.holiday_name(cur)
            if cur.weekday() < 5 and name:
                skipped.append({"date": cur.isoformat(), "name": name})
            cur += dt.timedelta(days=1)
        today_name = self.holiday_name(issue_date)
        closed = not self.is_session(issue_date)
        return {
            "today_closed": closed,
            "today_reason": today_name or ("주말" if closed else None),
            "last_session": last.isoformat(),
            "last_session_label": fmt_date_short(last),
            "skipped_holidays": skipped,
        }


def _to_date(v) -> dt.date:
    return v if isinstance(v, dt.date) else dt.date.fromisoformat(str(v))


def fmt_date_short(d: dt.date) -> str:
    return f"{d.month}/{d.day}({WEEKDAYS[d.weekday()]})"
