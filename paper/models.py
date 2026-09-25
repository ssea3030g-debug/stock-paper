"""수집 결과를 담는 공통 데이터 구조."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class DataPoint:
    """수치 하나. 값과 함께 기준 시점과 출처를 반드시 가진다."""

    name: str
    value: float | None
    unit: str = ""
    change: float | None = None        # 전일 대비 (절대값)
    change_pct: float | None = None    # 전일 대비 (%)
    as_of: str | None = None           # 기준 시점 (ISO 날짜 또는 날짜+시각)
    source: str = ""                   # 출처 이름
    source_url: str = ""               # 출처 URL (API 키가 들어가지 않은 공개 주소)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def direction(self) -> str:
        c = self.change if self.change is not None else self.change_pct
        if c is None or c == 0:
            return "flat"
        return "up" if c > 0 else "down"


@dataclass
class SectionResult:
    """수집기 하나의 결과. 실패해도 ok=False 로 돌려주고 신문에는 '데이터 없음'으로 표시."""

    id: str
    ok: bool
    items: list[Any] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)   # 표 외 부가 데이터 (예: 투자자별 순매수)
    note: str | None = None        # 예: "휴장, 최근 거래일(9/23) 기준"
    error: str | None = None       # 실패 사유 (로그/디버그용, 신문에는 요약만)
    sources: list[dict[str, str]] = field(default_factory=list)  # [{name, url}]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["items"] = [asdict(i) if hasattr(i, "__dataclass_fields__") else i for i in self.items]
        return d
