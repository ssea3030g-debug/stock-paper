// 실행: npm test   (인터넷·키 없이 가짜 응답으로 시험)
import test from 'node:test';
import assert from 'node:assert';
import { toGrid, fcstBase, ncstBase, parseRain, toCode, kmaWeather } from '../src/kma.js';
import { handle } from '../src/index.js';
import { buildPrompt, SCHEMA } from '../src/ai.js';

test('격자 변환: 서울시청 = (60, 127), 부산 = (98, 76)', () => {
  assert.deepStrictEqual(toGrid(37.5665, 126.978), { nx: 60, ny: 127 });
  assert.deepStrictEqual(toGrid(35.1796, 129.0756), { nx: 98, ny: 76 });
});

test('발표 시각 고르기 (한국 시간)', () => {
  assert.deepStrictEqual(fcstBase(new Date('2026-11-10T01:05:00+09:00')), { base_date: '20261109', base_time: '2300' });
  assert.deepStrictEqual(fcstBase(new Date('2026-11-10T05:09:00+09:00')), { base_date: '20261110', base_time: '0200' });
  assert.deepStrictEqual(fcstBase(new Date('2026-11-10T05:10:00+09:00')), { base_date: '20261110', base_time: '0500' });
  assert.deepStrictEqual(ncstBase(new Date('2026-11-10T00:20:00+09:00')), { base_date: '20261109', base_time: '2300' });
  assert.deepStrictEqual(ncstBase(new Date('2026-11-10T09:45:00+09:00')), { base_date: '20261110', base_time: '0900' });
});

test('강수량 글자 읽기, 날씨 코드', () => {
  assert.strictEqual(parseRain('강수없음'), 0);
  assert.strictEqual(parseRain('1mm 미만'), 0.5);
  assert.strictEqual(parseRain('30.0~50.0mm'), 40);
  assert.strictEqual(parseRain('50.0mm 이상'), 50);
  assert.strictEqual(parseRain('2.5mm'), 2.5);
  assert.strictEqual(toCode(0, 1), 0); assert.strictEqual(toCode(0, 3), 102); assert.strictEqual(toCode(1, 4), 63);
});

function fakeKma(url) {
  const u = new URL(url);
  const op = u.pathname.split('/').pop();
  let item;
  if (op === 'getUltraSrtNcst') item = [['T1H', '12.3'], ['RN1', '0'], ['REH', '55'], ['WSD', '2.1'], ['PTY', '0']].map(([category, obsrValue]) => ({ category, obsrValue }));
  else {
    item = [];
    for (const [d, hs] of [['20261110', [10, 11, 12, 13, 14, 15]], ['20261111', [9, 12, 15]]]) for (const h of hs) {
      const t = String(h).padStart(2, '0') + '00';
      const rainy = d === '20261111' && h === 12;
      item.push(...[['TMP', String(h)], ['POP', rainy ? '70' : '10'], ['PTY', rainy ? '1' : '0'], ['SKY', rainy ? '4' : '3'], ['WSD', '3'], ['PCP', rainy ? '1.0mm' : '강수없음'], ['REH', '50']].map(([category, fcstValue]) => ({ category, fcstValue, fcstDate: d, fcstTime: t })));
    }
    item.push({ category: 'TMX', fcstValue: '16.0', fcstDate: '20261111', fcstTime: '1500' });
  }
  assert.ok(u.searchParams.get('serviceKey'));
  return new Response(JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item } } } }));
}

test('기상청 응답 → 앱 모양', async () => {
  const w = await kmaWeather({ lat: 37.51, lon: 126.99, key: 'k', fetcher: async u => fakeKma(u), now: new Date('2026-11-10T10:50:00+09:00') });
  assert.strictEqual(w.current.temperature_2m, 12.3);
  assert.strictEqual(w.current.weather_code, 102);
  assert.strictEqual(w.hourly.time[0], '2026-11-10T10:00');
  assert.deepStrictEqual(w.daily.time, ['2026-11-10', '2026-11-11']);
  assert.strictEqual(w.daily.temperature_2m_max[1], 16);
  assert.strictEqual(w.daily.precipitation_probability_max[1], 70);
  assert.strictEqual(w.daily.weather_code[1], 63);
});

