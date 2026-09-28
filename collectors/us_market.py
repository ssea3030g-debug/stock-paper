"""미국 증시: 다우·S&P500·나스닥 전일 마감 (Yahoo Finance)."""
from __future__ import annotations

import datetime as dt

from paper import yahoo
from paper.models import DataPoint, SectionResult

from .base import BaseCollector
from .korea_market import _uniq


def _et_now() -> dt.datetime:
    from zoneinfo import ZoneInfo
    return dt.datetime.now(ZoneInfo("America/New_York"))


def _et_today() -> str:
    return _et_now().date().isoformat()


class UsMarketCollector(BaseCollector):
    id = "us_market"

    def collect(self) -> SectionResult:
        # 07:00 KST = 전날 17~18시(미 동부) → 전날(현지) 장 마감까지 반영
        cutoff = self.ctx.issue_date - dt.timedelta(days=1)
        if self.ctx.live:                            # 앱을 열 때: 미국 장중 최근가까지
            cutoff = self.ctx.now.date()
        items, errors = [], []
        for ix in self.cfg.get("indices", []):
            try:
                dp = yahoo.last_close(self.ctx.http, ix["symbol"], ix["name"],
                                      on_or_before=cutoff, close_label="16:00 ET")
                if self.ctx.live and dp.as_of[:10] == _et_today() and _et_now().time() < dt.time(16, 0):
                    dp.as_of = dp.as_of[:10] + " 장중 (ET)"
                items.append(dp)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{ix['symbol']}: {e}")
                items.append(DataPoint(name=ix["name"], value=None))
        ok = any(i.value is not None for i in items)
        note = None
        dates = {i.as_of[:10] for i in items if i.as_of}
        if dates and max(dates) < cutoff.isoformat():
            note = f"미국 휴장 — 최근 거래일 {max(dates)} 기준"
        return SectionResult(id=self.id, ok=ok, items=items, note=note, error="; ".join(errors) or None,
                             sources=_uniq([{"name": i.source, "url": i.source_url} for i in items if i.source]))
