"""수집기 단위 테스트 — 샘플 응답(tests/fixtures)으로 실행. `pytest` 또는 `python -m unittest` 둘 다 가능."""
import datetime as dt
import unittest
from pathlib import Path

import yaml

from collectors import REGISTRY
from collectors.news import first_sentence, parse_date, parse_feed
from tests.helpers import make_ctx

CFG = yaml.safe_load((Path(__file__).resolve().parent.parent / "config.yaml").read_text(encoding="utf-8"))["collectors"]


def run(cid, **ctx_kw):
    return REGISTRY[cid](CFG[cid], make_ctx(**ctx_kw)).run()


def by_name(res):
    return {i.name: i for i in res.items}


class KoreaMarketTest(unittest.TestCase):
    def test_krx_primary_and_holiday_note(self):
        r = run("korea_market")
        self.assertTrue(r.ok)
        kospi = by_name(r)["코스피"]
        self.assertAlmostEqual(kospi.value, 3438.52)
        self.assertAlmostEqual(kospi.change_pct, 0.49)
        self.assertEqual(kospi.as_of, "2026-09-23 15:30 KST")      # 추석 전 마지막 거래일
        self.assertEqual(kospi.source, "KRX 정보데이터시스템")
        self.assertEqual(by_name(r)["코스닥"].direction, "down")
        self.assertIn("휴장", r.note)
        self.assertIn("9/23", r.note)

    def test_investor_flows_in_eok_won(self):
        flows = run("korea_market").data["flows"]["KOSPI"]
        self.assertAlmostEqual(flows["foreign"], 4123.0)
        self.assertAlmostEqual(flows["individual"], -2915.0)

    def test_fallback_to_yahoo_without_krx_key(self):
        r = run("korea_market", env={})
        kospi = by_name(r)["코스피"]
        self.assertEqual(kospi.source, "Yahoo Finance")
        self.assertAlmostEqual(kospi.value, 3438.5)
        self.assertEqual(r.data["flows"], {})             # KIS 키 없음 → 순매수 없음
        self.assertIn("KIS_APP_KEY", r.error)

    def test_all_sources_down_is_not_fatal(self):
        r = run("korea_market", env={}, fail=("yahoo",))
        self.assertFalse(r.ok)
        self.assertTrue(all(i.value is None for i in r.items))


class UsMarketTest(unittest.TestCase):
    def test_previous_us_close(self):
        r = run("us_market")
        sp = by_name(r)["S&P 500"]
        self.assertAlmostEqual(sp.value, 6671.9)
        self.assertAlmostEqual(sp.change, 6671.9 - 6644.2, places=4)
        self.assertTrue(sp.as_of.startswith("2026-09-24"))
        self.assertIn("finance.yahoo.com/quote/%5EGSPC", sp.source_url)

    def test_cutoff_excludes_future_rows(self):
        r = run("us_market", issue=dt.date(2026, 9, 24))   # 9/23 마감까지만
        self.assertTrue(by_name(r)["나스닥"].as_of.startswith("2026-09-23"))


class IndicatorsTest(unittest.TestCase):
    def test_primary_sources(self):
        items = {i.extra["id"]: i for i in run("indicators").items}
        self.assertAlmostEqual(items["usdkrw"].value, 1393.1)          # 쉼표 포함 값 처리
        self.assertEqual(items["usdkrw"].source, "한국은행 ECOS")
        self.assertNotIn("/e/", items["usdkrw"].source_url)             # 출처 URL 에 API 키 노출 금지
        self.assertAlmostEqual(items["ust10y"].value, 4.18)
        self.assertAlmostEqual(items["ust10y"].change, 0.03, places=6)
        self.assertIsNone(items["ust10y"].change_pct)                   # 금리는 %p
        self.assertEqual(items["wti"].as_of, "2026-09-22")
        self.assertEqual(items["gold"].source, "Yahoo Finance")

    def test_fallback_and_missing(self):
        items = {i.extra["id"]: i for i in run("indicators", env={}).items}
        self.assertEqual(items["usdkrw"].source, "Yahoo Finance")        # ECOS 키 없음 → Yahoo
        self.assertIsNone(items["ktb3y"].value)                          # 대체 출처 없음 → 데이터 없음

    def test_ecos_error_message(self):
        routes = [("StatisticSearch/", None, "ecos_error.json"), ("chart/", None, "yahoo_notfound.json")]
        r = run("indicators", routes=routes, env={"ECOS_API_KEY": "e"})
        self.assertIn("INFO-200", r.error)


