"""scripts/publish.py (예약 세션용 발행 묶음) 테스트 — 샘플 응답으로, 깃은 건드리지 않음."""
import contextlib
import datetime as dt
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import publish  # noqa: E402

DATE = "2026-09-25"


def run(*args) -> tuple[int, str]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = publish.main([*args, "--sample", "--no-pull", "--no-push", "--date", DATE])
    return rc, buf.getvalue()


class PublishTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = Path(tempfile.mkdtemp())
        cls.rc, cls.digest = run("prepare", "morning", "--out", str(cls.out))
        cls.bundle = json.loads((cls.out / "data" / f"{DATE}.json").read_text(encoding="utf-8"))

    def test_digest_small_and_complete(self):
        self.assertEqual(self.rc, 0)
        self.assertLess(len(self.digest), 15000)
        self.assertTrue(self.digest.startswith("[규칙]"))
        for part in ("# 시장", "# 뉴스 후보", "# 내 종목", "# 찌라시 후보", "코스피", "n1 |", "KR-005930-n1"):
            self.assertIn(part, self.digest)
        self.assertNotIn('"qty"', self.digest)

    def test_suspicious_pair(self):
        payload = {"indicators": [{"name": "WTI 유가", "change_pct": 1.07}, {"name": "브렌트유", "change_pct": -4.55},
                                  {"name": "금", "change_pct": 0.4}, {"name": "원/달러 환율", "change_pct": -0.1}]}
        self.assertIn("브렌트유", publish.suspicious(payload))
        self.assertNotIn("WTI 유가", publish.suspicious(payload))

    def test_finish_merges_reused_filings_and_renders(self):
        h = self.bundle["results"]["holdings"]["items"][0]
        fid = h["filings"][0]["id"]
        p = publish.Paths(self.out, dt.date.fromisoformat(DATE))
        p.reuse.write_text(json.dumps({fid: ["지난 호 요약 1", "지난 호 요약 2"]}, ensure_ascii=False), encoding="utf-8")
        summary = {"headline": {"title": "제목", "body": "본문이다."}, "news": [{"id": "n1", "summary": "요약이다."}],
                   "holdings": [], "rumors": [], "key_points": ["가", "나", "다"]}
        p.summary.write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
        rc, out = run("finish", "morning", "--out", str(self.out))
        self.assertEqual(rc, 0, out)
        self.assertIn("공시 points 1개 재사용", out)
        merged = json.loads(p.summary.read_text(encoding="utf-8"))
        self.assertEqual(merged["holdings"][0]["filings"][0]["id"], fid)
        self.assertTrue((self.out / "artifact" / f"{DATE}.html").exists())
        self.assertFalse(p.reuse.exists())

    def test_reuse_map_matches_by_filing_number(self):
        out = Path(tempfile.mkdtemp())
        (out / "data").mkdir()
        prev = {"results": {"holdings": {"items": [{"key": "KR-1", "filings": [{"id": "KR-1-f2", "rcept_no": "999"}]}]}}}
        (out / "data" / "2026-09-24.json").write_text(json.dumps(prev), encoding="utf-8")
        (out / "data" / "2026-09-24.summary.json").write_text(json.dumps(
            {"holdings": [{"key": "KR-1", "filings": [{"id": "KR-1-f2", "points": ["a", "b"]}]}]}), encoding="utf-8")
        reuse = publish.build_reuse_map(publish.Paths(out, dt.date(2026, 9, 25)))
        today = {"results": {"holdings": {"items": [{"key": "KR-1", "filings": [{"id": "KR-1-f1", "rcept_no": "999"}]}]}}}
        self.assertEqual(publish.reusable_today(today, reuse), {"KR-1-f1": ["a", "b"]})

    def test_refresh_skips_when_fresh(self):
        out = Path(tempfile.mkdtemp())
        (out / "data").mkdir()
        now = dt.datetime.now(publish.KST).isoformat(timespec="seconds")
        (out / "data" / f"{DATE}.json").write_text(json.dumps(
            {"holdings_at": now, "holdings": [{"id": "KR-005930"}]}), encoding="utf-8")
        (out / "data" / "holdings.json").write_text(json.dumps([{"id": "KR-005930", "qty": 1}]), encoding="utf-8")
        rc, text = run("prepare", "refresh", "--out", str(out))
        self.assertEqual(rc, 0)
        self.assertTrue(text.startswith("SKIP:"), text)


if __name__ == "__main__":
    unittest.main()
