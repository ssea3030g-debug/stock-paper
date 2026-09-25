// Cloudflare Pages Function: /api/quote?market=KR|US&code=005930
// Yahoo Finance 공개 차트 API를 대신 호출해 최신 종가·전일비만 돌려준다 (개인적·비상업적 용도).
// 브라우저는 CORS 때문에 Yahoo 를 직접 못 불러서, 이 프록시로 앱을 여는 동안 시세를 자주 새로 받는다.
const YF = "https://query1.finance.yahoo.com/v8/finance/chart/";

function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { "content-type": "application/json", "cache-control": "public, max-age=15" } }, init));
}
function err(status, code) {
  return new Response(JSON.stringify({ code }), { status, headers: { "content-type": "application/json" } });
}

async function tryQuote(symbol) {
  const r = await fetch(YF + encodeURIComponent(symbol) + "?range=5d&interval=1d", {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.indicators || !res.indicators.quote || !res.indicators.quote[0]) return null;
  const closes = res.indicators.quote[0].close || [];
  const timestamps = res.timestamp || [];
  const valid = [];
  for (let i = 0; i < closes.length; i++) if (closes[i] != null) valid.push(i);
  if (!valid.length) return null;
  const last = valid[valid.length - 1];
  const prevIdx = valid.length > 1 ? valid[valid.length - 2] : -1;
  const value = closes[last];
  const prev = prevIdx >= 0 ? closes[prevIdx] : null;
  const change = prev != null ? value - prev : null;
  return {
    value: value,
    change: change,
    change_pct: prev ? (change / prev) * 100 : null,
    currency: (res.meta && res.meta.currency) || null,
    as_of: timestamps[last] ? new Date(timestamps[last] * 1000).toISOString() : null,
    symbol: symbol,
    source: "Yahoo Finance",
  };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const market = (url.searchParams.get("market") || "").toUpperCase();
  const code = (url.searchParams.get("code") || "").toUpperCase().slice(0, 20);
  if (!code || !/^[A-Z0-9.\-]{1,20}$/.test(code)) return err(400, "bad_request");
  const symbols = market === "KR" ? [code + ".KS", code + ".KQ"] : [code.replace(/\./g, "-")];   // Yahoo 는 BRK.B 대신 BRK-B
  for (const sym of symbols) {
    try {
      const q = await tryQuote(sym);
      if (q) return json(q);
    } catch (e) {
      // 다음 접미사로 시도
    }
  }
  return err(404, "not_found");
}
