// 파크골프 수첩 서버 (Cloudflare Workers)
//   GET  /health                 연결 확인 (어떤 기능이 켜져 있는지)
//   GET  /weather?lat=..&lon=..  기상청 날씨 (10분 저장)
//   POST /analyze                AI 코치 분석
// 비밀값(wrangler secret): KMA_KEY, ANTHROPIC_API_KEY, APP_PASSCODE
// 일반 설정(wrangler.toml [vars]): ALLOWED_ORIGINS, AI_DAILY_LIMIT
import { kmaWeather } from './kma.js';
import { coach, CoachError, MODEL } from './ai.js';

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': allowed.length ? (ok ? origin : allowed[0]) : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Pass',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    }
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

function sameText(a, b) {
  // 길이·내용 비교 시간을 일정하게
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/* 하루 AI 사용 횟수 (Cloudflare 지역별 저장소라 대략적인 값. 확실한 상한은 Anthropic 콘솔 지출 한도로) */
async function bumpDaily(env, cache) {
  const limit = Number(env.AI_DAILY_LIMIT || 30);
  if (!limit || !cache) return { ok: true };
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const key = new Request(`https://parkgolf.internal/ai-count/${day}`);
  const hit = await cache.match(key);
  const n = hit ? Number(await hit.text()) || 0 : 0;
  if (n >= limit) return { ok: false, n, limit };
  await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'max-age=172800' } }));
  return { ok: true, n: n + 1, limit };
}

export async function handle(req, env, ctx, deps = {}) {
  const url = new URL(req.url);
  const c = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (!c.ok) return json({ error: '허용되지 않은 주소에서 온 요청이에요.' }, 403, c.headers);

  if (url.pathname === '/health') {
    return json({ ok: true, weather: !!env.KMA_KEY, ai: !!env.ANTHROPIC_API_KEY, model: MODEL, passcode: !!env.APP_PASSCODE }, 200, c.headers);
  }
  let pass = req.headers.get('X-App-Pass') || '';
  try { pass = decodeURIComponent(pass); } catch { /* 그대로 비교 */ } // 앱이 한글 비밀번호를 인코딩해서 보냄
  if (env.APP_PASSCODE && !sameText(pass, env.APP_PASSCODE)) {
    return json({ error: '앱 비밀번호가 맞지 않아요. 설정에서 다시 넣어 주세요.' }, 401, c.headers);
  }
  const cache = deps.cache !== undefined ? deps.cache : (typeof caches !== 'undefined' ? caches.default : null);

  if (url.pathname === '/weather' && req.method === 'GET') {
    if (!env.KMA_KEY) return json({ error: '서버에 기상청 키가 없어요.' }, 503, c.headers);
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!(lat > 32 && lat < 39.5 && lon > 124 && lon < 132.5)) return json({ error: '한국 안의 위치만 볼 수 있어요.' }, 400, c.headers);
    const slot = Math.floor(Date.now() / 600000); // 10분 단위
    const key = new Request(`https://parkgolf.internal/wx/${lat.toFixed(2)}/${lon.toFixed(2)}/${slot}`);
    if (cache) { const hit = await cache.match(key); if (hit) return json(await hit.json(), 200, { ...c.headers, 'X-Cache': 'HIT' }); }
    try {
      const data = await kmaWeather({ lat, lon, key: env.KMA_KEY, fetcher: deps.fetch || fetch });
      if (cache) { const put = cache.put(key, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=600' } })); ctx && ctx.waitUntil ? ctx.waitUntil(put) : await put; }
      return json(data, 200, c.headers);
    } catch (e) {
      return json({ error: e.message || '기상청 날씨를 받지 못했어요.' }, 502, c.headers);
    }
  }

  if (url.pathname === '/analyze' && req.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY) return json({ error: '서버에 AI 키가 없어요.' }, 503, c.headers);
    const raw = await req.text();
    if (raw.length > 60000) return json({ error: '보낸 기록이 너무 커요.' }, 413, c.headers);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: '요청 형식이 달라요.' }, 400, c.headers); }
    if (env.AI_LIMITER) {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.AI_LIMITER.limit({ key: ip });
      if (!success) return json({ error: '잠깐 쉬었다가 다시 눌러 주세요.' }, 429, c.headers);
    }
    const day = await bumpDaily(env, cache);
    if (!day.ok) return json({ error: `오늘 AI 분석을 ${day.limit}번 다 썼어요. 내일 다시 해 주세요.` }, 429, c.headers);
    try {
      const out = await coach(body, { apiKey: env.ANTHROPIC_API_KEY, fetch: deps.anthropicFetch });
      return json(out, 200, c.headers);
    } catch (e) {
      if (e instanceof CoachError) return json({ error: e.message }, e.status, c.headers);
      return json({ error: 'AI 분석 중 문제가 생겼어요.' }, 500, c.headers);
    }
  }
  return json({ error: '없는 주소예요.' }, 404, c.headers);
}

export default { fetch: (req, env, ctx) => handle(req, env, ctx) };
