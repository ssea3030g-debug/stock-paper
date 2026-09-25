"""수집기 등록부. 새 수집기를 만들면 여기 REGISTRY 에 추가하고 config.yaml 에서 켠다."""
from .base import BaseCollector, Context
from .calendar import CalendarCollector
from .disclosures import DisclosuresCollector
from .holdings import HoldingsCollector
from .rumors import RumorsCollector
from .indicators import IndicatorsCollector
from .korea_market import KoreaMarketCollector
from .news import NewsCollector
from .us_market import UsMarketCollector
from .watchlist import WatchlistCollector

REGISTRY: dict[str, type[BaseCollector]] = {c.id: c for c in (
    KoreaMarketCollector, UsMarketCollector, IndicatorsCollector,
    WatchlistCollector, NewsCollector, CalendarCollector, DisclosuresCollector,
    HoldingsCollector, RumorsCollector,
)}

__all__ = ["REGISTRY", "BaseCollector", "Context"]
