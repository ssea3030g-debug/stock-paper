"""뉴스: RSS 피드에서 최근 N시간 기사를 모으고 키워드로 거른다 (표준 라이브러리만 사용)."""
from __future__ import annotations

import datetime as dt
import difflib
import email.utils
import html
import re
import xml.etree.ElementTree as ET

from paper.models import SectionResult

from .base import KST, BaseCollector

TAG_RE = re.compile(r"<[^>]+>")
INLINE_TAG_RE = re.compile(r"</?(b|strong|em|i|u|span|font)\b[^>]*>", re.I)   # 강조 태그는 공백 없이 제거
WS_RE = re.compile(r"\s+")
SENT_RE = re.compile(r"(.+?(?:다\.|[.!?])(?=\s|$))")


def clean(text: str | None) -> str:
    text = INLINE_TAG_RE.sub("", html.unescape(text or ""))
    return WS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", text))).strip()


def first_sentence(text: str, limit: int = 160) -> str:
    text = clean(text)
    m = SENT_RE.match(text)
    s = m.group(1) if m else text
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def parse_date(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        d = None
    if d is None:
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                    "%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                d = dt.datetime.strptime(s.replace("Z", "+00:00"), fmt)
                break
            except ValueError:
                continue
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=KST)   # 시간대 없는 국내 피드는 KST 로 간주


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    out = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        f = {}
        for ch in el:
            name = _local(ch.tag)
            if name == "link":
                f.setdefault("link", (ch.text or "").strip() or ch.get("href", ""))
            elif name in ("title", "description", "summary", "content", "encoded"):
                f.setdefault({"summary": "description", "content": "description",
                              "encoded": "description"}.get(name, name), ch.text or "")
            elif name in ("pubDate", "published", "updated", "date"):
                f.setdefault("date", ch.text)
            elif name in ("author", "creator"):
                f.setdefault("author", clean(ch.text or "".join(ch.itertext())))
        out.append(f)
    return out


def _norm(title: str) -> str:
    return re.sub(r"[\W_]+", "", re.sub(r"\[[^\]]*\]", "", title)).lower()


class NewsCollector(BaseCollector):
    id = "news"

    def collect(self) -> SectionResult:
        end = self.ctx.issue_time
        start = end - dt.timedelta(hours=self.cfg.get("lookback_hours", 24))
        kw = self.cfg.get("keywords") or {}
        inc, exc = kw.get("include") or [], kw.get("exclude") or []
        articles, errors, sources = [], [], []
        for feed in self.cfg.get("feeds", []):
            try:
                if feed.get("type") == "finnhub":
                    entries = self._finnhub(feed)
                else:
                    r = self.ctx.http.request("GET", feed["url"], check_robots=True)
                    entries = parse_feed(r.content)
                sources.append({"name": feed["name"], "url": feed.get("public_url", feed["url"])})
            except Exception as e:  # noqa: BLE001
                errors.append(f"{feed['name']}: {e}")
                self.log.warning("피드 실패 %s: %s", feed["name"], e)
                continue
            for e in entries:
                title = clean(e.get("title"))
                published = parse_date(e.get("date"))
                if not title or not published or not (start <= published <= end):
                    continue
                body = clean(e.get("description"))
                hay = f"{title} {body}"
                if inc and not any(k in hay for k in inc):
                    continue
                if any(k in hay for k in exc):
                    continue
                articles.append({
                    "title": title, "url": e.get("link", ""),
                    "source": f"{e['author']} (Finnhub)" if feed.get("type") == "finnhub" and e.get("author") else feed["name"],
                    "published": published.astimezone(KST).isoformat(timespec="minutes"),
                    "first_sentence": first_sentence(body) if body else "",
                    "description": body[:600],
                    "matched": [k for k in inc if k in hay],
                })
        if self.cfg.get("dedupe", True):
            articles.sort(key=lambda a: a["published"])     # 먼저 나온 기사를 원본으로 남긴다
            articles = self._dedupe(articles)
        articles.sort(key=lambda a: a["published"], reverse=True)
        limit = self.cfg.get("max_collect", 30)
        for i, a in enumerate(articles[:limit], 1):
            a["id"] = f"n{i}"
        for i, a in enumerate(articles[limit:], limit + 1):
            a["id"] = f"n{i}"
        return SectionResult(id=self.id, ok=bool(sources), items=articles[:limit],
                             data={"window": [start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes")],
                                   "pool": articles},   # 종목 뉴스·찌라시 검색용 전체 기사 (지면에는 items 만)
                             error="; ".join(errors) or None, sources=sources)

    def _finnhub(self, feed) -> list[dict]:
        """Finnhub 시장 뉴스(영문) → RSS 항목과 같은 모양으로."""
        key = self.key("FINNHUB_API_KEY")
        if not key:
            raise RuntimeError("FINNHUB_API_KEY 없음")
        data = self.ctx.http.get_json(feed["url"], params={"category": feed.get("category", "general"), "token": key})
        out = []
        for a in data if isinstance(data, list) else []:
            ts = dt.datetime.fromtimestamp(a.get("datetime", 0), dt.timezone.utc)
            out.append({"title": a.get("headline", ""), "link": a.get("url", ""), "description": a.get("summary", ""),
                        "date": ts.isoformat(), "author": a.get("source", "")})
        return out

    @staticmethod
    def _dedupe(articles: list[dict], threshold: float = 0.8) -> list[dict]:
        kept, norms = [], []
        for a in articles:
            n = _norm(a["title"])
            if any(difflib.SequenceMatcher(None, n, k).ratio() >= threshold for k in norms):
                continue
            kept.append(a); norms.append(n)
        return kept
