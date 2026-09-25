"""찌라시·풍문 레이더.

출처를 알 수 없는 글을 긁어 오지 않는다. 대신
  1) 언론이 '미확인' 형태로 전한 보도(검토·추진설·관측·소식통 등)를 오늘 수집한 뉴스에서 고르고
  2) 거래소 조회공시 요구와 회사의 '풍문 또는 보도에 대한 해명' 공시를 DART 에서 가져온다.
각 항목은 원문 링크를 갖고, 지면에는 '미확인' 또는 해명 결과로 표시한다.
"""
from __future__ import annotations

import datetime as dt
import html
import io
import re
import zipfile

from paper.models import SectionResult

from .base import BaseCollector
from .disclosures import LIST_URL, MARKET, VIEW_URL

DOC_URL = "https://opendart.fss.or.kr/api/document.xml"


def filing_detail(raw: bytes, limit: int = 700) -> str:
    """해명·답변 공시 본문에서 '1. 풍문 또는 보도의 내용' 이후 요지를 뽑는다."""
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        text = z.read(z.namelist()[0]).decode("utf-8", "ignore")
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<style.*?</style>", " ", text))))
    m = re.search(r"1\.\s*(풍문|조회|공시)", text)
    return text[m.start():][:limit].strip() if m else ""

RUMOR_WORDS = ["찌라시", "루머", "풍문", "설(說)", "소문", "관측", "소식통", "검토", "추진설", "추진 중", "타진",
               "물밑", "협상 중", "인수설", "매각설", "합병설", "유력", "~할 듯", "할 듯", "가능성", "전해졌다", "알려졌다"]
FILING_WORDS = ["풍문", "해명", "조회공시", "미확정"]


class RumorsCollector(BaseCollector):
    id = "rumors"

    def collect(self) -> SectionResult:
        words = self.cfg.get("keywords") or RUMOR_WORDS
        reports = []
        for a in self.cfg.get("news_pool") or []:
            hay = f"{a.get('title', '')} {a.get('description', '')}"
            hit = [w for w in words if w in hay]
            if hit:
                reports.append({**{k: a.get(k) for k in ("id", "title", "url", "source", "published", "description")},
                                "matched": hit})
        filings, errors = [], []
        key = self.key("DART_API_KEY")
        if key:
            status = self.ctx.market_status
            end = self.ctx.issue_date - dt.timedelta(days=1)
            begin = min(dt.date.fromisoformat(status["last_session"]) - dt.timedelta(days=self.cfg.get("filing_days", 3)), end)
            try:
                for page in range(1, self.cfg.get("max_pages", 5) + 1):
                    data = self.ctx.http.get_json(LIST_URL, params={
                        "crtfc_key": key, "bgn_de": begin.strftime("%Y%m%d"), "end_de": end.strftime("%Y%m%d"),
                        "pblntf_ty": "I", "page_no": page, "page_count": 100})
                    if data.get("status") == "013":
                        break
                    if data.get("status") != "000":
                        raise ValueError(f"OpenDART {data.get('status')}: {data.get('message')}")
                    for r in data.get("list") or []:
                        name = " ".join(r.get("report_nm", "").split())
                        if any(w in name for w in FILING_WORDS):
                            d = r.get("rcept_dt", "")
                            filings.append({"corp": r.get("corp_name"), "market": MARKET.get(r.get("corp_cls"), ""),
                                            "title": name, "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                                            "url": VIEW_URL.format(no=r.get("rcept_no")),
                                            "kind": "해명" if "해명" in name else ("조회공시" if "조회" in name else "기타")})
                    if page >= int(data.get("total_page") or 1):
                        break
            except Exception as e:  # noqa: BLE001
                errors.append(str(e))
            # 해명·답변 공시는 본문에 '무슨 풍문인지'와 회사 답변이 있다 → 앞쪽 몇 건만 본문을 읽는다
            for f in [x for x in filings if x["kind"] == "해명" or "답변" in x["title"]][: self.cfg.get("detail_max", 8)]:
                try:
                    no = f["url"].rsplit("=", 1)[-1]
                    r = self.ctx.http.request("GET", DOC_URL, params={"crtfc_key": key, "rcept_no": no})
                    f["detail"] = filing_detail(r.content)
                    m = re.search(r"풍문 또는 보도의 내용\s*(.+?)\s*2\.\s*풍문 또는 보도의 매체\s*(.+?)\s*3\.", f["detail"])
                    if m:
                        f["headline"] = re.sub(r"\s*(언론)?\s*보도\s*관련\s*$", "", m.group(1)).strip(" '\"‘’“”")
                        f["media"] = m.group(2).strip()
                except Exception as e:  # noqa: BLE001
                    self.log.info("공시 본문 읽기 실패 %s: %s", f["corp"], type(e).__name__)
        else:
            errors.append("DART_API_KEY 없음 (해명 공시 생략)")
        # 소문 내용을 읽어 낸 해명·답변 공시만 남긴다 (단순 시황변동 조회공시는 찌라시가 아님)
        filings = [f for f in filings if f.get("headline")]
        for i, f in enumerate(filings, 1):
            f["rid"] = f"f{i}"
        limit = self.cfg.get("max_collect", 15)
        for i, r in enumerate(reports[:limit], 1):
            r["rid"] = f"r{i}"
        return SectionResult(id=self.id, ok=True, items=reports[:limit], data={"filings": filings[:10]},
                             error="; ".join(errors) or None,
                             note=None if (reports or filings) else "오늘은 눈에 띄는 풍문·미확인 보도가 없습니다.",
                             sources=[{"name": "언론 미확인 보도(원문 링크)", "url": ""},
                                      {"name": "금융감독원 DART 해명 공시", "url": "https://dart.fss.or.kr/"}])
