// 기상청 단기예보 조회서비스 (공공데이터포털, VilageFcstInfoService_2.0)
// - 초단기실황(getUltraSrtNcst): 지금 기온·강수·습도·바람
// - 단기예보(getVilageFcst): 시간별 기온·강수확률·하늘·바람, 오늘~3일 뒤
// 앱이 쓰는 Open-Meteo 와 같은 모양(current / hourly / daily)으로 바꿔서 돌려준다.

const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

/* 위도·경도 → 기상청 격자(nx, ny). 기상청 공식 람베르트 투영 공식 */
export function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID, slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

const pad = n => String(n).padStart(2, '0');
/* 한국 시간 기준 날짜·시각 (Workers 는 UTC 로 돈다) */
export function kst(date = new Date()) {
  const d = new Date(date.getTime() + 9 * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), ymd: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` };
}
const ymdOf = t => `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;

/* 초단기실황: 매시 정각 자료가 40분쯤 나옴 */
export function ncstBase(now = new Date()) {
  let t = new Date(now.getTime() + 9 * 3600000);
  if (t.getUTCMinutes() < 40) t = new Date(t.getTime() - 3600000);
  return { base_date: ymdOf(t), base_time: `${pad(t.getUTCHours())}00` };
}

/* 단기예보: 02·05·08·11·14·17·20·23시 발표, 10분 뒤부터 받을 수 있음 */
export function fcstBase(now = new Date()) {
  const t = new Date(now.getTime() + 9 * 3600000);
  const mins = t.getUTCHours() * 60 + t.getUTCMinutes();
  const hours = [2, 5, 8, 11, 14, 17, 20, 23].filter(h => mins >= h * 60 + 10);
  if (hours.length) return { base_date: ymdOf(t), base_time: `${pad(hours[hours.length - 1])}00` };
  const y = new Date(t.getTime() - 86400000);
  return { base_date: ymdOf(y), base_time: '2300' };
}

/* "강수없음", "1mm 미만", "30.0~50.0mm", "50.0mm 이상" → 숫자(mm) */
export function parseRain(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s || s === '강수없음' || s === '적설없음' || s === '-' ) return 0;
  if (s.includes('미만')) return 0.5;
  const range = s.match(/([\d.]+)\s*~\s*([\d.]+)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > -900 ? n : 0;
}

/* 기상청 하늘상태·강수형태 → 앱이 쓰는 날씨 코드 (WMO 코드, 102 = 구름 많음, 68 = 비/눈) */
export function toCode(pty, sky) {
  switch (Number(pty)) {
    case 1: return 63;   // 비
    case 2: return 68;   // 비/눈
    case 3: return 73;   // 눈
    case 4: return 81;   // 소나기
    case 5: return 51;   // 빗방울
    case 6: return 68;   // 빗방울·눈날림
    case 7: return 71;   // 눈날림
  }
  if (Number(sky) === 4) return 3;   // 흐림
  if (Number(sky) === 3) return 102; // 구름 많음
  return 0;                          // 맑음
}

async function call(fetcher, key, op, params) {
  const q = new URLSearchParams({ serviceKey: key, pageNo: '1', numOfRows: params.numOfRows || '1000', dataType: 'JSON', ...params });
  const r = await fetcher(`${BASE}/${op}?${q}`);
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch {
    // 키가 틀리면 XML 오류가 옴 (SERVICE_KEY_IS_NOT_REGISTERED_ERROR 등)
    const m = text.match(/<returnAuthMsg>([^<]+)</) || text.match(/<resultMsg>([^<]+)</);
    throw new Error(`기상청 응답 오류: ${m ? m[1] : r.status}`);
  }
  const h = j.response && j.response.header;
  if (!h || h.resultCode !== '00') throw new Error(`기상청 응답 오류: ${h ? h.resultCode + ' ' + h.resultMsg : '형식 다름'}`);
  return (j.response.body && j.response.body.items && j.response.body.items.item) || [];
}

/* 날씨 한 번에: 실황 + 단기예보 → Open-Meteo 모양 */
export async function kmaWeather({ lat, lon, key, fetcher = fetch, now = new Date() }) {
  const { nx, ny } = toGrid(lat, lon);
  const nb = ncstBase(now), fb = fcstBase(now);
  const [ncst, fcst] = await Promise.all([
    call(fetcher, key, 'getUltraSrtNcst', { ...nb, nx, ny, numOfRows: '60' }).catch(() => []),
    call(fetcher, key, 'getVilageFcst', { ...fb, nx, ny, numOfRows: '1500' })
  ]);

  // 시간별 묶기
  const byTime = new Map();
  const daily = new Map();
  for (const it of fcst) {
    const t = `${it.fcstDate.slice(0, 4)}-${it.fcstDate.slice(4, 6)}-${it.fcstDate.slice(6, 8)}T${it.fcstTime.slice(0, 2)}:00`;
    if (!byTime.has(t)) byTime.set(t, {});
    byTime.get(t)[it.category] = it.fcstValue;
    if (it.category === 'TMX' || it.category === 'TMN') {
      const day = t.slice(0, 10);
      if (!daily.has(day)) daily.set(day, {});
      daily.get(day)[it.category] = Number(it.fcstValue);
    }
  }
  const times = [...byTime.keys()].sort();
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [], relative_humidity_2m: [] };
  for (const t of times) {
    const v = byTime.get(t);
    if (v.TMP == null) continue;
    hourly.time.push(t);
    hourly.temperature_2m.push(Number(v.TMP));
    hourly.precipitation_probability.push(v.POP != null ? Number(v.POP) : null);
    hourly.precipitation.push(parseRain(v.PCP));
    hourly.weather_code.push(toCode(v.PTY, v.SKY));
    hourly.wind_speed_10m.push(v.WSD != null ? Number(v.WSD) : null);
    hourly.relative_humidity_2m.push(v.REH != null ? Number(v.REH) : null);
  }
  // 날짜별: 최고·최저(TMX/TMN 우선, 없으면 시간별에서 계산), 강수확률 최대, 가장 궂은 날씨
  const days = [...new Set(hourly.time.map(t => t.slice(0, 10)))];
  const D = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], precipitation_sum: [], weather_code: [], wind_speed_10m_max: [] };
  const severity = c => (c === 0 ? 0 : c === 102 ? 1 : c === 3 ? 2 : 10 + c);
  for (const day of days) {
    const idx = hourly.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(day)).map(([, i]) => i);
    const temps = idx.map(i => hourly.temperature_2m[i]);
    const dd = daily.get(day) || {};
    const daytime = idx.filter(i => { const h = Number(hourly.time[i].slice(11, 13)); return h >= 6 && h <= 18; });
    const codes = (daytime.length ? daytime : idx).map(i => hourly.weather_code[i]);
    D.time.push(day);
    D.temperature_2m_max.push(dd.TMX != null && dd.TMX > -900 ? dd.TMX : Math.max(...temps));
    D.temperature_2m_min.push(dd.TMN != null && dd.TMN > -900 ? dd.TMN : Math.min(...temps));
    D.precipitation_probability_max.push(Math.max(0, ...idx.map(i => hourly.precipitation_probability[i] || 0)));
    D.precipitation_sum.push(Math.round(idx.reduce((s, i) => s + hourly.precipitation[i], 0) * 10) / 10);
    D.weather_code.push(codes.reduce((a, b) => (severity(b) > severity(a) ? b : a), 0));
    D.wind_speed_10m_max.push(Math.max(0, ...idx.map(i => hourly.wind_speed_10m[i] || 0)));
  }

  // 지금: 실황 값, 하늘상태는 지금 시각 예보에서
  const n = {}; for (const it of ncst) n[it.category] = it.obsrValue;
  const k = kst(now);
  const nowKey = `${k.y}-${pad(k.m)}-${pad(k.d)}T${pad(k.h)}:00`;
  const nearest = hourly.time.find(t => t >= nowKey) || hourly.time[0];
  const ni = hourly.time.indexOf(nearest);
  const temp = n.T1H != null ? Number(n.T1H) : (ni >= 0 ? hourly.temperature_2m[ni] : null);
  const wind = n.WSD != null ? Number(n.WSD) : (ni >= 0 ? hourly.wind_speed_10m[ni] : null);
  const fcstSky = ni >= 0 ? byTime.get(nearest).SKY : null;
  const current = {
    time: nowKey,
    temperature_2m: temp,
    precipitation: parseRain(n.RN1),
    relative_humidity_2m: n.REH != null ? Number(n.REH) : null,
    wind_speed_10m: wind,
    weather_code: toCode(n.PTY != null ? n.PTY : (ni >= 0 ? byTime.get(nearest).PTY : 0), fcstSky),
    observed: ncst.length > 0
  };
  return { source: 'kma', grid: { nx, ny }, base: { ncst: nb, fcst: fb }, current, hourly, daily: D };
}
