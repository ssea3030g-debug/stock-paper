"""샘플 응답(tests/fixtures)으로 동작하는 가짜 HTTP 클라이언트.

단위 테스트와 `python main.py --sample` (네트워크 없이 지면 미리보기)에서 사용한다.
"""
from __future__ import annotations

import json
from pathlib import Path

import requests

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

# (URL 에 포함된 문자열, params 조건, 파일)
DEFAULT_ROUTES = [
    ("chart/%5EGSPC", None, "yahoo_gspc.json"),
    ("chart/%5EDJI", None, "yahoo_dji.json"),
    ("chart/%5EIXIC", None, "yahoo_ixic.json"),
    ("chart/%5EKS11", None, "yahoo_ks11.json"),
    ("chart/%5EKQ11", None, "yahoo_kq11.json"),
    ("chart/GC%3DF", None, "yahoo_gold.json"),
    ("chart/KRW%3DX", None, "yahoo_krw.json"),
    ("chart/", None, "yahoo_notfound.json"),
    ("kospi_dd_trd", None, "krx_kospi.json"),
    ("kosdaq_dd_trd", None, "krx_kosdaq.json"),
    ("StatisticSearch/", {"_path": "731Y001"}, "ecos_usdkrw.json"),
    ("StatisticSearch/", {"_path": "817Y002"}, "ecos_ktb3y.json"),
    ("series/observations", {"series_id": "DGS10"}, "fred_dgs10.json"),
    ("series/observations", {"series_id": "DCOILWTICO"}, "fred_wti.json"),
    ("series/observations", {"series_id": "DCOILBRENTEU"}, "fred_brent.json"),
    ("releases/dates", None, "fred_releases.json"),
    ("oauth2/tokenP", None, "kis_token.json"),
    ("inquire-investor", None, "kis_flows.json"),
    (".xml", None, "rss_sample.xml"),
    ("/feed", None, "rss_sample.xml"),
    ("/rss", None, "rss_sample.xml"),
]


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200):
        self.content, self.status_code = body, status
        self.text = body.decode("utf-8")

    def json(self):
        return json.loads(self.content)


class FixtureHttp:
    def __init__(self, routes=None, fail: tuple[str, ...] = ()):
        self.routes = routes or DEFAULT_ROUTES
        self.fail = fail            # 이 문자열이 URL 에 있으면 네트워크 오류를 흉내
        self.calls: list[str] = []

    def request(self, method, url, *, check_robots=False, params=None, **kw):
        self.calls.append(url)
        if any(f in url for f in self.fail):
            raise requests.ConnectionError(f"(테스트) 연결 실패: {url}")
        for frag, cond, fname in self.routes:
            if frag not in url:
                continue
            if cond:
                if "_path" in cond and cond["_path"] not in url:
                    continue
                if any((params or {}).get(k) != v for k, v in cond.items() if k != "_path"):
                    continue
            return FakeResponse((FIXTURES / fname).read_bytes())
        raise requests.HTTPError(f"404 (fixture 없음): {url}")

    def get_json(self, url, **kw):
        return self.request("GET", url, **kw).json()

    def get_text(self, url, **kw):
        return self.request("GET", url, **kw).text

    def post_json(self, url, **kw):
        return self.request("POST", url, **kw).json()
