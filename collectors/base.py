"""모든 수집기의 공통 인터페이스."""
from __future__ import annotations

import datetime as dt
import logging
import os
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from paper.http import HttpClient
from paper.market_calendar import KrxCalendar
from paper.models import SectionResult

KST = ZoneInfo("Asia/Seoul")


@dataclass
class Context:
    """수집기들이 함께 쓰는 실행 정보."""
    issue_date: dt.date                     # 신문 발행일
    http: HttpClient
    calendar: KrxCalendar
    env: dict = field(default_factory=lambda: dict(os.environ))
    live: bool = False                      # 앱을 열 때 갱신: 오늘 장중 최근가까지 받음

    @property
    def now(self) -> dt.datetime:
        return dt.datetime.now(KST)

    @property
    def live_session(self) -> dt.date | None:
        """live 모드에서 오늘이 국내 거래일이고 장이 열렸으면 오늘 날짜."""
        if not self.live:
            return None
        now = self.now
        if self.calendar.status(now.date())["today_closed"] or now.time() < dt.time(9, 0):
            return None
        return now.date()

    @property
    def issue_time(self) -> dt.datetime:
        """발행 기준 시각 = 발행일 07:00 KST (과거 날짜로 다시 만들 때도 같은 기준)."""
        t = dt.datetime.combine(self.issue_date, dt.time(7, 0), KST)
        if self.live and self.now.date() == self.issue_date and self.now > t:   # 오후판·앱 갱신: 지금까지의 기사
            return self.now
        return t

    @property
    def market_status(self) -> dict:
        return self.calendar.status(self.issue_date)


class BaseCollector:
    id: str = "base"

    def __init__(self, cfg: dict, ctx: Context):
        self.cfg = cfg or {}
        self.ctx = ctx
        self.log = logging.getLogger(f"collector.{self.id}")

    def collect(self) -> SectionResult:  # pragma: no cover - 하위 클래스에서 구현
        raise NotImplementedError

    def run(self) -> SectionResult:
        """예외가 나도 전체 실행이 멈추지 않도록 감싼다."""
        try:
            res = self.collect()
            self.log.info("완료: ok=%s, 항목 %d개%s", res.ok, len(res.items),
                          f" ({res.error})" if res.error else "")
            return res
        except Exception as e:  # noqa: BLE001
            self.log.exception("수집 실패")
            return SectionResult(id=self.id, ok=False, error=f"{type(e).__name__}: {e}")

    def key(self, name: str) -> str | None:
        v = self.ctx.env.get(name, "").strip()
        return v or None
