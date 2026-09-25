"""요약 검증과 HTML 렌더링 테스트."""
import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import yaml

import main
from paper import render, summarizer

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))


def sample_bundle(tmp: Path) -> dict:
    main.main(["--sample", "--date", "2026-09-25", "--out", str(tmp), "--collect-only"])
    return json.loads((tmp / "data" / "2026-09-25.json").read_text(encoding="utf-8"))


class SummaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.bundle = sample_bundle(cls.tmp)
        cls.payload = summarizer.build_payload(cls.bundle["results"], cls.bundle["market_status"], "2026-09-25",
                                               CFG["summary"])

    def test_prompt_contains_rules_and_data(self):
        p = (self.tmp / "data" / "2026-09-25.prompt.md").read_text(encoding="utf-8")
        self.assertIn("만들어 내지 마세요", p)
        self.assertIn("3438.52", p)
        self.assertIn("투자 권유", p)

    def test_extractive_uses_only_data(self):
        s = summarizer.extractive(self.payload, CFG["summary"])
        self.assertIn("3,438.52", s["headline"]["body"])
        self.assertIn("추석", s["headline"]["body"])
        self.assertEqual(len(s["key_points"]), 3)
        _, warnings = summarizer.validate(s, self.payload, CFG["summary"])
        self.assertEqual(warnings, [])                      # 자동 문장은 검증을 항상 통과해야 한다

    def test_validate_rejects_invented_numbers_and_advice(self):
        bad = {"headline": {"title": "코스피 3,500 돌파 전망", "body": "코스피는 3,438.52로 마감했다."},
               "news": [{"id": "n1", "summary": "지금 매수하세요."}, {"id": "zz", "summary": "없는 기사"}],
               "key_points": ["코스피 0.49% 상승", "목표주가 상향", "나스닥 0.63% 상승"]}
        clean, warnings = summarizer.validate(bad, self.payload, CFG["summary"])
        self.assertNotIn("headline", clean)                 # 3,500 은 데이터에 없음
        self.assertEqual(clean["news"], {})                 # 금지 표현 + 없는 id
        self.assertNotIn("key_points", clean)               # 3줄 중 1줄 탈락 → 자동 문장 사용
        self.assertGreaterEqual(len(warnings), 4)

    def test_session_summary_file_and_fallback(self):
        good = {"headline": {"title": "추석 휴장", "body": "코스피는 23일 3,438.52로 마감했다."},
                "news": [{"id": "n1", "summary": "유가가 소폭 올랐다."}],
                "key_points": ["가", "나", "다"]}
        f = self.tmp / "s.json"
        f.write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")
        cfg = dict(CFG["summary"], provider="session")
        s = summarizer.summarize(self.payload, cfg, f)
        self.assertEqual(s["provider"], "session")
        self.assertEqual(s["headline"]["title"], "추석 휴장")
        s2 = summarizer.summarize(self.payload, cfg, self.tmp / "none.json")
        self.assertEqual(s2["provider"], "extractive")


class RenderTest(unittest.TestCase):
    maxDiff = 200
    longMessage = False
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.bundle = sample_bundle(cls.tmp)
        payload = summarizer.build_payload(cls.bundle["results"], cls.bundle["market_status"], "2026-09-25", CFG["summary"])
        cls.summary = summarizer.summarize(payload, dict(CFG["summary"], provider="extractive"))

    def html(self, cfg=CFG, bundle=None):
        return render.render_issue(cfg, bundle or self.bundle, self.summary, self.tmp)

    def test_newspaper_parts(self):
        h = self.html()
        for text in ("아침증권신문", "제1호", "2026년 9월 25일 금요일", "추석", "국내 증시", "미국 증시", "주요 지표",
                     "주요 뉴스", "핵심 3줄", "투자 판단은 본인 책임", "견본", "출처:"):
            self.assertIn(text, h)
        self.assertIn('class="v up">3,438.52', h)
        self.assertIn("추석으로", h)
        self.assertNotIn("추석로", h)
        self.assertIn('class="c down">▼4.40 (-0.51%)', h)   # 하락 = 파랑 클래스
        self.assertIn('class="down">▼17.20', h)
        self.assertIn("@media (prefers-color-scheme: dark)", h)
        self.assertTrue(h.lstrip().startswith("<!doctype html>"))

    def test_section_order_and_toggle(self):
        cfg = copy.deepcopy(CFG)
        secs = {s["id"]: s for s in cfg["sections"]}
        secs["news"]["enabled"] = False
        cfg["sections"] = [secs["us_market"], secs["korea_market"], secs["news"], secs["disclaimer"]]
        h = self.html(cfg)
        self.assertLess(h.index('aria-label="미국 증시"'), h.index('aria-label="국내 증시"'))
        self.assertNotIn('aria-label="주요 뉴스"', h)
        self.assertNotIn('aria-label="머리기사"', h)

    def test_failed_collectors_show_no_data(self):
        b = copy.deepcopy(self.bundle)
        for k in ("korea_market", "us_market", "news"):
            b["results"][k] = {"id": k, "ok": False, "items": [], "data": {}, "note": None, "error": "x", "sources": []}
        h = self.html(bundle=b)
        self.assertGreaterEqual(h.count("데이터 없음"), 3)

    def test_artifact_fragment_and_archive(self):
        out = self.tmp / "out"
        (out).mkdir()
        (out / "2026-09-24.html").write_text("old", encoding="utf-8")
        render.write_issue(CFG, dt.date(2026, 9, 25), self.html(), out, bundle=self.bundle, summary=self.summary)
        frag = (out / "artifact" / "2026-09-25.html").read_text(encoding="utf-8")
        self.assertTrue(frag.lstrip().startswith("<title>"))
        self.assertNotIn("<body", frag)
        self.assertIn('href="2026-09-24.html"', frag)
        idx = (out / "index.html").read_text(encoding="utf-8")
        self.assertIn("2026년 9월 24일", idx)


if __name__ == "__main__":
    unittest.main()
