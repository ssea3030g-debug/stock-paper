"""관심 종목: config.yaml 의 종목 종가·등락률 (Yahoo Finance)."""
from __future__ import annotations

import datetime as dt

from paper import yahoo
from paper.models import DataPoint, SectionResult

from .base import BaseCollector
from .korea_market import _uniq

SUFFIX = {"KOSPI": ".KS", "KOSDAQ": ".KQ", "US": ""}


class WatchlistCollector(BaseCollector):
    id = "watchlist"

    def collect(self) -> SectionResult:
        stocks = self.cfg.get("stocks") or []
        if not stocks:
            return SectionResult(id=self.id, ok=True, note="config.yaml 의 watchlist.stocks 에 종목을 추가하세요.")
        status = self.ctx.market_status
        items, errors = [], []
        for s in stocks:
            market = s.get("market", "KOSPI").upper()
            symbol = s.get("yf_symbol") or f"{s['code']}{SUFFIX.get(market, '')}"
            if market == "US":
                cutoff, label = self.ctx.issue_date - dt.timedelta(days=1), "16:00 ET"
            else:
                cutoff, label = dt.date.fromisoformat(status["last_session"]), "15:30 KST"
            try:
                dp = yahoo.last_close(self.ctx.http, symbol, s["name"], on_or_before=cutoff, close_label=label)
                dp.unit = "달러" if market == "US" else "원"
                dp.extra.update(code=s["code"], market=market)
                items.append(dp)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{symbol}: {e}")
                items.append(DataPoint(name=s["name"], value=None, extra={"code": s["code"], "market": market}))
        return SectionResult(id=self.id, ok=any(i.value is not None for i in items), items=items,
                             error="; ".join(errors) or None,
                             sources=_uniq([{"name": i.source, "url": i.source_url} for i in items if i.source]))
