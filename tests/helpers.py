import datetime as dt

from collectors.base import Context
from paper.fixture_http import FixtureHttp
from paper.market_calendar import KrxCalendar

ISSUE = dt.date(2026, 9, 25)   # 추석 당일 (국내 휴장)
KEYS = {"KRX_API_KEY": "k", "ECOS_API_KEY": "e", "FRED_API_KEY": "f", "KIS_APP_KEY": "a", "KIS_APP_SECRET": "s", "DART_API_KEY": "d", "FINNHUB_API_KEY": "f", "NAVER_CLIENT_ID": "n", "NAVER_CLIENT_SECRET": "s"}


def make_ctx(env=None, fail=(), issue=ISSUE, routes=None):
    return Context(issue_date=issue, http=FixtureHttp(routes=routes, fail=fail), calendar=KrxCalendar(),
                   env=KEYS if env is None else env)
