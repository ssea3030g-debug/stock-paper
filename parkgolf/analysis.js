/* 파크골프 수첩 — 계산 모음 (성적 분석, 내기 정산)
 * 화면과 상관없는 순수 계산만 모아 두어서 Node 로도 시험할 수 있음.
 */
(function (root) {
  'use strict';

  const DEFAULT_PARS = [3, 4, 3, 4, 5, 3, 4, 3, 4]; // 9홀 파33 기본 배치
  const SECTION_NAMES = ['A', 'B', 'C', 'D'];

  const sum = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
  const avg = a => (a.length ? sum(a) / a.length : null);
  const round1 = x => Math.round(x * 10) / 10;
  const sign = x => (x > 0 ? '+' + x : x === 0 ? '±0' : String(x));
  const signF = x => { const r = round1(x); return r > 0 ? '+' + r : r === 0 ? '±0' : String(r); };

  function scoreName(strokes, par) {
    if (!strokes) return '';
    if (strokes === 1) return '홀인원';
    const d = strokes - par;
    if (d <= -3) return '알바트로스';
    if (d === -2) return '이글';
    if (d === -1) return '버디';
    if (d === 0) return '파';
    if (d === 1) return '보기';
    if (d === 2) return '더블보기';
    if (d === 3) return '트리플보기';
    return '+' + d;
  }

  /* 한 라운드의 합계 */
  function roundTotals(r) {
    let strokes = 0, par = 0, holes = 0;
    for (const s of r.sections || []) {
      const p = sum(s.pars);
      par += p; holes += s.pars.length;
      strokes += s.strokes ? sum(s.strokes) : (Number(s.total) || 0);
    }
    return { strokes, par, diff: strokes - par, holes, per9: holes ? (strokes - par) / (holes / 9) : 0 };
  }

  function allHoles(r) {
    const out = [];
    (r.sections || []).forEach((s, si) => {
      if (!s.strokes) return;
      s.pars.forEach((p, hi) => out.push({ section: s.name, si, hole: hi + 1, idx: out.length, par: p, strokes: s.strokes[hi], diff: s.strokes[hi] - p }));
    });
    return out;
  }

  /* 날씨 특징 → 꼬리표 */
  function weatherFlags(w) {
    const f = { windy: false, rainy: false, hot: false, cold: false, nice: false };
    if (!w) return f;
    const tags = w.tags || [];
    f.windy = (w.windMax != null && w.windMax >= 7) || (w.wind != null && w.wind >= 4.5) || tags.includes('바람');
    f.rainy = (w.precip != null && w.precip >= 1) || tags.includes('비');
    f.hot = (w.tMax != null && w.tMax >= 30) || tags.includes('더움');
    f.cold = (w.tMax != null && w.tMax <= 8) || tags.includes('추움');
    f.nice = !f.windy && !f.rainy && !f.hot && !f.cold && (w.tMax != null || tags.includes('맑음'));
    return f;
  }

  /* 파3·파4·파5 별 평균 (파 대비) */
  function parTypeStats(rounds) {
    const by = { 3: [], 4: [], 5: [] };
    for (const r of rounds) for (const h of allHoles(r)) if (by[h.par]) by[h.par].push(h.diff);
    const out = {};
    for (const k of [3, 4, 5]) out[k] = by[k].length ? { avg: avg(by[k]), n: by[k].length } : null;
    return out;
  }

  function countBy(holes) {
    const c = { hio: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
    for (const h of holes) {
      if (h.strokes === 1) c.hio++;
      if (h.diff <= -1) c.birdie++;
      else if (h.diff === 0) c.par++;
      else if (h.diff === 1) c.bogey++;
      else c.double++;
    }
    return c;
  }

  const PRACTICE = {
    3: '짧은 홀(파3): 티샷 한 번에 그린에 올리는 연습. 목표 거리 20·30·40m 를 정해 10번씩 쳐 보세요.',
    4: '보통 홀(파4): 두 번째 샷 거리감 연습. 홀컵 둘레 2m 원 안에 세우는 연습이 좋습니다.',
    5: '긴 홀(파5): 무리하게 멀리 치지 말고 세 번에 나눠 가는 연습. 똑바로 70% 힘으로 치기.',
    putt: '마무리(퍼팅): 1m·2m 짧은 거리 넣기 연습을 매일 20개씩. 끝까지 공을 보고 치세요.',
    ob: 'OB 줄이기: 티샷은 힘을 빼고 방향 먼저. 몸통을 고정하고 클럽을 똑바로 뒤로 뺐다가 보내기.',
    stamina: '체력 관리: 경기 중간에 물·간식(바나나, 사탕) 챙기기. 코스 바꿀 때마다 어깨·허리 가볍게 풀기.',
    warmup: '몸풀기: 시작 전 10분 스트레칭과 연습 퍼팅 5개. 첫 홀은 평소보다 부드럽게.',
    wind: '바람 대비: 맞바람에서는 공을 낮게 굴리듯, 뒷바람에서는 한 클럽 약하게. 옆바람은 바람 쪽으로 조금 겨냥.',
    rain: '비 오는 날: 잔디가 젖으면 공이 덜 굴러갑니다. 평소보다 조금 더 세게, 미끄럼 주의.',
    turf: '인조잔디: 공이 많이 굴러갑니다. 평소보다 살살, 홀컵 앞에 세운다는 생각으로.',
    natural: '천연잔디: 잔디결과 길이에 따라 공이 멈춥니다. 연습 퍼팅으로 그날 잔디 빠르기부터 확인.',
    slope: '경사 코스: 공은 낮은 쪽으로 휘어집니다. 높은 쪽을 겨냥하고, 내리막은 살살.'
  };

  /* ── 라운드 하나 분석 ─────────────────────────── */
  function analyzeRound(r, allRounds, course) {
    const t = roundTotals(r);
    const holes = allHoles(r);
    const good = [], improve = [], practice = [], factors = [];
    const others = (allRounds || []).filter(x => x.id !== r.id && x.date <= r.date);
    const myAvg = avg(others.map(x => roundTotals(x).per9));
    const f = weatherFlags(r.weather);
    const feat = (course && course.features) || {};

    // 1) 전체 성적
    if (t.diff <= 0) good.push({ t: '파 이하로 마쳤어요', d: `총 ${t.strokes}타, 기준 타수(파 ${t.par})보다 ${sign(t.diff)}. 아주 잘 치셨습니다.` });
    if (myAvg != null) {
      const gap = t.per9 - myAvg;
      if (gap <= -1) good.push({ t: '평소보다 잘 치셨어요', d: `9홀마다 평균보다 ${round1(-gap)}타 적게 쳤습니다.` });
      else if (gap >= 1.5) improve.push({ t: '평소보다 타수가 많았어요', d: `9홀마다 평소보다 ${round1(gap)}타 더 쳤습니다. 아래 원인을 살펴보세요.` });
    }

    // 2) 홀 기록이 있으면 자세히
    if (holes.length) {
      const c = countBy(holes);
      if (c.hio) good.push({ t: `홀인원 ${c.hio}번!`, d: '정말 축하드립니다. 그날 감각을 메모해 두세요.' });
      if (c.birdie) good.push({ t: `버디 이상 ${c.birdie}번`, d: '기준보다 적게 친 홀이 있었어요. 자신감을 가지세요.' });
      const parRate = (c.par + c.birdie) / holes.length;
      if (parRate >= 0.6) good.push({ t: '실수가 적은 안정적인 경기', d: `${holes.length}홀 중 ${c.par + c.birdie}홀을 파 이하로 마쳤습니다.` });
      if (c.double >= Math.max(2, Math.round(holes.length / 9))) {
        improve.push({ t: `크게 무너진 홀이 ${c.double}개`, d: '기준보다 2타 이상 더 친 홀이 많아요. 큰 실수 하나가 점수를 가장 많이 깎습니다.' });
        practice.push(PRACTICE.ob);
      }
      const pt = parTypeStats([r]);
      const types = [3, 4, 5].filter(k => pt[k] && pt[k].n >= 2);
      if (types.length >= 2) {
        const worst = types.reduce((a, b) => (pt[a].avg >= pt[b].avg ? a : b));
        const best = types.reduce((a, b) => (pt[a].avg <= pt[b].avg ? a : b));
        if (pt[worst].avg >= 0.5) {
          improve.push({ t: `파${worst} 홀이 약했어요`, d: `파${worst} 홀에서 평균 ${signF(pt[worst].avg)}타. ${worst === 3 ? '짧은 홀에서 첫 샷 거리 맞추기' : worst === 4 ? '두 번째 샷 거리감' : '긴 홀을 나눠 치는 요령'}이 필요합니다.` });
          practice.push(PRACTICE[worst]);
        }
        if (best !== worst && pt[best].avg <= 0.2) good.push({ t: `파${best} 홀은 잘 쳤어요`, d: `파${best} 홀 평균 ${signF(pt[best].avg)}타.` });
      }
      // 전반 / 후반
      if (holes.length >= 18) {
        const half = Math.floor(holes.length / 2);
        const a = sum(holes.slice(0, half).map(h => h.diff)), b = sum(holes.slice(half).map(h => h.diff));
        if (b - a >= 3) { improve.push({ t: '뒤로 갈수록 타수가 늘었어요', d: `앞쪽 ${sign(a)}, 뒤쪽 ${sign(b)}. 체력이나 집중력이 떨어졌을 수 있어요.` }); practice.push(PRACTICE.stamina); }
        else if (a - b >= 3) { good.push({ t: '뒷심이 좋아요', d: `앞쪽 ${sign(a)} → 뒤쪽 ${sign(b)}. 갈수록 잘 쳤습니다.` }); improve.push({ t: '처음 몇 홀이 아쉬웠어요', d: '시작할 때 몸이 덜 풀렸던 것 같습니다.' }); practice.push(PRACTICE.warmup); }
      }
      // 첫 3홀
      const first3 = holes.slice(0, 3);
      if (first3.length === 3 && sum(first3.map(h => h.diff)) >= 3 && !practice.includes(PRACTICE.warmup)) {
        improve.push({ t: '첫 세 홀에서 타수를 많이 잃었어요', d: `첫 3홀 ${sign(sum(first3.map(h => h.diff)))}타.` });
        practice.push(PRACTICE.warmup);
      }
      // 코스(구역)별
      if ((r.sections || []).length >= 2 && r.sections.every(s => s.strokes)) {
        const ds = r.sections.map(s => ({ name: s.name, d: sum(s.strokes) - sum(s.pars) }));
        const w = ds.reduce((a, b) => (a.d >= b.d ? a : b)), bst = ds.reduce((a, b) => (a.d <= b.d ? a : b));
        if (w.d - bst.d >= 3) factors.push(`${bst.name}코스(${sign(bst.d)})는 좋았고 ${w.name}코스(${sign(w.d)})가 어려웠어요.`);
      }
    }

    // 3) OB
    if (Number(r.ob) >= 2) { improve.push({ t: `OB(밖으로 나감) ${r.ob}번`, d: 'OB 한 번에 벌타가 붙습니다. 티샷은 방향이 먼저예요.' }); if (!practice.includes(PRACTICE.ob)) practice.push(PRACTICE.ob); }

    // 4) 날씨와 함께 보기
    if (r.weather) {
      const wd = [];
      if (f.windy) wd.push('바람이 강했고');
      if (f.rainy) wd.push('비가 왔고');
      if (f.hot) wd.push('더웠고');
      if (f.cold) wd.push('추웠고');
      if (wd.length) {
        const sameWx = others.filter(x => { const g = weatherFlags(x.weather); return (f.windy && g.windy) || (f.rainy && g.rainy) || (f.hot && g.hot) || (f.cold && g.cold); });
        factors.push(`그날은 ${wd.join(' ').replace(/고$/, '어요')}.`);
        const bad = myAvg != null ? t.per9 - myAvg >= 1 : t.per9 >= 4;
        if (bad) {
          if (f.windy) { improve.push({ t: '바람의 영향을 받았어요', d: '바람 부는 날 타수가 늘었습니다. 바람 방향을 먼저 보고 치세요.' }); practice.push(PRACTICE.wind); }
          if (f.rainy) { improve.push({ t: '젖은 잔디에 적응이 필요해요', d: '비 온 날은 공이 덜 굴러가 짧아지기 쉽습니다.' }); practice.push(PRACTICE.rain); }
          if (f.hot || f.cold) { improve.push({ t: f.hot ? '더위에 체력이 떨어졌을 수 있어요' : '추위에 몸이 굳었을 수 있어요', d: f.hot ? '모자·물·그늘 쉬기를 꼭 챙기세요.' : '시작 전 몸풀기를 평소보다 길게 하세요.' }); if (!practice.includes(f.hot ? PRACTICE.stamina : PRACTICE.warmup)) practice.push(f.hot ? PRACTICE.stamina : PRACTICE.warmup); }
        } else {
          good.push({ t: '날씨가 나빴는데도 잘 버텼어요', d: '궂은 날씨에도 평소만큼 쳤습니다.' });
        }
        if (sameWx.length >= 2) {
          const a2 = avg(sameWx.map(x => roundTotals(x).per9));
          factors.push(`비슷한 날씨였던 ${sameWx.length}번의 경기 평균은 9홀당 ${signF(a2)}타였어요.`);
        }
      } else if (f.nice) factors.push('날씨는 치기 좋은 날이었어요.');
    }

    // 5) 골프장 특징과 함께 보기
    if (course) {
      const atCourse = others.filter(x => x.courseId === r.courseId);
      if (atCourse.length) {
        const ca = avg(atCourse.map(x => roundTotals(x).per9));
        factors.push(`이 골프장에서 전에 ${atCourse.length}번 쳤고 평균은 9홀당 ${signF(ca)}타였어요.`);
        if (t.per9 < ca - 0.8) good.push({ t: '이 골프장에 익숙해지고 있어요', d: '전보다 이 골프장에서 더 잘 쳤습니다.' });
      }
      const bad = myAvg != null ? t.per9 - myAvg >= 1 : t.per9 >= 4;
      if (feat.grass === '인조잔디' && bad) { factors.push('인조잔디라 공이 많이 굴러가는 곳이에요.'); practice.push(PRACTICE.turf); }
      if (feat.grass === '천연잔디' && f.rainy && !practice.includes(PRACTICE.rain)) practice.push(PRACTICE.rain);
      if (feat.terrain === '경사 많음' && bad) { factors.push('경사가 많은 코스예요.'); practice.push(PRACTICE.slope); }
      if (feat.river && f.windy) factors.push('강가에 있어 바람을 더 많이 받는 곳이에요.');
      if (feat.length === '긴 편' && holes.length) {
        const pt = parTypeStats([r]);
        if (pt[5] && pt[5].avg >= 1 && !practice.includes(PRACTICE[5])) practice.push(PRACTICE[5]);
      }
    }

    // 6) 몸 상태
    if (r.condition === '안좋음') factors.push('몸 상태가 좋지 않은 날이었어요. 무리하지 마세요.');

    if (!improve.length) improve.push({ t: '큰 약점이 보이지 않아요', d: '지금처럼 꾸준히 치시면 됩니다. 짧은 퍼팅 연습으로 한두 타를 더 줄여 보세요.' });
    if (!practice.length) practice.push(PRACTICE.putt);
    if (!good.length) good.push({ t: '끝까지 완주하셨어요', d: '기록을 쌓으면 더 정확하게 분석해 드릴게요.' });

    const summary = `${r.date} ${r.courseName || ''} ${r.title || ''}: 총 ${t.strokes}타 (${sign(t.diff)}).`;
    return { totals: t, good, improve, practice: [...new Set(practice)].slice(0, 4), factors, summary };
  }

  /* ── 전체 기록으로 플레이 스타일 분석 ──────────────── */
  function analyzeOverall(rounds, courses) {
    const rs = [...(rounds || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rs.length) return null;
    const cmap = {}; (courses || []).forEach(c => (cmap[c.id] = c));
    const per9 = rs.map(r => roundTotals(r).per9);
    const holes = rs.flatMap(allHoles);
    const c = countBy(holes);
    const pt = parTypeStats(rs);
    const good = [], improve = [], practice = [];
    const best = rs.reduce((a, b) => (roundTotals(a).per9 <= roundTotals(b).per9 ? a : b));

    // 추세: 최근 3번 vs 그 이전
    let trend = null;
    if (rs.length >= 4) {
      const recent = avg(per9.slice(-3)), before = avg(per9.slice(0, -3));
      trend = recent - before;
      if (trend <= -0.7) good.push({ t: '실력이 늘고 있어요', d: `최근 3경기가 그 전보다 9홀당 ${round1(-trend)}타 좋아졌습니다.` });
      else if (trend >= 0.7) improve.push({ t: '최근 성적이 조금 떨어졌어요', d: `최근 3경기가 그 전보다 9홀당 ${round1(trend)}타 많습니다. 피로가 쌓이지 않았는지 살펴보세요.` });
    }
    // 들쭉날쭉
    let spread = null;
    if (per9.length >= 3) {
      const m = avg(per9); spread = Math.sqrt(avg(per9.map(x => (x - m) ** 2)));
      if (spread <= 1) good.push({ t: '성적이 꾸준해요', d: '경기마다 점수 차이가 크지 않습니다.' });
      else if (spread >= 2.5) improve.push({ t: '날마다 성적 차이가 커요', d: '잘 되는 날과 안 되는 날 차이가 큽니다. 같은 순서로 몸풀기·연습 퍼팅을 하고 시작해 보세요.' });
    }
    // 파 종류
    const types = [3, 4, 5].filter(k => pt[k] && pt[k].n >= 4);
    let strongType = null, weakType = null;
    if (types.length >= 2) {
      weakType = types.reduce((a, b) => (pt[a].avg >= pt[b].avg ? a : b));
      strongType = types.reduce((a, b) => (pt[a].avg <= pt[b].avg ? a : b));
      if (strongType !== weakType) {
        good.push({ t: `파${strongType} 홀이 강해요`, d: `파${strongType} 평균 ${signF(pt[strongType].avg)}타.` });
        if (pt[weakType].avg >= 0.4) { improve.push({ t: `파${weakType} 홀이 약해요`, d: `파${weakType} 평균 ${signF(pt[weakType].avg)}타로 가장 많이 잃습니다.` }); practice.push(PRACTICE[weakType]); }
      }
    }
    const bigRate = holes.length ? c.double / holes.length : 0;
    if (holes.length >= 18 && bigRate >= 0.15) { improve.push({ t: '큰 실수가 잦아요', d: `홀 ${Math.round(bigRate * 100)}%에서 2타 이상 더 쳤습니다.` }); practice.push(PRACTICE.ob); }
    if (holes.length >= 18 && bigRate <= 0.05) good.push({ t: '큰 실수가 거의 없어요', d: '무너지는 홀이 적은 안정형입니다.' });

    // 날씨별
    const wxBuckets = [
      ['windy', '바람 부는 날'], ['rainy', '비 오는 날'], ['hot', '더운 날'], ['cold', '추운 날']
    ].map(([k, label]) => {
      const inn = rs.filter(r => weatherFlags(r.weather)[k]).map(r => roundTotals(r).per9);
      const out = rs.filter(r => r.weather && !weatherFlags(r.weather)[k]).map(r => roundTotals(r).per9);
      return { key: k, label, n: inn.length, avg: avg(inn), others: avg(out) };
    });
    for (const b of wxBuckets) {
      if (b.n >= 2 && b.others != null) {
        const g = b.avg - b.others;
        if (g >= 1) { improve.push({ t: `${b.label}에 약해요`, d: `${b.label} 9홀당 ${round1(g)}타 더 칩니다.` }); practice.push(b.key === 'windy' ? PRACTICE.wind : b.key === 'rainy' ? PRACTICE.rain : b.key === 'hot' ? PRACTICE.stamina : PRACTICE.warmup); }
        else if (g <= -0.5) good.push({ t: `${b.label}에도 강해요`, d: `${b.label}에 오히려 ${round1(-g)}타 덜 칩니다.` });
      }
    }
    // 잔디별
    const grass = ['인조잔디', '천연잔디'].map(g => {
      const v = rs.filter(r => cmap[r.courseId] && cmap[r.courseId].features && cmap[r.courseId].features.grass === g).map(r => roundTotals(r).per9);
      return { label: g, n: v.length, avg: avg(v) };
    });
    if (grass[0].n >= 2 && grass[1].n >= 2) {
      const g = grass[0].avg - grass[1].avg;
      if (g >= 1) { improve.push({ t: '인조잔디에서 약해요', d: `인조잔디에서 9홀당 ${round1(g)}타 더 칩니다.` }); practice.push(PRACTICE.turf); }
      if (g <= -1) { improve.push({ t: '천연잔디에서 약해요', d: `천연잔디에서 9홀당 ${round1(-g)}타 더 칩니다.` }); practice.push(PRACTICE.natural); }
    }
    // 전반 후반
    const fades = rs.map(allHoles).filter(h => h.length >= 18).map(h => { const half = Math.floor(h.length / 2); return sum(h.slice(half).map(x => x.diff)) - sum(h.slice(0, half).map(x => x.diff)); });
    if (fades.length >= 2) {
      const fa = avg(fades);
      if (fa >= 2) { improve.push({ t: '후반에 지쳐요', d: `뒤쪽 홀에서 평균 ${round1(fa)}타를 더 잃습니다.` }); practice.push(PRACTICE.stamina); }
      if (fa <= -2) { improve.push({ t: '초반이 약해요', d: `앞쪽 홀에서 평균 ${round1(-fa)}타를 더 잃습니다.` }); practice.push(PRACTICE.warmup); }
    }
    // 대회 vs 연습
    const comp = rs.filter(r => r.kind === '대회').map(r => roundTotals(r).per9);
    const prac = rs.filter(r => r.kind !== '대회').map(r => roundTotals(r).per9);
    if (comp.length >= 2 && prac.length >= 2) {
      const g = avg(comp) - avg(prac);
      if (g >= 1) { improve.push({ t: '대회에서 긴장하는 편이에요', d: `대회 때 9홀당 ${round1(g)}타 더 칩니다. 대회 전날은 충분히 쉬고, 첫 홀은 천천히.` }); }
      else if (g <= -0.5) good.push({ t: '대회에 강해요', d: '대회 때 오히려 더 잘 칩니다.' });
    }

    // 스타일 이름
    let style = '꾸준히 기록을 쌓는 중';
    if (holes.length >= 18) {
      const birdieRate = c.birdie / holes.length;
      if (bigRate <= 0.07 && birdieRate < 0.12) style = '안정형 — 실수가 적고 차분하게 치는 스타일';
      else if (birdieRate >= 0.12 && bigRate >= 0.12) style = '공격형 — 버디도 많지만 큰 실수도 있는 스타일';
      else if (birdieRate >= 0.12) style = '득점형 — 버디를 자주 만드는 스타일';
      else if (bigRate >= 0.15) style = '도전형 — 한두 홀 실수만 줄이면 크게 좋아질 스타일';
      else style = '균형형 — 큰 약점 없이 고르게 치는 스타일';
      if (strongType) style += ` · 파${strongType} 강함`;
    }

    if (!practice.length) practice.push(PRACTICE.putt);
    if (!improve.length) improve.push({ t: '아직 뚜렷한 약점이 없어요', d: '기록이 더 쌓이면 날씨·골프장별로 자세히 알려 드릴게요.' });

    return {
      count: rs.length, avgPer9: avg(per9), best, bestTotals: roundTotals(best), counts: c, holesCount: holes.length,
      parTypes: pt, wxBuckets, grass, trend, spread, style, good, improve, practice: [...new Set(practice)].slice(0, 4),
      series: rs.map(r => ({ id: r.id, date: r.date, per9: roundTotals(r).per9, totals: roundTotals(r), name: r.courseName }))
    };
  }

  /* ── 내기 계산 ─────────────────────────────────
   * bet = { players:[이름], unit:점당 원, mode:'stroke'|'hole', carry:bool, bonus:bool,
   *         pars:[홀별 파], scores:{이름:[홀별 타수 또는 null]}, totalsOnly:bool, totals:{이름:합계} }
   * 결과 points 는 '받을 점수'(양수 = 받음, 음수 = 줌). 합계는 언제나 0.
   */
  function betTotals(bet) {
    const t = {};
    for (const p of bet.players) {
      if (bet.totalsOnly) t[p] = Number(bet.totals && bet.totals[p]) || 0;
      else t[p] = sum((bet.scores[p] || []).map(x => x || 0));
    }
    return t;
  }

  function completedHoles(bet) {
    if (bet.totalsOnly) return [];
    const out = [];
    for (let i = 0; i < bet.pars.length; i++) if (bet.players.every(p => bet.scores[p] && bet.scores[p][i])) out.push(i);
    return out;
  }

  function settleBet(bet) {
    const n = bet.players.length;
    const points = {}; bet.players.forEach(p => (points[p] = 0));
    const log = [];
    const totals = {};
    bet.players.forEach(p => (totals[p] = 0));
    const done = completedHoles(bet);

    if (bet.totalsOnly || bet.mode === 'stroke') {
      if (bet.totalsOnly) Object.assign(totals, betTotals(bet));
      else for (const i of done) for (const p of bet.players) totals[p] += bet.scores[p][i];
      const all = sum(Object.values(totals));
      // 타당: 다른 사람 각각과 타수 차이만큼 주고받음 → 내 점수 = (전체 합 - n × 내 타수)
      for (const p of bet.players) points[p] = all - n * totals[p];
    }
    if (!bet.totalsOnly && bet.mode === 'hole') {
      let pot = 1;
      for (const i of done) {
        for (const p of bet.players) totals[p] += bet.scores[p][i];
        const vals = bet.players.map(p => bet.scores[p][i]);
        const min = Math.min(...vals);
        const winners = bet.players.filter(p => bet.scores[p][i] === min);
        if (winners.length === 1) {
          const w = winners[0];
          for (const p of bet.players) if (p !== w) { points[p] -= pot; points[w] += pot; }
          log.push({ hole: i + 1, winner: w, pot });
          pot = 1;
        } else {
          log.push({ hole: i + 1, winner: null, pot });
          pot = bet.carry ? pot + 1 : 1;
        }
      }
    }
    if (!bet.totalsOnly && bet.bonus) {
      for (const i of done) {
        for (const p of bet.players) {
          const s = bet.scores[p][i], par = bet.pars[i];
          let k = 0;
          if (s === 1) k = 3; else if (s <= par - 1) k = 1;
          if (k) {
            for (const q of bet.players) if (q !== p) { points[q] -= k; points[p] += k; }
            log.push({ hole: i + 1, bonus: p, k, what: s === 1 ? '홀인원' : scoreName(s, par) });
          }
        }
      }
    }
    const money = {}; for (const p of bet.players) money[p] = points[p] * (Number(bet.unit) || 0);
    const ranking = [...bet.players].sort((a, b) => totals[a] - totals[b] || money[b] - money[a]);
    return { totals, points, money, ranking, transfers: minimizeTransfers(money), log, holesDone: bet.totalsOnly ? null : done.length };
  }

  /* 주고받을 돈을 가장 적은 횟수로 정리 */
  function minimizeTransfers(money) {
    const cred = [], debt = [];
    for (const [p, m] of Object.entries(money)) { if (m > 0) cred.push([p, m]); else if (m < 0) debt.push([p, -m]); }
    cred.sort((a, b) => b[1] - a[1]); debt.sort((a, b) => b[1] - a[1]);
    const out = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i][1], cred[j][1]);
      if (amt > 0) out.push({ from: debt[i][0], to: cred[j][0], amount: amt });
      debt[i][1] -= amt; cred[j][1] -= amt;
      if (debt[i][1] === 0) i++;
      if (cred[j][1] === 0) j++;
    }
    return out;
  }

  const api = { DEFAULT_PARS, SECTION_NAMES, sum, avg, round1, sign, signF, scoreName, roundTotals, allHoles, weatherFlags, parTypeStats, analyzeRound, analyzeOverall, betTotals, settleBet, minimizeTransfers, completedHoles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PG = api;
})(this);
