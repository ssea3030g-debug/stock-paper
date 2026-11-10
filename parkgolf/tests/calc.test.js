// 실행: node --test parkgolf/tests
const test = require('node:test');
const assert = require('node:assert');
const PG = require('../analysis.js');
const WX = require('../weather.js');

const P = PG.DEFAULT_PARS;
const mkRound = (id, date, strokesA, strokesB, extra) => Object.assign({
  id, date, kind: '대회', courseId: 'c1', courseName: '테스트',
  sections: [{ name: 'A', pars: [...P], strokes: strokesA }, { name: 'B', pars: [...P], strokes: strokesB }]
}, extra || {});

test('라운드 합계', () => {
  const r = mkRound('r1', '2026-10-01', [3, 4, 3, 4, 5, 3, 4, 3, 4], [4, 5, 3, 4, 6, 3, 4, 3, 4]);
  const t = PG.roundTotals(r);
  assert.deepStrictEqual([t.strokes, t.par, t.diff, t.holes], [69, 66, 3, 18]);
  assert.strictEqual(t.per9, 1.5);
});

test('합계만 입력한 라운드', () => {
  const r = { id: 'x', date: '2026-10-01', sections: [{ name: 'A', pars: [...P], strokes: null, total: 36 }] };
  assert.strictEqual(PG.roundTotals(r).diff, 3);
  const a = PG.analyzeRound(r, [r], null);
  assert.ok(a.good.length && a.improve.length && a.practice.length);
});

test('스코어 이름', () => {
  assert.strictEqual(PG.scoreName(1, 3), '홀인원');
  assert.strictEqual(PG.scoreName(2, 3), '버디');
  assert.strictEqual(PG.scoreName(5, 3), '더블보기');
});

test('후반 약세와 바람 분석', () => {
  const hist = [mkRound('h1', '2026-09-01', [...P], [...P]), mkRound('h2', '2026-09-10', [...P], [...P])];
  const r = mkRound('r', '2026-10-01', [...P], P.map(p => p + 1), { weather: { tMax: 18, wind: 6, windMax: 9, precip: 0 } });
  const a = PG.analyzeRound(r, [...hist, r], { features: { river: true } });
  const titles = a.improve.map(x => x.t).join('|');
  assert.match(titles, /뒤로 갈수록/);
  assert.match(titles, /바람/);
  assert.ok(a.factors.some(f => f.includes('강가')));
});

test('파 종류 약점', () => {
  const s = P.map(p => (p === 3 ? 5 : p));
  const r = mkRound('r', '2026-10-01', s, s);
  const a = PG.analyzeRound(r, [r], null);
  assert.ok(a.improve.some(x => x.t === '파3 홀이 약했어요'));
});

test('전체 분석', () => {
  const rs = [1, 2, 3, 4, 5].map(i => mkRound('r' + i, `2026-0${i}-01`, P.map(p => p + (i < 3 ? 1 : 0)), [...P]));
  const a = PG.analyzeOverall(rs, []);
  assert.strictEqual(a.count, 5);
  assert.ok(a.style.length > 0);
  assert.ok(a.good.some(g => g.t === '실력이 늘고 있어요'));
});

test('타당 정산: 합이 0, 타수 차이 × 점당', () => {
  const bet = { players: ['나', '영희', '철수'], unit: 1000, mode: 'stroke', pars: [3, 4], totalsOnly: true, totals: { 나: 70, 영희: 73, 철수: 72 } };
  const s = PG.settleBet(bet);
  assert.deepStrictEqual(s.money, { 나: 5000, 영희: -4000, 철수: -1000 });
  assert.strictEqual(Object.values(s.money).reduce((a, b) => a + b, 0), 0);
  assert.deepStrictEqual(s.ranking, ['나', '철수', '영희']);
  const sum = s.transfers.reduce((a, t) => a + t.amount, 0);
  assert.strictEqual(sum, 5000);
});

