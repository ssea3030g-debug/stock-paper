"""Yahoo Finance 차트 API (yfinance 가 내부적으로 쓰는 공개 JSON 엔드포인트) 조회.

yfinance 패키지 없이 같은 데이터를 받되, 요청은 공통 HttpClient(간격·재시도·타임아웃)를 거친다.
개인적·비상업적 용도로만 사용하세요 (Yahoo 이용약관).
"""
from __future__ import annotations

import datetime as dt
from urllib.parse import quote
from zoneinfo import ZoneInfo

from paper.http import HttpClient
from paper.models import DataPoint

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1mo&interval=1d"
QUOTE_PAGE = "https://finance.yahoo.com/quote/{sym}"


def daily_closes(http: HttpClient, symbol: str) -> tuple[list[tuple[dt.date, float | None]], str]:
    """[(현지 거래일, 종가)] 오래된 순, 거래소 시간대 이름.
    Yahoo 는 거래일인데 종가가 비어 있는 행(None)을 보내기도 한다 — 버리지 않고 그대로 둔다."""
    data = http.get_json(CHART_URL.format(sym=quote(symbol, safe="")))
    res = (data.get("chart") or {}).get("result") or []
    if not res:
        err = (data.get("chart") or {}).get("error")
        raise ValueError(f"Yahoo 응답 없음: {symbol} {err}")
    r = res[0]
    tzname = r["meta"].get("exchangeTimezoneName", "UTC")
    tz = ZoneInfo(tzname)
    closes = r["indicators"]["quote"][0]["close"]
    out = []
    for ts, c in zip(r.get("timestamp") or [], closes):
        out.append((dt.datetime.fromtimestamp(ts, tz).date(), None if c is None else float(c)))
    return out, tzname


def last_close(http: HttpClient, symbol: str, name: str, *, on_or_before: dt.date,
               unit: str = "", close_label: str = "") -> DataPoint:
    """on_or_before 이하 마지막 거래일 종가와 전일 대비."""
    rows, tzname = daily_closes(http, symbol)
    rows = [r for r in rows if r[0] <= on_or_before]
    valid = [i for i, r in enumerate(rows) if r[1] is not None]
    if not valid:
        raise ValueError(f"{symbol}: {on_or_before} 이전 데이터 없음")
    last = valid[-1]
    d, c = rows[last]
    # 바로 앞 거래일 종가가 비어 있으면 더 이전 날과 비교하지 않는다 (틀린 전일비 방지)
    prev = rows[last - 1][1] if last > 0 else None
    change = c - prev if prev is not None else None
    return DataPoint(
        name=name, value=c, unit=unit, change=change,
        change_pct=(change / prev * 100) if prev else None,
        as_of=f"{d.isoformat()}{(' ' + close_label) if close_label else ''}",
        source="Yahoo Finance", source_url=QUOTE_PAGE.format(sym=quote(symbol, safe="=")),
        extra={"symbol": symbol, "tz": tzname,
               **({"prev_missing": rows[last - 1][0].isoformat()} if last > 0 and prev is None else {})},
    )