class WatchlistTest(unittest.TestCase):
    def test_empty_list(self):
        r = run("watchlist")
        self.assertTrue(r.ok)
        self.assertEqual(r.items, [])
        self.assertIn("watchlist.stocks", r.note)

    def test_stocks(self):
        cfg = {"stocks": [{"name": "코스피지수(테스트)", "code": "^KS11", "market": "KOSPI", "yf_symbol": "^KS11"},
                          {"name": "없는 종목", "code": "ZZZZ", "market": "US"}]}
        r = REGISTRY["watchlist"](cfg, make_ctx()).run()
        a, b = r.items
        self.assertAlmostEqual(a.value, 3438.5)
        self.assertEqual(a.unit, "원")
        from paper.fmt import ro
        self.assertEqual([ro("추석"), ro("설날"), ro("주말"), ro("한글날"), ro("어린이날")],
                         ["추석으로", "설날로", "주말로", "한글날로", "어린이날로"])
        self.assertIsNone(b.value)
        self.assertIn("ZZZZ", r.error)


class NewsTest(unittest.TestCase):
    def test_window_keywords_dedupe(self):
        r = run("news")
        titles = [a["title"] for a in r.items]
        self.assertTrue(r.ok)
        self.assertNotIn("[샘플] 지난주 오래된 기사", titles)            # 24시간 밖
        self.assertFalse(any("광고" in t for t in titles))              # 제외 키워드
        self.assertEqual(sum("3,430선" in t for t in titles), 1)          # 중복 제거
        dup = next(a for a in r.items if "3,430선" in a["title"])
        self.assertEqual(dup["url"], "https://news.example.com/a1")       # 먼저 나온 원본을 남김
        self.assertEqual(r.items[0]["id"], "n1")
        self.assertTrue(all(a["published"] <= "2026-09-25T07:00+09:00" for a in r.items))

    def test_include_keyword(self):
        cfg = dict(CFG["news"], keywords={"include": ["유가"], "exclude": []})
        r = REGISTRY["news"](cfg, make_ctx()).run()
        self.assertEqual([a["title"] for a in r.items], ["[샘플] 국제유가, 재고 감소에 소폭 상승"])

    def test_parsers(self):
        root = Path(__file__).parent / "fixtures"
        atom = parse_feed((root / "atom_sample.xml").read_bytes())
        self.assertEqual(atom[0]["link"], "https://news.example.com/b1")
        self.assertEqual(parse_date("2026-09-24T22:30:00Z").hour, 22)
        self.assertEqual(parse_date("2026-09-25 06:15:00").utcoffset(), dt.timedelta(hours=9))
        self.assertEqual(first_sentence("<p>첫 문장이다. 둘째 문장이다.</p>"), "첫 문장이다.")

    def test_feed_failure(self):
        r = run("news", fail=(".xml", "/feed", "/rss", "finnhub"))
        self.assertFalse(r.ok)


class CalendarTest(unittest.TestCase):
    def test_events(self):
        r = run("calendar")
        titles = [e["title"] for e in r.items]
        self.assertIn("미국 개인소득·지출(PCE 물가)", titles)
        self.assertIn("국내 증시 휴장 (추석)", titles)
        self.assertNotIn("G.17 Industrial Production and Capacity Utilization", titles)   # 관심 목록 외
        self.assertIn("미국 소비자물가지수(CPI)", titles)                                  # 9/26, lookahead 1일
        self.assertNotIn("미국 주간 신규 실업수당 청구", titles)                            # 9/24 는 기간 밖

    def test_manual_and_recurring(self):
        cfg = dict(CFG["calendar"], manual_events=[{"date": "2026-10-01", "title": "수동 일정"}])
        r = REGISTRY["calendar"](cfg, make_ctx(env={}, issue=dt.date(2026, 10, 1))).run()
        titles = [e["title"] for e in r.items]
        self.assertIn("수동 일정", titles)
        self.assertIn("월간 수출입동향 발표 (산업통상자원부)", titles)
        self.assertIn("FRED_API_KEY", r.error)


class CalendarHolidayTest(unittest.TestCase):
    def test_status(self):
        from paper.market_calendar import KrxCalendar
        cal = KrxCalendar(extra_holidays=[{"date": "2026-09-30", "name": "임시"}])
        s = cal.status(dt.date(2026, 9, 28))
        self.assertEqual(s["last_session"], "2026-09-23")
        self.assertFalse(s["today_closed"])
        self.assertEqual(len(s["skipped_holidays"]), 2)
        self.assertFalse(cal.is_session(dt.date(2026, 9, 30)))


if __name__ == "__main__":
    unittest.main()


class YahooGapTest(unittest.TestCase):
    def test_missing_previous_close_gives_no_change(self):
        from paper import yahoo
        from paper.fixture_http import FixtureHttp
        http = FixtureHttp(routes=[("chart/", None, "yahoo_gap.json")])
        dp = yahoo.last_close(http, "^KS11", "코스피", on_or_before=dt.date(2026, 9, 23))
        self.assertAlmostEqual(dp.value, 3438.5)
        self.assertIsNone(dp.change)                 # 9/21 과 비교하지 않음
        self.assertIsNone(dp.change_pct)
        self.assertEqual(dp.extra["prev_missing"], "2026-09-22")
        dp2 = yahoo.last_close(http, "^KS11", "코스피", on_or_before=dt.date(2026, 9, 22))
        self.assertEqual(dp2.as_of, "2026-09-21")    # 종가 없는 날은 건너뛰고 직전 값


