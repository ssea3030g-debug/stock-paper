"""설치형 웹앱(site/) 빌드 테스트."""
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


if __name__ == "__main__":
    unittest.main()