test('홀 이기기 + 이월 + 버디 보너스', () => {
  const bet = { players: ['A', 'B'], unit: 500, mode: 'hole', carry: true, bonus: true, pars: [3, 4, 3], totalsOnly: false,
    scores: { A: [3, 4, 2], B: [3, 5, 3] } };
  const s = PG.settleBet(bet);
  // 1홀 비김(이월) → 2홀 A 승 2점 → 3홀 A 승 1점 + A 버디 1점 = A +4점
  assert.strictEqual(s.points.A, 4);
  assert.strictEqual(s.money.B, -2000);
  assert.deepStrictEqual(s.transfers, [{ from: 'B', to: 'A', amount: 2000 }]);
});

test('입력 안 한 홀은 빼고 계산', () => {
  const bet = { players: ['A', 'B'], unit: 100, mode: 'stroke', pars: [3, 4], totalsOnly: false, scores: { A: [3, null], B: [5, 4] } };
  const s = PG.settleBet(bet);
  assert.strictEqual(s.holesDone, 1);
  assert.strictEqual(s.money.A, 200);
});

test('미세먼지 등급과 운영 판단', () => {
  assert.strictEqual(WX.pmGrade(20, 10).name, '좋음');
  assert.strictEqual(WX.pmGrade(90, 10).name, '나쁨');
  const monday = new Date('2026-11-09T10:00:00');
  const st = WX.assessStatus({ info: { closedDays: [1] }, features: {} }, { current: { weather_code: 0, precipitation: 0, wind_speed_10m: 2, wind_gusts_10m: 4, apparent_temperature: 15, temperature_2m: 15 }, daily: { precipitation_sum: [0, 0] } }, null, monday);
  assert.strictEqual(st.level, 2);
  const rainy = WX.assessStatus({ features: { river: true } }, { current: { weather_code: 3, precipitation: 0, wind_speed_10m: 2, wind_gusts_10m: 4, apparent_temperature: 15, temperature_2m: 15 }, daily: { precipitation_sum: [25, 20] } }, null, monday);
  assert.strictEqual(rainy.level, 2);
});

test('기상청 자료 합치기: 지금·시간별은 덮고, 해 뜨는 시간·지난 비는 유지', () => {
  const om = {
    current: { temperature_2m: 10, apparent_temperature: 8, precipitation: 0, weather_code: 0, wind_speed_10m: 2, wind_gusts_10m: 5 },
    hourly: { time: ['2026-11-10T09:00', '2026-11-10T10:00'], temperature_2m: [9, 10], precipitation_probability: [0, 0], precipitation: [0, 0], weather_code: [0, 0], wind_speed_10m: [2, 2], uv_index: [1, 2] },
    daily: { time: ['2026-11-08', '2026-11-10', '2026-11-11'], precipitation_sum: [30, 0, 0], sunrise: ['a', 'b', 'c'], weather_code: [0, 0, 0], temperature_2m_max: [1, 2, 3], temperature_2m_min: [0, 0, 0], precipitation_probability_max: [0, 0, 0] }
  };
  const k = {
    current: { temperature_2m: 12, precipitation: 0, weather_code: 102, wind_speed_10m: 3, relative_humidity_2m: 40 },
    hourly: { time: ['2026-11-10T10:00'], temperature_2m: [13], precipitation_probability: [20], precipitation: [0], weather_code: [102], wind_speed_10m: [3] },
    daily: { time: ['2026-11-10', '2026-11-11'], weather_code: [102, 63], temperature_2m_max: [99, 15], temperature_2m_min: [99, 5], precipitation_probability_max: [20, 70] }
  };
  const w = WX.mergeKma(om, k, new Date('2026-11-10T10:30:00'));
  assert.strictEqual(w.source, 'kma');
  assert.strictEqual(w.current.temperature_2m, 12);
  assert.strictEqual(w.current.apparent_temperature, 10);
  assert.deepStrictEqual(w.hourly.temperature_2m, [9, 13]);
  assert.strictEqual(w.daily.precipitation_sum[0], 30);
  assert.strictEqual(w.daily.temperature_2m_max[1], 2, '오늘 최고기온은 Open-Meteo 유지');
  assert.strictEqual(w.daily.temperature_2m_max[2], 15);
  assert.strictEqual(w.daily.weather_code[2], 63);
  assert.strictEqual(WX.wxName(102), '구름 많음');
  const only = WX.mergeKma(null, k);
  assert.strictEqual(only.current.apparent_temperature, 12);
  assert.strictEqual(WX.mergeKma(om, null), om);
});
