/* 파크골프 수첩 — 날씨·대기질·골프장 검색
 * 모두 무료·키 없는 공개 서비스 사용:
 *   날씨  : Open-Meteo (기상청·유럽 모델 기반 예보, 과거 기록)
 *   대기질: Open-Meteo Air Quality (미세먼지 PM10, 초미세먼지 PM2.5)
 *   검색  : OpenStreetMap Nominatim(이름 검색), Overpass(내 주변 찾기)
 */
(function (root) {
  'use strict';

  const WMO = {
    0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
    45: ['안개', '🌫️'], 48: ['안개', '🌫️'],
    51: ['이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['이슬비', '🌦️'], 56: ['어는 비', '🌧️'], 57: ['어는 비', '🌧️'],
    61: ['약한 비', '🌧️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'], 66: ['어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
    71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['많은 눈', '❄️'], 77: ['싸락눈', '🌨️'],
    80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'], 85: ['눈 소나기', '🌨️'], 86: ['눈 소나기', '❄️'],
    95: ['천둥번개', '⛈️'], 96: ['천둥번개·우박', '⛈️'], 99: ['천둥번개·우박', '⛈️'],
    68: ['비 또는 눈', '🌨️'], 102: ['구름 많음', '⛅'] // 기상청 전용 (WMO 에 없음)
  };
  const wxName = c => (WMO[c] || ['-', '🌡️'])[0];
  const wxIcon = c => (WMO[c] || ['-', '🌡️'])[1];
  const isRainCode = c => (c >= 51 && c <= 68) || (c >= 80 && c <= 82);
  const isSnowCode = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const isStormCode = c => c >= 95;

  const pad = n => String(n).padStart(2, '0');
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  async function getJSON(url, opts) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    try {
      const r = await fetch(url, Object.assign({ signal: ctrl && ctrl.signal }, opts || {}));
      if (!r.ok) throw new Error('응답 ' + r.status);
      return await r.json();
    } finally { if (timer) clearTimeout(timer); }
  }

  /* 특정 날짜(경기한 날)의 날씨 — 오전 8시~오후 2시 기준 */
  async function dayWeather(lat, lon, date) {
    const daysAgo = (Date.now() - new Date(date + 'T12:00:00+09:00').getTime()) / 86400000;
    const base = daysAgo > 80 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, start_date: date, end_date: date, timezone: 'Asia/Seoul', wind_speed_unit: 'ms',
      hourly: 'temperature_2m,precipitation,wind_speed_10m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code'
    });
    const j = await getJSON(`${base}?${q}`);
    const H = j.hourly || {}; const D = j.daily || {};
    const idx = (H.time || []).map((t, i) => [Number(t.slice(11, 13)), i]).filter(([h]) => h >= 8 && h <= 14).map(([, i]) => i);
    const pick = k => idx.map(i => H[k] && H[k][i]).filter(v => v != null);
    const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    const codes = pick('weather_code');
    const worst = codes.length ? Math.max(...codes) : (D.weather_code || [])[0];
    const out = {
      source: 'auto', tAvg: r1(mean(pick('temperature_2m'))), tMax: r1((D.temperature_2m_max || [])[0]), tMin: r1((D.temperature_2m_min || [])[0]),
      precip: r1((pick('precipitation').reduce((s, x) => s + x, 0))), precipDay: r1((D.precipitation_sum || [])[0]),
      wind: r1(mean(pick('wind_speed_10m'))), windMax: r1((D.wind_speed_10m_max || [])[0]), code: worst
    };
    if (out.tAvg == null && out.tMax == null) throw new Error('날씨 기록이 없습니다');
    return out;
  }
  function r1(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10; }

  /* 지금 날씨 + 3일 예보 + 지난 이틀 비 */
  async function nowWeather(lat, lon) {
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: 'Asia/Seoul', wind_speed_unit: 'ms', past_days: 2, forecast_days: 4,
      current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max'
    });
    return getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  }

  async function airQuality(lat, lon) {
    const q = new URLSearchParams({ latitude: lat, longitude: lon, timezone: 'Asia/Seoul', current: 'pm10,pm2_5' });
    return getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`);
  }

  /* 환경부 기준 미세먼지 등급 */
  function pmGrade(pm10, pm25) {
    const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
    const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
    const g = Math.max(g10, g25);
    return { g, name: ['정보 없음', '좋음', '보통', '나쁨', '매우 나쁨'][g], icon: ['❔', '😊', '🙂', '😷', '🚫'][g] };
  }

  /* 운영 상황 판단 (공식 정보가 아니라 날씨·휴장일로 '예상') */
  function assessStatus(course, w, aq, now) {
    now = now || new Date();
    const reasons = []; let level = 0; // 0 좋음, 1 주의, 2 어려움
    const f = (course && course.info) || {};
    const dow = now.getDay();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    if (f.closedDays && f.closedDays.includes(dow)) { level = 2; reasons.push(`오늘(${dayNames[dow]}요일)은 정기 휴장일이에요.`); }
    const hm = now.getHours() * 60 + now.getMinutes();
    const toMin = s => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
    const open = toMin(f.open), close = toMin(f.close);
    if (open != null && close != null && (hm < open || hm >= close)) { level = Math.max(level, 1); reasons.push(`지금은 운영 시간(${f.open}~${f.close})이 아니에요.`); }

    if (w && w.current) {
      const c = w.current;
      if (isStormCode(c.weather_code)) { level = 2; reasons.push('천둥번개가 치고 있어요. 낙뢰 위험으로 운영을 멈추는 경우가 많아요.'); }
      else if (isSnowCode(c.weather_code)) { level = 2; reasons.push('눈이 와요. 코스가 미끄럽고 휴장할 수 있어요.'); }
      else if (isRainCode(c.weather_code) || c.precipitation >= 1) { level = Math.max(level, c.precipitation >= 3 ? 2 : 1); reasons.push(c.precipitation >= 3 ? '비가 많이 와요. 휴장할 가능성이 높아요.' : '비가 조금 와요. 우산·우비를 챙기세요.'); }
      if (c.wind_speed_10m >= 10 || c.wind_gusts_10m >= 17) { level = Math.max(level, 2); reasons.push(`바람이 아주 강해요(초속 ${Math.round(c.wind_speed_10m)}m).`); }
      else if (c.wind_speed_10m >= 6) { level = Math.max(level, 1); reasons.push(`바람이 강한 편이에요(초속 ${Math.round(c.wind_speed_10m)}m). 공이 많이 흔들려요.`); }
      if (c.apparent_temperature >= 33) { level = Math.max(level, 1); reasons.push(`체감 ${Math.round(c.apparent_temperature)}℃ 폭염이에요. 한낮은 피하세요.`); }
      if (c.temperature_2m <= -5) { level = Math.max(level, 1); reasons.push('영하의 추위예요. 땅이 얼어 미끄러울 수 있어요.'); }
      // 지난 이틀 비 — 하천 옆 골프장은 물에 잠겨 휴장하기 쉬움
      const past = (w.daily && w.daily.precipitation_sum) ? w.daily.precipitation_sum.slice(0, 2).reduce((s, x) => s + (x || 0), 0) : 0;
      const riverside = course && course.features && course.features.river;
      if (past >= (riverside ? 30 : 60)) { level = Math.max(level, 2); reasons.push(`지난 이틀 비가 ${Math.round(past)}mm 왔어요. ${riverside ? '강가 골프장은 물에 잠겨 휴장할 수 있어요.' : '코스가 젖어 있을 수 있어요.'}`); }
      else if (past >= 15) { level = Math.max(level, 1); reasons.push(`지난 이틀 비가 ${Math.round(past)}mm 왔어요. 잔디가 젖어 공이 덜 굴러가요.`); }
    }
    if (aq && aq.current) {
      const g = pmGrade(aq.current.pm10, aq.current.pm2_5);
      if (g.g >= 4) { level = Math.max(level, 2); reasons.push('미세먼지가 매우 나빠요. 바깥 운동은 쉬세요.'); }
      else if (g.g === 3) { level = Math.max(level, 1); reasons.push('미세먼지가 나빠요. 마스크를 챙기세요.'); }
    }
    if (!reasons.length) reasons.push('날씨가 좋아 치기 좋은 날이에요.');
    const label = ['치기 좋아요', '주의하세요', '오늘은 어려워요'][level];
    const icon = ['😊', '⚠️', '⛔'][level];
    return { level, label, icon, reasons };
  }

  /* 오늘 남은 시간 중 치기 좋은 때 */
  function bestHours(w, now) {
    if (!w || !w.hourly) return [];
    now = now || new Date();
    const today = ymd(now), H = w.hourly, out = [];
    H.time.forEach((t, i) => {
      if (t.slice(0, 10) !== today) return;
      const h = Number(t.slice(11, 13));
      if (h < 6 || h > 18 || h < now.getHours()) return;
      const temp = H.temperature_2m[i], pop = H.precipitation_probability ? H.precipitation_probability[i] || 0 : 0, wind = H.wind_speed_10m[i];
      let score = 100 - pop - Math.max(0, wind - 3) * 6 - Math.abs(temp - 19) * 2 - (H.uv_index && H.uv_index[i] >= 8 ? 10 : 0);
      out.push({ hour: h, temp, pop, wind, code: H.weather_code[i], score });
    });
    const best = out.length ? out.reduce((a, b) => (a.score >= b.score ? a : b)) : null;
    out.forEach(x => (x.best = best && x.hour === best.hour));
    return out;
  }

  /* 골프장 이름 검색 (OpenStreetMap) */
  async function searchCourses(text) {
    const tries = [text];
    if (!/파크\s*골프/.test(text)) tries.unshift(text + ' 파크골프장');
    const seen = new Set(), out = [];
    for (const q of tries) {
      const p = new URLSearchParams({ format: 'jsonv2', countrycodes: 'kr', 'accept-language': 'ko', limit: '12', addressdetails: '1', q });
      let j = [];
      try { j = await getJSON(`https://nominatim.openstreetmap.org/search?${p}`); } catch (e) { if (q === tries[tries.length - 1] && !out.length) throw e; }
      for (const r of j) {
        const key = r.osm_type + r.osm_id;
        if (seen.has(key)) continue; seen.add(key);
        out.push({ name: r.name || r.display_name.split(',')[0], address: shortAddr(r), lat: Number(r.lat), lon: Number(r.lon), osm: key });
      }
      if (out.length >= 5) break;
    }
    return out;
  }
  function shortAddr(r) {
    const a = r.address || {};
    const parts = [a.province || a.state, a.city || a.county, a.borough || a.city_district || a.district, a.suburb || a.town || a.village || a.quarter, a.road].filter(Boolean);
    return parts.length ? [...new Set(parts)].join(' ') : r.display_name.split(',').slice(1, 4).reverse().join(' ').trim();
  }

  /* 내 주변 파크골프장 (반경 km) */
  async function nearbyCourses(lat, lon, km) {
    const q = `[out:json][timeout:25];(nwr["name"~"파크골프|파크 골프"](around:${(km || 15) * 1000},${lat},${lon}););out center 40;`;
    const j = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const out = (j.elements || []).map(e => {
      const la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon;
      const t = e.tags || {};
      return { name: t.name, address: [t['addr:city'], t['addr:district'], t['addr:street'], t['addr:full']].filter(Boolean).join(' '), lat: la, lon: lo, phone: t.phone || t['contact:phone'] || '', hours: t.opening_hours || '', dist: distKm(lat, lon, la, lo), osm: e.type + e.id };
    }).filter(x => x.name && x.lat != null);
    const seen = new Set();
    return out.sort((a, b) => a.dist - b.dist).filter(x => (seen.has(x.name) ? false : seen.add(x.name)));
  }
  function distKm(a, b, c, d) {
    const R = 6371, toR = x => (x * Math.PI) / 180;
    const dLa = toR(c - a), dLo = toR(d - b);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* 기상청 자료(서버)를 Open-Meteo 자료 위에 덮어쓰기. 해 뜨는 시간·자외선·지난 비는 Open-Meteo 것을 그대로 둠 */
  function mergeKma(om, k, now) {
    if (!k) return om;
    const today = ymd(now || new Date());
    if (!om) {
      return {
        source: 'kma',
        current: Object.assign({ apparent_temperature: k.current.temperature_2m, wind_gusts_10m: null }, k.current),
        hourly: Object.assign({ uv_index: [] }, k.hourly),
        daily: { time: k.daily.time, weather_code: k.daily.weather_code, temperature_2m_max: k.daily.temperature_2m_max, temperature_2m_min: k.daily.temperature_2m_min, precipitation_probability_max: k.daily.precipitation_probability_max, wind_speed_10m_max: k.daily.wind_speed_10m_max }
      };
    }
    const w = JSON.parse(JSON.stringify(om));
    w.source = 'kma';
    const c = k.current || {};
    if (c.temperature_2m != null) {
      const gap = w.current.apparent_temperature != null && w.current.temperature_2m != null ? w.current.apparent_temperature - w.current.temperature_2m : 0;
      w.current.temperature_2m = c.temperature_2m;
      w.current.apparent_temperature = c.temperature_2m + gap; // 체감 차이는 Open-Meteo 기준 유지
    }
    ['precipitation', 'relative_humidity_2m', 'wind_speed_10m', 'weather_code'].forEach(f => { if (c[f] != null) w.current[f] = c[f]; });
    const hi = new Map(w.hourly.time.map((t, i) => [t, i]));
    k.hourly.time.forEach((t, j) => {
      const i = hi.get(t); if (i == null) return;
      ['temperature_2m', 'precipitation_probability', 'precipitation', 'weather_code', 'wind_speed_10m'].forEach(f => { if (k.hourly[f] && k.hourly[f][j] != null && w.hourly[f]) w.hourly[f][i] = k.hourly[f][j]; });
    });
    const di = new Map(w.daily.time.map((t, i) => [t, i]));
    k.daily.time.forEach((d, j) => {
      const i = di.get(d); if (i == null || d < today) return;
      w.daily.precipitation_probability_max[i] = k.daily.precipitation_probability_max[j];
      w.daily.weather_code[i] = k.daily.weather_code[j];
      if (d > today) { // 오늘은 지난 시간 예보가 빠져 있어 최고·최저가 부정확할 수 있음
        w.daily.temperature_2m_max[i] = k.daily.temperature_2m_max[j];
        w.daily.temperature_2m_min[i] = k.daily.temperature_2m_min[j];
      }
    });
    return w;
  }

  const api = { mergeKma, WMO, wxName, wxIcon, isRainCode, dayWeather, nowWeather, airQuality, pmGrade, assessStatus, bestHours, searchCourses, nearbyCourses, distKm, ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WX = api;
})(this);
