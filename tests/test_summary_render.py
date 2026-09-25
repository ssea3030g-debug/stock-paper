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
                     "오늘의 큰 뉴스", "찌라시·풍문 레이더", "내 종목", "핵심 3줄", "투자 판단은 본인 책임", "견본", "출처:"):
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
        secs["news"] = dict(secs["news"], enabled=False)
        cfg["sections"] = [secs["us_market"], secs["korea_market"], secs["news"], secs["disclaimer"]]
        h = self.html(cfg)
        self.assertLess(h.index('aria-label="미국 증시"'), h.index('aria-label="국내 증시"'))
        self.assertNotIn('aria-label="오늘의 큰 뉴스 3"', h)
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



class NameListTest(unittest.TestCase):
    def test_same_name_keeps_most_recently_updated_company(self):
        m = {"053000": {"corp_code": "a", "name": "우리금융지주", "date": "20140101"},
             "316140": {"corp_code": "b", "name": "우리금융지주", "date": "20250310"},
             "005930": {"corp_code": "c", "name": "삼성전자", "date": "20250101"}}
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "corp.json"
            f.write_text(json.dumps({"date": "2026-09-25", "map": m}, ensure_ascii=False), encoding="utf-8")
            kr = render.name_lists(f)["kr"]
        self.assertIn(["우리금융지주", "316140"], kr)
        self.assertNotIn(["우리금융지주", "053000"], kr)
        self.assertIn(["삼성전자", "005930"], kr)



class AdviceTest(unittest.TestCase):
    H = {"key": "US-ORCL", "market": "US", "avg": 140.43, "signals": {"high_1y": 325.0, "low_1y": 114.5, "ma20": 150.2,
         "ma60": 160.8, "ma120": None, "pos_1y": 10.9, "ret_1m": -4.2}}

    def test_levels_are_computed_not_invented(self):
        lv = summarizer.levels(self.H, 1355.0)
        self.assertEqual(lv["hi_1y"]["value"], 325.0)
        self.assertEqual(lv["avg_p20"]["value"], round(140.43 * 1.2, 2))
        self.assertNotIn("ma120", lv)
        krw = summarizer.levels(dict(self.H, avg=190000, avg_cur="KRW"), 1000.0)   # 원화 평균 단가 → 달러
        self.assertEqual(krw["avg_m10"]["value"], 171.0)

    def payload(self):
        lv = summarizer.levels(self.H, None)
        return {"news": [], "holdings": [{"key": "US-ORCL", "news": [], "filings": [], "rumors": [], "levels": lv,
                                          "signals": self.H["signals"]}], "rumors": {}}

    def advice(self, **kw):
        a = {"view": "일부 매도 검토", "target": "hi_1y", "stop": "ma60",
             "sell_timing": "60일 이동평균 아래로 마감하면 검토한다.",
             "conditions": [{"name": "52주 위치", "met": False, "detail": "1년 범위의 10.9% 위치로 저점 쪽이다."},
                            {"name": "단기 흐름", "met": True, "detail": "1개월 -4.2% 내렸다."}],
             "summary": "고점과 거리가 멀고 단기 흐름이 약하다."}
        a.update(kw)
        return {"holdings": [{"key": "US-ORCL", "news": [], "filings": [], "rumors": [], "advice": a}]}

    def test_valid_advice_kept(self):
        out, w = summarizer.validate(self.advice(), self.payload(), {})
        self.assertEqual(out["holding_advice"]["US-ORCL"]["target"], "hi_1y")
        self.assertEqual(len(out["holding_advice"]["US-ORCL"]["conditions"]), 2)

    def test_unknown_level_and_bad_view_and_banned(self):
        out, w = summarizer.validate(self.advice(target="my_guess_400"), self.payload(), {})
        self.assertIsNone(out["holding_advice"]["US-ORCL"]["target"])
        out, w = summarizer.validate(self.advice(view="강력 매수"), self.payload(), {})
        self.assertNotIn("US-ORCL", out["holding_advice"])
        out, w = summarizer.validate(self.advice(summary="반드시 오른다."), self.payload(), {})
        self.assertNotIn("US-ORCL", out["holding_advice"])
        out, w = summarizer.validate(self.advice(summary="목표 999달러까지 간다."), self.payload(), {})   # 없는 숫자
        self.assertNotIn("US-ORCL", out["holding_advice"])


if __name__ == "__main__":
    unittest.main()