test('키 오류는 알아듣게', async () => {
  const bad = async () => new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>');
  await assert.rejects(kmaWeather({ lat: 37.5, lon: 127, key: 'x', fetcher: bad }), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
});

const env = { KMA_KEY: 'k', ANTHROPIC_API_KEY: 'sk-test', APP_PASSCODE: '1234', ALLOWED_ORIGINS: 'https://me.github.io', AI_DAILY_LIMIT: '2' };
const req = (path, opts = {}) => new Request('https://srv.example' + path, { ...opts, headers: { Origin: 'https://me.github.io', 'X-App-Pass': '1234', ...(opts.headers || {}) } });
function memCache() { const m = new Map(); return { match: async r => (m.has(r.url) ? new Response(m.get(r.url)) : undefined), put: async (r, res) => { m.set(r.url, await res.text()); } }; }

test('주소·비밀번호 검사', async () => {
  let r = await handle(req('/weather?lat=37.5&lon=127', { headers: { Origin: 'https://evil.example' } }), env, null, { cache: null });
  assert.strictEqual(r.status, 403);
  r = await handle(req('/weather?lat=37.5&lon=127', { headers: { 'X-App-Pass': 'nope' } }), env, null, { cache: null });
  assert.strictEqual(r.status, 401);
  r = await handle(req('/weather?lat=10&lon=10', { headers: { 'X-App-Pass': encodeURIComponent('할머니1234') } }), { ...env, APP_PASSCODE: '할머니1234' }, null, { cache: null });
  assert.strictEqual(r.status, 400, '한글 비밀번호도 통과');
  r = await handle(req('/health'), env, null, { cache: null });
  assert.deepStrictEqual((await r.json()).ai, true);
  r = await handle(req('/weather?lat=10&lon=10'), env, null, { cache: null });
  assert.strictEqual(r.status, 400);
});

test('날씨는 10분 저장', async () => {
  let calls = 0;
  const cache = memCache();
  const f = async u => { calls++; return fakeKma(u); };
  const r1 = await handle(req('/weather?lat=37.51&lon=126.99'), env, null, { cache, fetch: f });
  assert.strictEqual(r1.status, 200);
  const r2 = await handle(req('/weather?lat=37.51&lon=126.99'), env, null, { cache, fetch: f });
  assert.strictEqual(r2.headers.get('X-Cache'), 'HIT');
  assert.strictEqual(calls, 2); // 실황 + 예보 각 1번만
});

test('AI 분석: 요청 모양, 결과, 하루 한도', async () => {
  let sent;
  const answer = { summary: '좋았어요', good: [{ title: 'a', detail: 'b' }], improve: [{ title: 'c', detail: 'd' }], practice: [{ title: 'e', detail: 'f' }], encouragement: '힘내세요' };
  const anthropicFetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) };
    return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 1000, output_tokens: 500 } }), { headers: { 'content-type': 'application/json' } });
  };
  const cache = memCache();
  const body = JSON.stringify({ mode: 'round', round: { date: '2026-10-20', sections: [{ name: 'A', pars: [3, 4], strokes: [3, 5] }], memo: 'x'.repeat(1000) }, history: [] });
  const r = await handle(req('/analyze', { method: 'POST', body }), env, null, { cache, anthropicFetch });
  assert.strictEqual(r.status, 200);
  const out = await r.json();
  assert.strictEqual(out.summary, '좋았어요');
  assert.strictEqual(sent.body.model, 'claude-opus-5-5');
  assert.strictEqual(sent.body.fallbacks, 'default');
  assert.match(sent.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.strictEqual(sent.body.output_config.format.type, 'json_schema');
  assert.ok(!('thinking' in sent.body));
  assert.ok(sent.body.messages[0].content.length < 2000, '메모는 300자로 잘림');
  await handle(req('/analyze', { method: 'POST', body }), env, null, { cache, anthropicFetch });
  const r3 = await handle(req('/analyze', { method: 'POST', body }), env, null, { cache, anthropicFetch });
  assert.strictEqual(r3.status, 429);
});

test('AI 거절은 알아듣게', async () => {
  const anthropicFetch = async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }), { headers: { 'content-type': 'application/json' } });
  const r = await handle(req('/analyze', { method: 'POST', body: '{"mode":"overall"}' }), env, null, { cache: null, anthropicFetch });
  assert.strictEqual(r.status, 422);
});

test('구조화 출력 스키마는 모든 칸이 필수', () => {
  assert.deepStrictEqual(SCHEMA.required.sort(), Object.keys(SCHEMA.properties).sort());
  assert.match(buildPrompt({ mode: 'overall', overall: { count: 3 } }), /플레이 스타일/);
});
