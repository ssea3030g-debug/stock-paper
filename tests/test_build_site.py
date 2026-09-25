"""설치형 웹앱(site/) 빌드 테스트."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts import build_site

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
PAGE = "<!doctype html><html><head><title>t</title></head><body>{}</body></html>"


class BuildSiteTest(unittest.TestCase):
    def test_keeps_old_issues_and_points_index_to_latest(self):
        with tempfile.TemporaryDirectory() as t:
            src, site = Path(t) / "out", Path(t) / "site"
            src.mkdir(); site.mkdir()
            (site / "2026-09-24.html").write_text(PAGE.format("old"), encoding="utf-8")
            (src / "2026-09-25.html").write_text(PAGE.format("new"), encoding="utf-8")
            dates = build_site.build(CFG, src, site)
            self.assertEqual(dates, ["2026-09-25", "2026-09-24"])
            index = (site / "index.html").read_text(encoding="utf-8")
            self.assertIn("new", index)
            self.assertEqual(index.count('rel="manifest"'), 1)
            self.assertIn("2026-09-24.html", (site / "archive.html").read_text(encoding="utf-8"))
            m = json.loads((site / "manifest.webmanifest").read_text(encoding="utf-8"))
            self.assertEqual(m["display"], "standalone")
            self.assertTrue(all((site / i["src"]).exists() for i in m["icons"]))
            build_site.build(CFG, src, site)   # 다시 돌려도 태그가 두 번 들어가지 않음
            self.assertEqual((site / "2026-09-24.html").read_text(encoding="utf-8").count('rel="manifest"'), 1)
            self.assertTrue((site / "functions" / "api" / "holdings.js").exists())
            self.assertTrue((site / "functions" / "api" / "quote.js").exists())
            self.assertTrue(json.loads((site / ".well-known" / "assetlinks.json").read_text(encoding="utf-8")))

    def test_site_storage_flag_injected_once(self):
        page = ('<!doctype html><html><head><title>t</title></head><body>'
                '<script type="application/json" id="stock-data">{"issue_date": "2026-09-25"}</script>'
                '</body></html>')
        with tempfile.TemporaryDirectory() as t:
            src, site = Path(t) / "out", Path(t) / "site"
            src.mkdir()
            (src / "2026-09-25.html").write_text(page, encoding="utf-8")
            build_site.build(CFG, src, site)
            html = (site / "2026-09-25.html").read_text(encoding="utf-8")
            data = json.loads(build_site.STOCK_DATA_RE.search(html).group(2))
            self.assertTrue(data["site_storage"])
            build_site.build(CFG, src, site)   # 다시 돌려도 한 번만
            html2 = (site / "2026-09-25.html").read_text(encoding="utf-8")
            self.assertEqual(html2.count('"site_storage"'), 1)

    def test_storage_false_skips_functions_and_flag(self):
        cfg = copy.deepcopy(CFG)   # 얕은 복사로는 site dict 가 공유돼서 깊은 복사
        cfg["site"] = dict(cfg["site"], storage=False)
        page = ('<!doctype html><html><head><title>t</title></head><body>'
                '<script type="application/json" id="stock-data">{"issue_date": "2026-09-25"}</script>'
                '</body></html>')
        with tempfile.TemporaryDirectory() as t:
            src, site = Path(t) / "out", Path(t) / "site"
            src.mkdir()
            (src / "2026-09-25.html").write_text(page, encoding="utf-8")
            build_site.build(cfg, src, site)
            self.assertFalse((site / "functions").exists())
            html = (site / "2026-09-25.html").read_text(encoding="utf-8")
            self.assertNotIn("site_storage", html)


if __name__ == "__main__":
    unittest.main()
