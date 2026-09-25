"""숫자·날짜 표기 도우미 (템플릿과 요약에서 함께 사용)."""
from __future__ import annotations

import datetime as dt

WEEKDAYS = "월화수목금토일"


def num(v, digits: int = 2) -> str:
    if v is None:
        return "—"
    return f"{v:,.{digits}f}"


def signed(v, digits: int = 2, suffix: str = "") -> str:
    if v is None:
        return ""
    arrow = "▲" if v > 0 else ("▼" if v < 0 else "―")
    return f"{arrow}{abs(v):,.{digits}f}{suffix}"


def pct(v) -> str:
    if v is None:
        return ""
    return f"{'+' if v > 0 else ''}{v:.2f}%"


def digits_for(unit: str, value) -> int:
    """금리는 원자료가 소수 셋째 자리까지 있을 때만 3자리 (4.18 → 4.18, 2.398 → 2.398)."""
    if unit == "%" and value is not None and round(value, 2) != round(value, 3):
        return 3
    return 2


def date_ko(d: dt.date) -> str:
    return f"{d.year}년 {d.month}월 {d.day}일 {WEEKDAYS[d.weekday()]}요일"


def date_short(s: str | None) -> str:
    if not s:
        return ""
    d = dt.date.fromisoformat(s[:10])
    rest = s[10:].strip()
    return f"{d.month}/{d.day}({WEEKDAYS[d.weekday()]}){(' ' + rest) if rest else ''}"


def ro(word: str) -> str:
    """조사 '(으)로': 받침 없거나 ㄹ받침이면 '로', 그 밖의 받침이면 '으로'."""
    if not word:
        return word
    c = ord(word[-1])
    if 0xAC00 <= c <= 0xD7A3:
        jong = (c - 0xAC00) % 28
        return word + ("로" if jong in (0, 8) else "으로")
    return word + "(으)로"
