// Cloudflare Pages Function: /api/quote?market=KR|US|FX&code=005930
// 앱을 여는 동안 시세를 자주 새로 받는 프록시 (브라우저는 CORS·키 때문에 직접 못 부름).
// - 미국 종목: Finnhub 공식 API (Pages 암호화 변수 FINNHUB_API_KEY 가 있을 때). 없거나 실패하면 Yahoo
// - 국내 종목·원/달러 환율: Yahoo Finance 공개 차트 API (지연 시세, 개인적·비상업적 용도)
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
    source: "Yahoo Finance · 지연",
  };
}

async function finnhubQuote(code, key) {
  const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(code) + "&token=" + encodeURIComponent(key));
  if (!r.ok) return null;
  const q = await r.json().catch(() => null);
  if (!q || !q.c || !q.t) return null;
  return { value: q.c, change: q.d, change_pct: q.dp, currency: "USD", as_of: new Date(q.t * 1000).toISOString(),
           symbol: code, source: "Finnhub" };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const market = (url.searchParams.get("market") || "").toUpperCase();
  const code = (url.searchParams.get("code") || "").toUpperCase().slice(0, 20);
  if (!code || !/^[A-Z0-9.\-]{1,20}$/.test(code)) return err(400, "bad_request");
  if (market === "FX" && code !== "USDKRW") return err(400, "bad_request");
  if (market === "US" && env && env.FINNHUB_API_KEY) {
    try {
      const q = await finnhubQuote(code, env.FINNHUB_API_KEY);
      if (q) return json(q);
    } catch (e) {
      // Yahoo 로 대신
    }
  }
  const symbols = market === "FX" ? ["KRW=X"]                                    // 원/달러 환율
    : market === "KR" ? [code + ".KS", code + ".KQ"] : [code.replace(/\./g, "-")];   // Yahoo 는 BRK.B 대신 BRK-B
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
