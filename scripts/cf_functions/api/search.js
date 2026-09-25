// Cloudflare Pages Function: /api/search?q=netflix
// Yahoo Finance 공개 검색 API 로 영어 이름·티커에 맞는 종목 후보를 찾는다 (한글 이름은 Yahoo 가 받지 않음).
// 돌려주는 값: [{market: "US"|"KR", code, name, exchange}] — 미국 상장 주식·ETF 와 코스피·코스닥만.
const YS = "https://query1.finance.yahoo.com/v1/finance/search";
const TYPES = new Set(["EQUITY", "ETF"]);

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function toCandidate(q) {
  const sym = String(q.symbol || "");
  const name = q.shortname || q.longname || sym;
  if (!TYPES.has(q.quoteType)) return null;
  let m = sym.match(/^(\d{6})\.(KS|KQ)$/);
  if (m) return { market: "KR", code: m[1], name: name, exchange: m[2] === "KS" ? "코스피" : "코스닥" };
  if (sym.includes(".")) return null;                       // 다른 나라 거래소(예: .F, .L)
  m = sym.match(/^([A-Z]{1,5})-([A-Z])$/);                   // 클래스 주식: Yahoo BRK-B → BRK.B
  const code = m ? m[1] + "." + m[2] : sym;
  if (!/^[A-Z][A-Z.]{0,6}$/.test(code)) return null;
  return { market: "US", code: code, name: name, exchange: q.exchDisp || q.exchange || "미국" };
}

export async function onRequestGet({ request }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&,'\-]{0,39}$/.test(q)) return json([]);
  try {
    const r = await fetch(YS + "?q=" + encodeURIComponent(q) + "&quotesCount=10&newsCount=0&listsCount=0",
      { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) return json([]);
    const j = await r.json();
    const out = [];
    for (const x of j.quotes || []) {
      const c = toCandidate(x);
      if (c && !out.some((o) => o.market === c.market && o.code === c.code)) out.push(c);
      if (out.length >= 6) break;
    }
    return json(out);
  } catch (e) {
    return json([]);
  }
}
