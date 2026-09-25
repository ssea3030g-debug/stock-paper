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
# 소문의 '강도' 점수 — 흔한 말(검토·가능성)만 걸린 시황 기사보다 단독·거래설·익명 취재원 기사를 앞에 둔다
STRONG = {"[단독]": 4, "단독": 3, "찌라시": 3, "루머": 3, "풍문": 3, "인수설": 3, "매각설": 3, "합병설": 3, "추진설": 3,
          "소식통": 2, "물밑": 2, "타진": 2, "협상 중": 2, "IB업계": 2, "투자은행(IB)": 2, "관계자에 따르면": 2,
          "업계에 따르면": 2, "정통한": 2, "비공개": 1, "설(說)": 2, "소문": 2, "매물": 2, "지분 매각": 2, "경영권": 2,
          "reportedly": 3, "people familiar": 3, "familiar with the matter": 3, "sources said": 3, "in talks": 3,
          "exploring a sale": 3, "exploring options": 2, "considering a sale": 3, "takeover": 2, "buyout": 2,
          "exclusive": 3, "rumor": 3, "speculation": 2, "weighs": 2, "mulls": 2, "approached": 2}
WEAK = {"검토": 1, "관측": 1, "가능성": 1, "유력": 1, "전해졌다": 1, "알려졌다": 1, "할 듯": 1, "추진 중": 1}
# 시장 전체 시황·전망 기사는 소문이 아니다
NOT_RUMOR = ("마감", "시황", "출발", "코스피 전망", "증시 전망", "환율 전망", "개장", "[표]", "[속보] 코스피", "특징주",
             # 생활·부동산 일반 기사
             "전세", "월세", "집값", "아파트", "청약", "시댁", "이혼", "남편", "아내", "연애", "결혼", "육아", "맛집", "날씨")


# 기업 사건(거래·지배구조·상장·자금·수사) + 미확정 표현이 함께 있으면 '소문'일 가능성이 높다
EVENT = ("인수", "매각", "합병", "지분", "경영권", "상장", "IPO", "분할", "공개매수", "투자 유치", "유상증자", "자사주",
         "결별", "교체", "사임", "퇴진", "압수수색", "제재", "소송", "매물", "M&A", "블록딜", "대규모 수주",
         "acquire", "acquisition", "merger", "stake", "bid for", "takeover", "ipo", "spin off", "divest", "buyout")
HEDGE = ("검토", "추진", "협상", "타진", "관측", "유력", "할 듯", "알려졌다", "전해졌다", "따르면", "설", "물밑", "저울질",
         "considering", "exploring", "in talks", "weighs", "mulls", "plans to", "reportedly", "could")


def rumor_score(text: str) -> tuple[int, list[str]]:
    low = text.lower()
    hits = [w for w in STRONG if w.lower() in low] + [w for w in WEAK if w in text]
    score = sum(STRONG.get(w, 0) for w in hits) + sum(WEAK.get(w, 0) for w in hits)
    ev = [w for w in EVENT if w.lower() in low]
    hd = [w for w in HEDGE if w.lower() in low]
    if ev and hd:   # 예: '솔리다임, 이르면 내년 美상장 검토' — 기업 사건 + 미확정
        score += 2
        hits += [f"{ev[0]}+{hd[0]}"]
    elif ev:
        score += 1
    return score, hits


def _tokens(title: str) -> set[str]:
    t = re.sub(r"\[[^\]]*\]|[^\w\s가-힣]", " ", title.lower())
    return {w for w in t.split() if len(w) >= 2}


def cluster(reports: list[dict], thresh: float = 0.34) -> list[dict]:
    """같은 소문을 여러 매체가 보도하면 하나로 묶고 매체 수를 센다 (제목 낱말이 겹치는 정도)."""
    out: list[dict] = []
    for r in sorted(reports, key=lambda x: (-x["score"], x.get("published") or "")):
        tk = _tokens(r["title"])
        for c in out:
            inter = len(tk & c["_tk"])
            if tk and inter / max(1, min(len(tk), len(c["_tk"]))) >= thresh and inter >= 2:
                if r["source"] not in c["outlets"]:
                    c["outlets"].append(r["source"])
                    c["also"].append({"source": r["source"], "title": r["title"], "url": r["url"]})
                c["score"] = max(c["score"], r["score"])
                break
        else:
            out.append({**r, "_tk": tk, "outlets": [r["source"]], "also": []})
    for c in out:
        c.pop("_tk", None)
        c["score"] += min(3, len(c["outlets"]) - 1)   # 여러 매체가 다루면 가산
    return sorted(out, key=lambda x: -x["score"])


def previous_rumors(page: str | None) -> list[dict]:
    """어제(이전 호) 신문에 실린 찌라시 — 새 소문/후속을 가르는 데 씀."""
    import json
    from pathlib import Path
    if not page or not Path(page).exists():
        return []
    m = re.search(r'<script type="application/json" id="stock-data">(.*?)</script>', Path(page).read_text(encoding="utf-8"), re.S)
    try:
        return (json.loads(m.group(1)).get("rumor_log") or []) if m else []
    except ValueError:
        return []
FILING_WORDS = ["풍문", "해명", "조회공시", "미확정"]


class RumorsCollector(BaseCollector):
    id = "rumors"

    def collect(self) -> SectionResult:
        hours = self.cfg.get("report_hours", 48)   # 새 소문 위주: 최근 이틀치 기사만
        since = (self.ctx.issue_time - dt.timedelta(hours=hours)).isoformat()
        reports = []
        for a in self.cfg.get("news_pool") or []:
            title = a.get("title", "")
            if (a.get("published") or "") < since or any(w in title for w in NOT_RUMOR):
                continue
            score, hit = rumor_score(f"{title} {a.get('description', '')}")
            if score >= self.cfg.get("min_score", 2):
                reports.append({**{k: a.get(k) for k in ("id", "title", "url", "source", "published", "description")},
                                "matched": hit, "score": score})
        reports = cluster(reports)
        prev = previous_rumors(self.cfg.get("prev_page"))
        prev_tk = [(_tokens(p.get("title") or ""), p) for p in prev]
        for r in reports:   # 어제 실린 소문과 겹치면 표시 (AI 가 '후속'인지 판단)
            tk = _tokens(r["title"])
            for ptk, p in prev_tk:
                if tk and len(tk & ptk) / max(1, min(len(tk), len(ptk))) >= 0.34 and len(tk & ptk) >= 2:
                    r["seen_before"] = {"title": p.get("title"), "status": p.get("status"), "date": p.get("date")}
                    break
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
        return SectionResult(id=self.id, ok=True, items=reports[:limit], data={"filings": filings[:10], "previous": prev[:15]},
                             error="; ".join(errors) or None,
                             note=None if (reports or filings) else "오늘은 눈에 띄는 풍문·미확인 보도가 없습니다.",
                             sources=[{"name": "언론 미확인 보도(원문 링크)", "url": ""},
                                      {"name": "금융감독원 DART 해명 공시", "url": "https://dart.fss.or.kr/"}])
