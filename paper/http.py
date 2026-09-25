"""요청 간격 · 타임아웃 · 재시도 · robots.txt 준수를 한곳에서 처리하는 HTTP 클라이언트."""
from __future__ import annotations

import logging
import os
import threading
import time
from urllib.parse import quote, urlsplit
from urllib.robotparser import RobotFileParser

import requests

log = logging.getLogger(__name__)


class RobotsDisallowed(Exception):
    """robots.txt 가 해당 경로를 금지함 — 우회하지 않고 수집을 포기한다."""


class HttpClient:
    def __init__(self, timeout_sec: float = 15, retries: int = 3, min_interval_sec: float = 1.0,
                 respect_robots_txt: bool = True, user_agent: str = "MorningMarketHerald/1.0"):
        self.timeout = timeout_sec
        self.retries = retries
        self.min_interval = min_interval_sec
        self.respect_robots = respect_robots_txt
        self.user_agent = user_agent
        self.session = requests.Session()
        self.session.headers["User-Agent"] = user_agent
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self._lock = threading.Lock()
        # 오류 메시지·로그에 API 키가 찍히지 않도록 가릴 값들
        self._secrets = sorted({v for k, v in os.environ.items()
                                if k.endswith(("_KEY", "_SECRET")) and len(v) >= 6}, key=len, reverse=True)

    def redact(self, text: str) -> str:
        for v in self._secrets:
            text = text.replace(v, "***").replace(quote(v, safe=""), "***")
        return text

    @classmethod
    def from_config(cls, cfg: dict) -> "HttpClient":
        return cls(**{k: v for k, v in (cfg or {}).items()
                      if k in ("timeout_sec", "retries", "min_interval_sec", "respect_robots_txt", "user_agent")})

    # ── 내부 도우미 ─────────────────────────────────────────
    def _throttle(self, host: str) -> None:
        with self._lock:
            wait = self._last_hit.get(host, 0) + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_hit[host] = time.monotonic()

    def _allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = RobotFileParser()
            try:
                self._throttle(parts.netloc)
                r = self.session.get(base + "/robots.txt", timeout=self.timeout)
                if r.status_code in (401, 403):
                    rp.disallow_all = True
                elif r.status_code >= 400:
                    rp.allow_all = True
                else:
                    rp.parse(r.text.splitlines())
                self._robots[base] = rp
            except requests.RequestException as e:
                # robots.txt 를 확인할 수 없으면 이번 실행에서는 보수적으로 요청하지 않는다
                log.warning("robots.txt 확인 실패 %s: %s", base, e)
                self._robots[base] = None
        rp = self._robots[base]
        return rp is not None and rp.can_fetch(self.user_agent, url)

    # ── 공개 API ─────────────────────────────────────────────
    def request(self, method: str, url: str, *, check_robots: bool = False, **kw) -> requests.Response:
        """check_robots=True 는 웹/RSS 처럼 크롤링 성격의 요청에 사용.
        공식 Open API 는 프로그램 접근용으로 제공되므로 기본값 False."""
        if check_robots and self.respect_robots and not self._allowed(url):
            raise RobotsDisallowed(f"robots.txt 가 허용하지 않거나 확인할 수 없어 요청하지 않음: {url}")
        host = urlsplit(url).netloc
        kw.setdefault("timeout", self.timeout)
        last_exc: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._throttle(host)
            try:
                r = self.session.request(method, url, **kw)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
                r.raise_for_status()
                return r
            except requests.RequestException as e:
                last_exc = e
                status = getattr(getattr(e, "response", None), "status_code", None)
                if status is not None and status < 500 and status != 429:
                    break  # 4xx 는 재시도해도 소용없음
                if attempt < self.retries:
                    delay = 2 ** attempt
                    log.info("재시도 %d/%d (%s) %.0fs 후: %s", attempt, self.retries, host, delay, e)
                    time.sleep(delay)
        assert last_exc is not None
        raise type(last_exc)(self.redact(str(last_exc))) from None

    def get_json(self, url: str, **kw):
        return self.request("GET", url, **kw).json()

    def get_text(self, url: str, **kw) -> str:
        r = self.request("GET", url, **kw)
        if not r.encoding or r.encoding.lower() == "iso-8859-1":
            r.encoding = r.apparent_encoding
        return r.text

    def post_json(self, url: str, **kw):
        return self.request("POST", url, **kw).json()
