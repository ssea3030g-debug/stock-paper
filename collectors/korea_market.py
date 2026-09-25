"""국내 증시: 코스피·코스닥 지수와 투자자별(외국인·기관·개인) 순매수.

지수 출처 우선순위(config.sources): krx_openapi → yfinance
순매수 출처: kis_openapi (키가 없으면 '데이터 없음')
"""
from __future__ import annotations

import datetime as dt

from paper import yahoo
from paper.models import DataPoint, SectionResult

from .base import BaseCollector

KRX_URL = "https://data-dbg.krx.co.kr/svc/apis/idx/{ep}"
KRX_PUBLIC = "https://openapi.krx.co.kr/"
KRX_ENDPOINTS = {"KOSPI": ("kospi_dd_trd", "코스피"), "KOSDAQ": ("kosdaq_dd_trd", "코스닥")}
YF_SYMBOLS = {"KOSPI": "^KS11", "KOSDAQ": "^KQ11"}
NAMES = {"KOSPI": "코스피", "KOSDAQ": "코스닥"}

KIS_BASE = "https://openapi.koreainvestment.com:9443"
KIS_PUBLIC = "https://apiportal.koreainvestment.com/"


def _num(v) -> float | None:
    if v in (None, "", "-"):
        return None
    return float(str(v).replace(",", ""))


class KoreaMarketCollector(BaseCollector):
    id = "korea_market"

    def collect(self) -> SectionResult:
        status = self.ctx.market_status
        session = dt.date.fromisoformat(status["last_session"])
        indices = self.cfg.get("indices", ["KOSPI", "KOSDAQ"])
        items: list[DataPoint] = []
        errors: list[str] = []
        sources: list[dict] = []

        for idx in indices:
            dp = None
            for src in self.cfg.get("sources", ["krx_openapi", "yfinance"]):
                try:
                    if src == "krx_openapi":
                        dp = self._krx(idx, session)
                    elif src == "yfinance":
                        dp = yahoo.last_close(self.ctx.http, YF_SYMBOLS[idx], NAMES[idx],
                                              on_or_before=session, close_label="15:30 KST")
                    if dp:
                        break
                except Exception as e:  # noqa: BLE001 — 다음 출처로 넘어간다
                    errors.append(f"{idx}/{src}: {e}")
                    self.log.warning("%s %s 실패: %s", idx, src, e)
            items.append(dp or DataPoint(name=NAMES.get(idx, idx), value=None))
            if dp:
                sources.append({"name": dp.source, "url": dp.source_url})

        flows = {}
        if self.cfg.get("investor_flows", True):
            try:
                flows = self._kis_flows(indices, session)
                if flows:
                    sources.append({"name": "한국투자증권 Open API", "url": KIS_PUBLIC})
            except Exception as e:  # noqa: BLE001
                errors.append(f"flows: {e}")
                self.log.warning("투자자별 순매수 실패: %s", e)

        note = None
        if status["skipped_holidays"]:
            names = ", ".join(sorted({h["name"] for h in status["skipped_holidays"]}))
            note = f"휴장({names}) — 최근 거래일 {status['last_session_label']} 기준"
        ok = any(i.value is not None for i in items)
        return SectionResult(id=self.id, ok=ok, items=items, data={"flows": flows,
                             "session": session.isoformat()}, note=note,
                             error="; ".join(errors) or None, sources=_uniq(sources))

    # ── KRX 정보데이터시스템 Open API ───────────────────────
    def _krx(self, idx: str, session: dt.date) -> DataPoint | None:
        key = self.key("KRX_API_KEY")
        if not key:
            raise RuntimeError("KRX_API_KEY 없음")
        ep, krx_name = KRX_ENDPOINTS[idx]
        data = self.ctx.http.get_json(KRX_URL.format(ep=ep), params={"basDd": session.strftime("%Y%m%d")},
                                      headers={"AUTH_KEY": key})
        for row in data.get("OutBlock_1") or []:
            if row.get("IDX_NM") == krx_name:
                return DataPoint(
                    name=NAMES[idx], value=_num(row["CLSPRC_IDX"]), change=_num(row.get("CMPPREV_IDX")),
                    change_pct=_num(row.get("FLUC_RT")), as_of=f"{session.isoformat()} 15:30 KST",
                    source="KRX 정보데이터시스템", source_url=KRX_PUBLIC,
                    extra={"trade_value": _num(row.get("ACC_TRDVAL"))},
                )
        raise ValueError(f"KRX 응답에 {krx_name} 없음 (휴장일이거나 서비스 미신청)")

    # ── 한국투자증권 Open API: 시장별 투자자 매매동향(일별) ─
    def _kis_flows(self, indices: list[str], session: dt.date) -> dict:
        appkey, secret = self.key("KIS_APP_KEY"), self.key("KIS_APP_SECRET")
        if not (appkey and secret):
            raise RuntimeError("KIS_APP_KEY/KIS_APP_SECRET 없음")
        kis = self.cfg.get("kis", {})
        tok = self.ctx.http.post_json(f"{KIS_BASE}/oauth2/tokenP", json={
            "grant_type": "client_credentials", "appkey": appkey, "appsecret": secret})["access_token"]
        headers = {"authorization": f"Bearer {tok}", "appkey": appkey, "appsecret": secret,
                   "tr_id": kis.get("tr_id", "FHPTJ04040000"), "custtype": "P"}
        ymd = session.strftime("%Y%m%d")
        out = {}
        for idx in indices:
            params = {k: str(v).replace("{date}", ymd) for k, v in (kis.get("params", {}).get(idx) or {}).items()}
            data = self.ctx.http.get_json(KIS_BASE + kis.get("path",
                "/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market"),
                params=params, headers=headers)
            if data.get("rt_cd") not in (None, "0"):
                raise ValueError(f"KIS 오류 {data.get('msg_cd')}: {data.get('msg1')}")
            rows = data.get("output") or data.get("output1") or []
            row = next((r for r in rows if r.get("stck_bsop_date") == ymd), rows[0] if rows else None)
            if not row:
                continue
            # 거래대금 단위: 백만원 → 억원
            out[idx] = {
                "name": NAMES[idx],
                "foreign": _num(row.get("frgn_ntby_tr_pbmn")) / 100 if row.get("frgn_ntby_tr_pbmn") else None,
                "institution": _num(row.get("orgn_ntby_tr_pbmn")) / 100 if row.get("orgn_ntby_tr_pbmn") else None,
                "individual": _num(row.get("prsn_ntby_tr_pbmn")) / 100 if row.get("prsn_ntby_tr_pbmn") else None,
                "unit": "억원", "as_of": f"{row.get('stck_bsop_date', ymd)} 장마감",
            }
        return out


def _uniq(sources: list[dict]) -> list[dict]:
    """출처 이름 기준 중복 제거 (항목별 상세 URL 은 각 DataPoint.source_url 에 남아 있음)."""
    seen, out = set(), []
    for s in sources:
        if s["name"] not in seen:
            seen.add(s["name"]); out.append(s)
    return out
