// Cloudflare Pages Function: /api/history?market=KR|US&code=005930&range=1mo|3mo|1y
// 시세 그래프용 일별 종가. Yahoo Finance 공개 차트 API (지연 시세, 개인적·비상업적 용도).
// Finnhub 무료 요금제에는 과거 시세(candle)가 없어서 Yahoo 를 쓴다.
const YF = "https://query1.finance.yahoo.com/v8/finance/chart/";
const RANGES = { "1mo": "1d", "3mo": "1d", "1y": "1d" };

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } });
}

async function series(symbol, range) {
  const r = await fetch(YF + encodeURIComponent(symbol) + "?range=" + range + "&interval=" + RANGES[range],
    { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  const q = res && res.indicators && res.indicators.quote && res.indicators.quote[0];
  if (!res || !q || !res.timestamp) return null;
  const pts = [];
  res.timestamp.forEach((t, i) => { if (q.close[i] != null) pts.push([t, q.close[i]]); });
  if (pts.length < 2) return null;
  return { symbol: symbol, currency: (res.meta && res.meta.currency) || null, points: pts, source: "Yahoo Finance · 지연" };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const market = (url.searchParams.get("market") || "").toUpperCase();
  const code = (url.searchParams.get("code") || "").toUpperCase().slice(0, 20);
  const range = url.searchParams.get("range") || "3mo";
  if (!RANGES[range] || !/^[A-Z0-9.\-]{1,20}$/.test(code) || !["KR", "US"].includes(market)) {
    return json({ code: "bad_request" }, 400);
  }
  const symbols = market === "KR" ? [code + ".KS", code + ".KQ"] : [code.replace(/\./g, "-")];
  for (const s of symbols) {
    try {
      const d = await series(s, range);
      if (d) return json(d);
    } catch (e) {
      // 다음 접미사
    }
  }
  return json({ code: "not_found" }, 404);
}