class DisclosuresTest(unittest.TestCase):
    def cfg(self, **kw):
        return dict(CFG["disclosures"], **kw)

    def test_filter_and_order(self):
        cfg = self.cfg(watchlist=[{"name": "관심기업", "code": "555555", "market": "KOSPI"}])
        r = REGISTRY["disclosures"](cfg, make_ctx()).run()
        corps = [d["corp"] for d in r.items]
        self.assertEqual(corps[0], "관심기업")                  # 관심 종목은 키워드 무관하게 맨 앞
        self.assertIn("삼성전자", corps)                        # 잠정실적
        self.assertIn("샘플전자", corps)                        # 자기주식
        self.assertNotIn("샘플비상장", corps)                   # 시장(E) 제외
        self.assertNotIn("샘플바이오", corps)                   # [기재정정] 제외
        self.assertNotIn("샘플화학", corps)                     # 키워드 없음
        sam = next(d for d in r.items if d["corp"] == "삼성전자")
        self.assertEqual(sam["url"], "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260924800111")
        self.assertEqual(sam["date"], "2026-09-24")
        self.assertEqual(r.data["window"], ["2026-09-23", "2026-09-24"])   # 전 거래일 ~ 발행 전날

    def test_errors(self):
        r = REGISTRY["disclosures"](self.cfg(), make_ctx(env={})).run()
        self.assertFalse(r.ok)
        self.assertIn("DART_API_KEY", r.error)
        bad = REGISTRY["disclosures"](self.cfg(), make_ctx(routes=[("list.json", None, "dart_badkey.json")])).run()
        self.assertIn("010", bad.error)
        empty = REGISTRY["disclosures"](self.cfg(), make_ctx(routes=[("list.json", None, "dart_empty.json")])).run()
        self.assertTrue(empty.ok)
        self.assertEqual(empty.items, [])


class RedactTest(unittest.TestCase):
    def test_api_key_hidden_in_errors(self):
        import os
        from unittest import mock
        from paper.http import HttpClient
        with mock.patch.dict(os.environ, {"FRED_API_KEY": "secret키1234"}):
            h = HttpClient()
        msg = "400 for url: https://x/?api_key=secret%ED%82%A41234 and /secret키1234/"
        self.assertNotIn("secret", h.redact(msg))


class HoldingsTest(unittest.TestCase):
    def run_h(self, items, **kw):
        cfg = dict(CFG["holdings"], items=items, news_pool=[])
        return REGISTRY["holdings"](cfg, make_ctx(**kw)).run()

    def test_us_and_kr(self):
        r = self.run_h([{"market": "US", "code": "nvda"}, {"market": "KR", "code": "005930", "qty": 3, "avg": 3000}])
        us, kr = r.items
        self.assertEqual(us["key"], "US-NVDA")
        self.assertEqual(us["earnings"]["next"]["date"], "2026-11-17")
        self.assertEqual(us["earnings"]["next"]["hour"], "장 마감 후")
        self.assertEqual(len(us["earnings"]["history"]), 2)
        self.assertEqual(us["news"][0]["id"], "US-NVDA-n1")
        self.assertEqual(us["news"][0]["lang"], "en")
        self.assertEqual(kr["exchange"], "코스피")
        self.assertEqual(kr["name"], "삼성전자")                 # 이름을 비워도 DART 기업명으로 채움
        self.assertTrue(any("잠정" in f["title"] for f in kr["filings"]))
        self.assertEqual(kr["qty"], 3)

    def test_failures_are_per_part(self):
        r = self.run_h([{"market": "US", "code": "NVDA"}], env={})
        (us,) = r.items
        self.assertIsNotNone(us["price"])                        # 시세는 Yahoo 라 키 없이도 채워짐
        self.assertTrue(any("FINNHUB_API_KEY" in e for e in us["errors"]))

    def test_empty(self):
        r = self.run_h([])
        self.assertTrue(r.ok)
        self.assertIn("내 종목", r.note)


class RumorsTest(unittest.TestCase):
    def test_reports_and_filings(self):
        pool = [{"id": "n1", "title": "A사, B사 인수설…회사 '사실무근'", "description": "", "url": "u", "source": "s",
                 "published": "2026-09-25T06:00+09:00"},
                {"id": "n2", "title": "코스피 상승 마감", "description": "", "url": "u2", "source": "s",
                 "published": "2026-09-25T06:00+09:00"}]
        r = REGISTRY["rumors"](dict(CFG["rumors"], news_pool=pool), make_ctx()).run()
        self.assertEqual([x["title"] for x in r.items], ["A사, B사 인수설…회사 '사실무근'"])
        self.assertEqual(r.items[0]["rid"], "r1")
        f = r.data["filings"]
        self.assertEqual(f[0]["kind"], "해명")
        self.assertEqual(f[0]["rid"], "f1")
        self.assertEqual(f[0]["headline"], "샘플반도체, 마곡 데이터센터 투자")   # 공시 제목 대신 소문 내용
        self.assertEqual(f[0]["media"], "샘플경제")
