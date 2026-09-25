"""내 종목 목록 가져오기(site_holdings)·새 종목 골라내기(new_holdings) 테스트."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import new_holdings, site_holdings

STOCKS = [
    {"market": "KR", "code": "005930", "name": "삼성전자", "qty": 10, "avg": 70000},
    {"market": "US", "code": "NVDA", "name": "엔비디아"},
]
PAGE = ('<!doctype html><html><body>'
        '<script type="application/json" id="stock-data">{{"snapshot": {snapshot}}}</script>'
        '</body></html>')


class SiteHoldingsTest(unittest.TestCase):
    def test_falls_back_to_static_file_when_pages_url_unset(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "data" / "site_holdings.json"
            f.parent.mkdir()
            f.write_text(json.dumps(STOCKS), encoding="utf-8")
            with mock.patch.object(site_holdings, "ROOT", Path(t)):
                holdings, src = site_holdings.fetch({"site": {"pages_url": ""}})
            self.assertEqual(src, "static")
            self.assertEqual(holdings, STOCKS)

    def test_missing_static_file_returns_empty(self):
        with tempfile.TemporaryDirectory() as t:
            with mock.patch.object(site_holdings, "ROOT", Path(t)):
                holdings, src = site_holdings.fetch({"site": {"pages_url": ""}})
            self.assertEqual((holdings, src), ([], "static"))

    def test_fetches_from_pages_url_when_set(self):
        class FakeResp:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return json.dumps(STOCKS).encode("utf-8")
        with mock.patch.object(site_holdings, "urlopen", return_value=FakeResp()) as m:
            holdings, src = site_holdings.fetch({"site": {"pages_url": "https://x.pages.dev/"}})
        self.assertEqual(src, "cloudflare")
        self.assertEqual(holdings, STOCKS)
        self.assertIn("https://x.pages.dev/api/holdings", m.call_args[0][0].full_url)

    def test_sends_access_service_token_headers(self):
        class FakeResp:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return b"[]"
        env = {"CF_ACCESS_CLIENT_ID": "id.access", "CF_ACCESS_CLIENT_SECRET": "sec"}
        with mock.patch.dict("os.environ", env), \
             mock.patch.object(site_holdings, "urlopen", return_value=FakeResp()) as m:
            site_holdings.fetch({"site": {"pages_url": "https://x.pages.dev"}})
        req = m.call_args[0][0]
        self.assertEqual(req.get_header("Cf-access-client-id"), "id.access")
        self.assertEqual(req.get_header("Cf-access-client-secret"), "sec")

    def test_login_page_instead_of_json_falls_back_to_static(self):
        class FakeResp:
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return b"<html>Cloudflare Access login</html>"
        with tempfile.TemporaryDirectory() as t:
            with mock.patch.object(site_holdings, "ROOT", Path(t)), \
                 mock.patch.object(site_holdings, "urlopen", return_value=FakeResp()):
                holdings, src = site_holdings.fetch({"site": {"pages_url": "https://x.pages.dev"}})
        self.assertEqual((holdings, src), ([], "static-fallback"))

    def test_unreachable_pages_url_falls_back_to_static(self):
        from urllib.error import URLError
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "data" / "site_holdings.json"
            f.parent.mkdir()
            f.write_text(json.dumps(STOCKS[:1]), encoding="utf-8")
            with mock.patch.object(site_holdings, "ROOT", Path(t)), \
                 mock.patch.object(site_holdings, "urlopen", side_effect=URLError("403")):
                holdings, src = site_holdings.fetch({"site": {"pages_url": "https://x.pages.dev"}})
        self.assertEqual((holdings, src), (STOCKS[:1], "static-fallback"))


class NewHoldingsTest(unittest.TestCase):
    def test_no_page_treats_everything_as_new(self):
        with tempfile.TemporaryDirectory() as t:
            new = new_holdings.new_holdings(STOCKS, Path(t) / "missing.html")
        self.assertEqual(new, STOCKS)

    def test_already_published_holdings_are_excluded(self):
        with tempfile.TemporaryDirectory() as t:
            page = Path(t) / "index.html"
            page.write_text(PAGE.format(snapshot=json.dumps([STOCKS[0]])), encoding="utf-8")
            new = new_holdings.new_holdings(STOCKS, page)
        self.assertEqual(new, [STOCKS[1]])

    def test_key_of_defaults_market_to_kr(self):
        self.assertEqual(new_holdings.key_of({"code": "005930"}), "KR-005930")
        self.assertEqual(new_holdings.key_of({"market": "us", "code": "nvda"}), "US-NVDA")


if __name__ == "__main__":
    unittest.main()
