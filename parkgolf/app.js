/* 파크골프 수첩 — 화면 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = $('#app');

  /* ── 저장소 ─────────────────────────────────────── */
  const KEY = 'parkgolf.v1';
  const blank = () => ({ courses: [], rounds: [], bets: [], events: [], players: [], settings: { name: '', size: 'big', theme: 'auto', alarms: ['1d', '2h'] }, checklist: { date: '', checked: {} } });
  let db = load();
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return Object.assign(blank(), s, { settings: Object.assign(blank().settings, s.settings || {}) }); } catch (e) { /* 처음 */ }
    return blank();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('저장 공간이 부족해요. 백업 후 오래된 기록을 지워 주세요.'); } }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const byId = (arr, id) => arr.find(x => x.id === id);
  const course = id => byId(db.courses, id);

  /* ── 도우미 ─────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const today = () => WX.ymd(new Date());
  function fmtDate(s, withYear) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    const y = d.getFullYear() !== new Date().getFullYear() || withYear ? `${d.getFullYear()}년 ` : '';
    return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
  }
  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ap = h < 12 ? '오전' : '오후'; const hh = h % 12 === 0 ? 12 : h % 12;
    return `${ap} ${hh}시${m ? ' ' + m + '분' : ''}`;
  }
  function dday(s) {
    const a = new Date(today() + 'T00:00:00'), b = new Date(s + 'T00:00:00');
    const n = Math.round((b - a) / 86400000);
    return n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 전`;
  }
  const won = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
  const wonPlain = n => Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
  const diffTag = d => `<span class="tag ${d < 0 ? 'good' : d === 0 ? 'info' : d >= 5 ? 'bad' : 'plain'}">${PG.sign(d)}</span>`;

  function toast(msg, ms) {
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms || 2600);
  }
  function modal(html, onReady) {
    return new Promise(resolve => {
      const back = document.createElement('div'); back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
      document.body.appendChild(back);
      const close = v => { back.remove(); resolve(v); };
      back.addEventListener('click', e => {
        if (e.target === back) return close(null);
        const b = e.target.closest('[data-res]'); if (b) close(b.dataset.res);
      });
      if (onReady) onReady(back, close);
    });
  }
  const ask = (title, msg, yes, danger) => modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="btn-row"><button class="btn ghost" data-res="no">아니요</button><button class="btn ${danger ? 'danger' : 'primary'}" data-res="yes">${esc(yes || '네')}</button></div>`).then(v => v === 'yes');

  /* 소리로 읽어 주기 */
  function speak(text) {
    if (!('speechSynthesis' in window)) return toast('이 휴대폰은 소리 읽기를 지원하지 않아요');
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[▲▼★☆•·]/g, ' ').replace(/\+(\d)/g, '플러스 $1').replace(/−|(?<=\s)-(\d)/g, '마이너스 $1'));
    u.lang = 'ko-KR'; u.rate = 0.9; speechSynthesis.speak(u);
  }
  async function shareText(title, text) {
    try { if (navigator.share) { await navigator.share({ title, text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('글을 복사했어요. 카카오톡에 붙여 넣으세요.'); }
    catch (e) { modal(`<h2>아래 글을 길게 눌러 복사하세요</h2><textarea readonly style="min-height:240px">${esc(text)}</textarea><button class="btn primary block" data-res="ok">닫기</button>`); }
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ── 화면 설정 ──────────────────────────────────── */
  function applySettings() {
    const r = document.documentElement;
    r.dataset.size = db.settings.size || 'big';
    if (db.settings.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = db.settings.theme;
  }

  /* ── 라우터 ─────────────────────────────────────── */
  const views = {};
  const parents = { rounds: 'home', analysis: 'rounds', 'round-new': 'rounds', bets: 'home', 'bet-new': 'bets', courses: 'home', 'course-new': 'courses', schedule: 'home', 'event-new': 'schedule', more: 'home', checklist: 'home', stretch: 'home' };
  function parse() {
    const h = (location.hash || '#home').slice(1);
    const m = h.match(/^([a-z]+(?:-(?:new|edit|play))?)(?:-([a-z0-9]+))?$/);
    if (!m) return { name: 'home' };
    return { name: m[1], id: m[2] };
  }
  function go(h) { if (location.hash === '#' + h) render(); else location.hash = h; }
  function render() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const r = parse();
    const v = views[r.name] || views.home;
    let out;
    try { out = v(r.id) || {}; } catch (e) { console.error(e); out = { title: '오류', html: `<div class="note bad"><b>화면을 여는 중 문제가 생겼어요</b>${esc(e.message)}</div>` }; }
    $('#title').textContent = out.title || '파크골프 수첩';
    document.title = (out.title ? out.title + ' · ' : '') + '파크골프 수첩';
    app.innerHTML = out.html || '';
    const tab = out.tab || r.name.split('-')[0].replace(/^(round|analysis)$/, 'rounds').replace(/^bet$/, 'bets').replace(/^course$/, 'courses').replace(/^event$/, 'schedule');
    document.querySelectorAll('.tabbar a').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const back = out.back !== undefined ? out.back : (r.name === 'home' ? null : (parents[r.name] || (r.name.includes('-') ? r.name.split('-')[0] + 's' : 'home')));
    const bb = $('#backBtn'); bb.hidden = !back; bb.dataset.to = back || '';
    window.scrollTo(0, 0);
    if (out.after) out.after();
  }
  $('#backBtn').addEventListener('click', e => go(e.currentTarget.dataset.to || 'home'));
  window.addEventListener('hashchange', render);

  /* 클릭 처리: data-act="이름" */
  const acts = {};
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = acts[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('submit', e => e.preventDefault());

  /* ── 날씨 캐시 ──────────────────────────────────── */
  const wxCache = {};
  async function courseNow(c) {
    if (!c || c.lat == null) return null;
    const k = c.lat.toFixed(3) + ',' + c.lon.toFixed(3);
    const hit = wxCache[k];
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
    const [w, aq] = await Promise.all([WX.nowWeather(c.lat, c.lon), WX.airQuality(c.lat, c.lon).catch(() => null)]);
    const data = { w, aq, status: WX.assessStatus(c, w, aq) };
    wxCache[k] = { at: Date.now(), data };
    return data;
  }

  /* ════════════════ 처음 화면 ════════════════ */
  views.home = () => {
    const name = db.settings.name;
    const h = new Date().getHours();
    const hello = h < 11 ? '좋은 아침이에요' : h < 17 ? '안녕하세요' : '편안한 저녁 되세요';
    const next = db.events.filter(e => e.date >= today()).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
    const fav = db.courses.find(c => c.fav) || db.courses[0];
    const last = [...db.rounds].sort((a, b) => b.date.localeCompare(a.date))[0];
    const live = db.bets.find(b => b.status === 'playing');
    let html = `<section class="card"><p class="big" style="margin:0">${name ? esc(name) + '님, ' : ''}${hello}</p><p class="muted" style="margin:4px 0 0">${fmtDate(today(), true)}</p>`;
    if (!name) html += `<hr><p>이름을 알려 주시면 내기 정산에 '나'로 표시돼요.</p><a class="btn block" href="#more">이름 넣기</a>`;
    html += `</section>`;
    if (live) html += `<a class="btn primary block xl" href="#bet-play-${live.id}" style="margin-bottom:16px">💰 하던 내기 이어서 하기</a>`;
    if (next) html += `<section class="card"><h2>📅 다음 일정 <span class="dday">${dday(next.date)}</span></h2><p class="big" style="margin:0">${esc(next.title)}</p><p>${fmtDate(next.date)} ${fmtTime(next.time)}${next.place ? ' · ' + esc(next.place) : ''}</p><a class="btn block" href="#schedule">일정 모두 보기</a></section>`;
    if (fav) html += `<section class="card"><h2>⛳ ${esc(fav.name)} 지금</h2><div id="homeWx"><p class="muted"><span class="spinner"></span> 날씨를 불러오는 중…</p></div><a class="btn block" href="#course-${fav.id}">자세히 보기</a></section>`;
    html += `<div class="menu-grid">
      <a href="#round-new"><span class="ico">📝</span>성적 기록하기</a>
      <a href="#bet-new"><span class="ico">💰</span>내기 시작</a>
      <a href="#courses"><span class="ico">🌤️</span>골프장 날씨</a>
      <a href="#event-new"><span class="ico">📅</span>일정 추가</a>
      <a href="#analysis"><span class="ico">📊</span>나의 분석</a>
      <a href="#checklist"><span class="ico">🎒</span>준비물 챙기기</a>
      <a href="#stretch"><span class="ico">🤸</span>몸풀기 체조</a>
      <a href="#more"><span class="ico">⚙️</span>설정·백업</a>
    </div>`;
    if (last) {
      const t = PG.roundTotals(last);
      html += `<h2 class="section-title">최근 기록</h2><ul class="list"><li><a href="#round-${last.id}"><span class="ico">${last.kind === '대회' ? '🏆' : '⛳'}</span><span class="main"><span class="title">${esc(last.title || last.courseName || '경기')}</span><span class="sub">${fmtDate(last.date)} · ${esc(last.courseName || '')}</span></span><span class="right">${t.strokes}타<br>${diffTag(t.diff)}</span></a></li></ul>`;
    }
    return {
      title: '파크골프 수첩', html, back: null,
      after: () => { if (fav) loadMiniWx(fav, $('#homeWx')); }
    };
  };

  async function loadMiniWx(c, box) {
    if (!box) return;
    if (c.lat == null) { box.innerHTML = `<p class="muted">위치 정보가 없어 날씨를 볼 수 없어요. 골프장 수정에서 '위치 찾기'를 눌러 주세요.</p>`; return; }
    try {
      const d = await courseNow(c);
      const cur = d.w.current;
      box.innerHTML = `<div class="status-big ${['good', 'warn', 'bad'][d.status.level]}"><span class="ico">${d.status.icon}</span><div><div class="t">${d.status.label}</div><div class="d">${esc(d.status.reasons[0])}</div></div></div>
        <div class="wx"><div><span class="k">날씨</span><span class="v">${WX.wxIcon(cur.weather_code)} ${WX.wxName(cur.weather_code)}</span></div><div><span class="k">기온</span><span class="v">${Math.round(cur.temperature_2m)}℃</span></div></div>`;
    } catch (e) { box.innerHTML = `<p class="muted">인터넷이 연결되지 않아 날씨를 불러오지 못했어요.</p>`; }
  }

  /* ════════════════ 성적 ════════════════ */
  views.rounds = () => {
    const rs = [...db.rounds].sort((a, b) => b.date.localeCompare(a.date));
    let html = `<a class="btn primary block xl" href="#round-new">＋ 새 성적 기록하기</a><div style="height:10px"></div><a class="btn block" href="#analysis">📊 나의 플레이 분석 보기</a>`;
    if (!rs.length) html += `<div class="empty"><span class="ico">📝</span>아직 기록이 없어요.<br>지난 대회 성적부터 넣어 보세요.</div>`;
    else {
      html += `<h2 class="section-title">지난 기록 (${rs.length}번)</h2><ul class="list">`;
      for (const r of rs) {
        const t = PG.roundTotals(r);
        html += `<li><a href="#round-${r.id}"><span class="ico">${r.kind === '대회' ? '🏆' : '⛳'}</span><span class="main"><span class="title">${esc(r.title || (r.kind === '대회' ? '대회' : '연습 경기'))}</span><span class="sub">${fmtDate(r.date)} · ${esc(r.courseName || '')} · ${t.holes}홀${r.rank ? ' · ' + esc(r.rank) + '등' : ''}</span></span><span class="right">${t.strokes}타<br>${diffTag(t.diff)}</span></a></li>`;
      }
      html += `</ul>`;
    }
    return { title: '나의 성적', html };
  };

  let draft = null;
  function newDraft(prefill) {
    const fav = db.courses.find(c => c.fav) || db.courses[0];
    const d = { kind: '대회', title: '', date: today(), courseId: fav ? fav.id : '', nSec: 2, detail: true, sections: [], rank: '', condition: '보통', ob: 0, memo: '', weather: null, wxTags: [] };
    Object.assign(d, prefill || {});
    if (!d.sections.length) setSections(d, d.nSec);
    return d;
  }
  function setSections(d, n) {
    const c = course(d.courseId);
    const layout = (c && c.layout) || [];
    const old = d.sections;
    d.sections = Array.from({ length: n }, (_, i) => {
      if (old[i]) return old[i];
      const L = layout[i];
      const pars = L ? [...L.pars] : [...PG.DEFAULT_PARS];
      return { name: L ? L.name : PG.SECTION_NAMES[i], pars, strokes: [...pars], total: PG.sum(pars) };
    });
    d.nSec = n;
  }

  views['round-new'] = () => { if (!draft || draft.id || draft._fresh !== true) { draft = newDraft(window._roundPrefill); draft._fresh = true; window._roundPrefill = null; } return roundForm('새 성적 기록'); };
  views['round-edit'] = id => {
    const r = byId(db.rounds, id); if (!r) return views.rounds();
    if (draft && draft.id === id) return Object.assign(roundForm('성적 고치기'), { back: 'round-' + id });
    draft = JSON.parse(JSON.stringify(r)); draft.nSec = r.sections.length; draft.detail = r.sections.every(s => s.strokes); draft.wxTags = (r.weather && r.weather.tags) || [];
    return Object.assign(roundForm('성적 고치기'), { back: 'round-' + id });
  };

  function roundForm(title) {
    const d = draft;
    const opts = db.courses.map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const c = course(d.courseId);
    let html = `<form id="roundForm">
    <section class="card"><h2>1. 어떤 경기였나요?</h2>
      <div class="seg" role="group" aria-label="경기 종류">${['대회', '연습'].map(k => `<button type="button" class="chip" data-act="rf-kind" data-v="${k}" aria-pressed="${d.kind === k}">${k === '대회' ? '🏆 대회' : '⛳ 연습·친선'}</button>`).join('')}</div>
      <div style="height:14px"></div>
      <label class="field"><span>대회 이름 (없으면 비워 두세요)</span><input type="text" id="rf-title" value="${esc(d.title)}" placeholder="예) 구청장배 파크골프 대회"></label>
      <label class="field"><span>날짜</span><input type="date" id="rf-date" value="${esc(d.date)}" max="${today()}"></label>
      <label class="field"><span>골프장</span>
        ${db.courses.length ? `<select id="rf-course"><option value="">— 골프장 고르기 —</option>${opts}</select>` : `<p class="muted">저장된 골프장이 없어요.</p>`}
      </label>
      <a class="btn ghost block" href="#courses" data-act="rf-addcourse">＋ 골프장 찾아서 추가하기</a>
    </section>
    <section class="card"><h2>2. 몇 코스를 쳤나요?</h2>
      <p class="muted small">한 코스는 9홀이에요.</p>
      <div class="seg">${[1, 2, 3, 4].map(n => `<button type="button" class="chip" data-act="rf-nsec" data-v="${n}" aria-pressed="${d.nSec === n}">${n}코스<br><span class="small">${n * 9}홀</span></button>`).join('')}</div>
      <div style="height:14px"></div>
      <div class="seg">${[[true, '홀마다 입력'], [false, '코스 합계만']].map(([v, l]) => `<button type="button" class="chip" data-act="rf-detail" data-v="${v}" aria-pressed="${d.detail === v}">${l}</button>`).join('')}</div>
      <p class="muted small">홀마다 넣으면 어느 홀이 약한지 더 자세히 분석해 드려요.</p>
    </section>
    <h2 class="section-title">3. 타수 넣기</h2>
    <p class="muted small" style="margin:-4px 4px 10px">－ ＋ 버튼으로 타수를 맞추세요. '파' 글자를 누르면 그 홀의 기준 타수가 바뀌어요.</p>`;
    d.sections.forEach((s, si) => {
      const sp = PG.sum(s.pars), st = s.strokes ? PG.sum(s.strokes) : s.total;
      html += `<section class="card"><div class="row" style="flex-wrap:nowrap"><h2 class="grow" style="margin:0;display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="text" value="${esc(s.name)}" data-sec-name="${si}" aria-label="코스 이름 (바꿀 수 있어요)" style="width:3.6em;min-height:48px;padding:6px 8px;font-weight:800;text-align:center">코스</h2><span class="big" id="sec-sum-${si}">${st}타 ${diffTag(st - sp)}</span></div>`;
      if (d.detail) {
        s.pars.forEach((p, hi) => {
          const v = s.strokes[hi];
          html += `<div class="hole-row"><div><span class="hole-name">${hi + 1}번 홀</span><button type="button" class="par-chip" data-act="rf-par" data-s="${si}" data-h="${hi}" aria-label="${hi + 1}번 홀 기준 타수 ${p}, 눌러서 바꾸기">파${p}</button><br><span id="lbl-${si}-${hi}">${holeTag(v, p)}</span></div>
          <div class="stepper"><button type="button" data-act="rf-step" data-s="${si}" data-h="${hi}" data-d="-1" aria-label="${hi + 1}번 홀 한 타 빼기">－</button><span class="val" id="v-${si}-${hi}">${v}</span><button type="button" class="plus" data-act="rf-step" data-s="${si}" data-h="${hi}" data-d="1" aria-label="${hi + 1}번 홀 한 타 더하기">＋</button></div></div>`;
        });
      } else {
        html += `<div class="hole-row"><div><span class="hole-name">9홀 합계</span><br><span class="muted small">기준 ${sp}타</span></div><div class="stepper"><button type="button" data-act="rf-tot" data-s="${si}" data-d="-1" aria-label="합계 한 타 빼기">－</button><input type="number" inputmode="numeric" class="val" id="t-${si}" value="${s.total}" style="width:3.4em;min-height:60px;text-align:center;font-weight:900;font-size:1.5rem;padding:4px"><button type="button" class="plus" data-act="rf-tot" data-s="${si}" data-d="1" aria-label="합계 한 타 더하기">＋</button></div></div>`;
      }
      html += `</section>`;
    });
    html += `<section class="card"><h2>4. 그날 이야기 (안 넣어도 돼요)</h2>
      <label class="field"><span>순위</span><input type="number" inputmode="numeric" id="rf-rank" value="${esc(d.rank)}" placeholder="예) 3"></label>
      <label class="field"><span>OB(공이 밖으로 나간 횟수)</span></label>
      <div class="stepper" style="margin-bottom:14px"><button type="button" data-act="rf-ob" data-d="-1" aria-label="OB 빼기">－</button><span class="val" id="rf-ob">${d.ob}</span><button type="button" class="plus" data-act="rf-ob" data-d="1" aria-label="OB 더하기">＋</button></div>
      <label class="field"><span>몸 상태</span></label>
      <div class="seg" style="margin-bottom:14px">${['좋음', '보통', '안좋음'].map(k => `<button type="button" class="chip" data-act="rf-cond" data-v="${k}" aria-pressed="${d.condition === k}">${{ 좋음: '😊 좋음', 보통: '🙂 보통', 안좋음: '😣 안좋음' }[k]}</button>`).join('')}</div>
      <label class="field"><span>메모</span><textarea id="rf-memo" placeholder="예) 3번 홀 바람이 셌음, 새 공 사용">${esc(d.memo)}</textarea></label>
    </section>
    <section class="card"><h2>5. 그날 날씨</h2>
      <div id="rf-wx">${wxSummary(d.weather)}</div>
      ${c && c.lat != null ? `<p class="muted small">저장하면 그날 날씨를 자동으로 찾아 넣어요.</p><button type="button" class="btn block" data-act="rf-wxload">🌤️ 그날 날씨 불러오기</button>` : `<p class="muted small">골프장 위치가 있으면 날씨를 자동으로 찾아 드려요. 지금은 아래에서 골라 주세요.</p>`}
      <h3>직접 고르기 (여러 개 가능)</h3>
      <div class="chips">${['맑음', '흐림', '비', '바람', '더움', '추움'].map(k => `<button type="button" class="chip" data-act="rf-wxtag" data-v="${k}" aria-pressed="${d.wxTags.includes(k)}">${k}</button>`).join('')}</div>
    </section>
    <div class="card"><div class="row"><span class="grow big">전체</span><span class="huge" id="rf-total"></span></div></div>
    <button type="button" class="btn primary block xl" data-act="rf-save">💾 저장하고 분석 보기</button>
    </form>`;
    return { title, html, back: 'rounds', after: () => { updateTotals(); bindRoundInputs(); } };
  }
  function holeTag(v, p) {
    const n = PG.scoreName(v, p), dd = v - p;
    return `<span class="tag ${dd < 0 ? 'good' : dd === 0 ? 'info' : dd >= 2 ? 'bad' : 'plain'}">${n}</span>`;
  }
  function wxSummary(w) {
    if (!w || w.tMax == null) return '';
    return `<div class="wx" style="margin-bottom:10px"><div><span class="k">날씨</span><span class="v">${WX.wxIcon(w.code)} ${WX.wxName(w.code)}</span></div><div><span class="k">기온(경기 시간)</span><span class="v">${w.tAvg != null ? Math.round(w.tAvg) : '-'}℃</span></div><div><span class="k">바람</span><span class="v">초속 ${w.wind != null ? Math.round(w.wind) : '-'}m</span></div><div><span class="k">비</span><span class="v">${w.precip != null ? w.precip : '-'}mm</span></div></div>`;
  }
  function updateTotals() {
    let st = 0, sp = 0;
    draft.sections.forEach((s, si) => {
      const a = s.strokes ? PG.sum(s.strokes) : Number(s.total) || 0, p = PG.sum(s.pars);
      st += a; sp += p;
      const el = $('#sec-sum-' + si); if (el) el.innerHTML = `${a}타 ${diffTag(a - p)}`;
    });
    const t = $('#rf-total'); if (t) t.innerHTML = `${st}타 ${diffTag(st - sp)}`;
  }
  function readRoundInputs() {
    const d = draft; if (!d) return;
    const g = id => document.getElementById(id);
    if (g('rf-title')) d.title = g('rf-title').value.trim();
    if (g('rf-date')) d.date = g('rf-date').value || today();
    if (g('rf-course')) d.courseId = g('rf-course').value;
    if (g('rf-rank')) d.rank = g('rf-rank').value;
    if (g('rf-memo')) d.memo = g('rf-memo').value;
    document.querySelectorAll('[data-sec-name]').forEach(i => { d.sections[i.dataset.secName].name = i.value.trim() || PG.SECTION_NAMES[i.dataset.secName]; });
    d.sections.forEach((s, si) => { const t = g('t-' + si); if (t) s.total = Math.max(9, Number(t.value) || 0); });
  }
  function bindRoundInputs() {
    const cs = $('#rf-course');
    if (cs) cs.addEventListener('change', () => {
      readRoundInputs();
      const c = course(draft.courseId);
      if (c && c.layout) { draft.sections = []; setSections(draft, draft.nSec); if (!draft.detail) draft.sections.forEach(s => { s.strokes = null; }); }
      draft.weather = null; render();
    });
    const dt = $('#rf-date'); if (dt) dt.addEventListener('change', () => { draft.weather = null; const w = $('#rf-wx'); if (w) w.innerHTML = ''; });
    document.querySelectorAll('[id^="t-"]').forEach(i => i.addEventListener('input', () => { readRoundInputs(); updateTotals(); }));
  }
  const rerenderForm = () => { const y = window.scrollY; readRoundInputs(); render(); window.scrollTo(0, y); };
  acts['rf-kind'] = el => { draft.kind = el.dataset.v; rerenderForm(); };
  acts['rf-nsec'] = el => { readRoundInputs(); setSections(draft, Number(el.dataset.v)); if (!draft.detail) draft.sections.forEach(s => { if (s.strokes) { s.total = PG.sum(s.strokes); s.strokes = null; } }); rerenderForm(); };
  acts['rf-detail'] = el => {
    readRoundInputs(); draft.detail = el.dataset.v === 'true';
    draft.sections.forEach(s => {
      if (draft.detail && !s.strokes) { s.strokes = [...s.pars]; }
      if (!draft.detail && s.strokes) { s.total = PG.sum(s.strokes); s.strokes = null; }
    });
    rerenderForm();
  };
  acts['rf-step'] = el => {
    const s = draft.sections[el.dataset.s], h = Number(el.dataset.h);
    s.strokes[h] = Math.min(15, Math.max(1, s.strokes[h] + Number(el.dataset.d)));
    $(`#v-${el.dataset.s}-${h}`).textContent = s.strokes[h];
    $(`#lbl-${el.dataset.s}-${h}`).innerHTML = holeTag(s.strokes[h], s.pars[h]);
    updateTotals();
  };
  acts['rf-par'] = el => {
    const s = draft.sections[el.dataset.s], h = Number(el.dataset.h);
    s.pars[h] = s.pars[h] >= 5 ? 3 : s.pars[h] + 1;
    el.textContent = '파' + s.pars[h];
    $(`#lbl-${el.dataset.s}-${h}`).innerHTML = holeTag(s.strokes[h], s.pars[h]);
    updateTotals();
  };
  acts['rf-tot'] = el => { readRoundInputs(); const s = draft.sections[el.dataset.s]; s.total = Math.max(9, (Number(s.total) || 0) + Number(el.dataset.d)); $('#t-' + el.dataset.s).value = s.total; updateTotals(); };
  acts['rf-ob'] = el => { draft.ob = Math.max(0, draft.ob + Number(el.dataset.d)); $('#rf-ob').textContent = draft.ob; };
  acts['rf-cond'] = el => { draft.condition = el.dataset.v; document.querySelectorAll('[data-act="rf-cond"]').forEach(b => b.setAttribute('aria-pressed', b === el)); };
  acts['rf-wxtag'] = el => {
    const v = el.dataset.v, i = draft.wxTags.indexOf(v);
    if (i >= 0) draft.wxTags.splice(i, 1); else draft.wxTags.push(v);
    el.setAttribute('aria-pressed', i < 0);
  };
  acts['rf-addcourse'] = () => { readRoundInputs(); window._returnTo = 'round-new'; go('courses'); };
  acts['rf-wxload'] = async el => {
    readRoundInputs();
    const c = course(draft.courseId); if (!c || c.lat == null) return;
    el.disabled = true; el.innerHTML = '<span class="spinner"></span> 불러오는 중…';
    try { draft.weather = await WX.dayWeather(c.lat, c.lon, draft.date); $('#rf-wx').innerHTML = wxSummary(draft.weather); toast('그날 날씨를 넣었어요'); }
    catch (e) { toast('날씨를 불러오지 못했어요. 직접 골라 주세요.'); }
    el.disabled = false; el.textContent = '🌤️ 그날 날씨 다시 불러오기';
  };
  acts['rf-save'] = async el => {
    readRoundInputs();
    const d = draft; const c = course(d.courseId);
    el.disabled = true; el.innerHTML = '<span class="spinner"></span> 저장하는 중…';
    if (c && c.lat != null && (!d.weather || d.weather.date !== d.date)) {
      try { d.weather = Object.assign(await WX.dayWeather(c.lat, c.lon, d.date), { date: d.date }); } catch (e) { /* 날씨 없이 저장 */ }
    }
    const weather = d.weather || (d.wxTags.length ? {} : null);
    if (weather) { weather.tags = [...d.wxTags]; weather.date = d.date; }
    const rec = { id: d.id || uid(), kind: d.kind, title: d.title, date: d.date, courseId: d.courseId, courseName: c ? c.name : '', sections: d.sections.map(s => ({ name: s.name, pars: [...s.pars], strokes: d.detail ? [...s.strokes] : null, total: d.detail ? PG.sum(s.strokes) : Number(s.total) })), rank: d.rank, condition: d.condition, ob: d.ob, memo: d.memo, weather, eventId: d.eventId || '' };
    const i = db.rounds.findIndex(r => r.id === rec.id);
    if (i >= 0) db.rounds[i] = rec; else db.rounds.push(rec);
    if (c && d.detail) c.layout = rec.sections.map(s => ({ name: s.name, pars: [...s.pars] })); // 다음에 같은 골프장 고르면 파 배치 그대로
    save(); draft = null;
    toast('저장했어요');
    go('round-' + rec.id);
  };

  views.round = id => {
    const r = byId(db.rounds, id); if (!r) return views.rounds();
    const c = course(r.courseId);
    const a = PG.analyzeRound(r, db.rounds, c);
    const t = a.totals;
    let html = `<section class="card center"><p style="margin:0">${r.kind === '대회' ? '🏆 대회' : '⛳ 연습·친선'}${r.rank ? ` · <b>${esc(r.rank)}등</b>` : ''}</p>
      <h2 style="font-size:1.25rem;margin:6px 0">${esc(r.title || r.courseName || '경기')}</h2>
      <p class="muted" style="margin:0">${fmtDate(r.date, true)}${r.courseName ? ' · ' + esc(r.courseName) : ''}</p>
      <p class="huge" style="margin:12px 0 4px">${t.strokes}타</p><p class="big" style="margin:0">${diffTag(t.diff)} <span class="muted small">(기준 ${t.par}타 · ${t.holes}홀)</span></p></section>`;
    // 점수표
    html += `<section class="card"><h2>점수표</h2>`;
    for (const s of r.sections) {
      if (s.strokes) {
        html += `<h3>${esc(s.name)} 코스 · ${PG.sum(s.strokes)}타 ${diffTag(PG.sum(s.strokes) - PG.sum(s.pars))}</h3><div class="table-wrap"><table class="score"><tr><th>홀</th>${s.pars.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr><tr><th>파</th>${s.pars.map(p => `<td>${p}</td>`).join('')}</tr><tr><th>타수</th>${s.strokes.map((v, i) => `<td class="${v < s.pars[i] ? 's-under' : v - s.pars[i] >= 2 ? 's-over2' : ''}">${v}</td>`).join('')}</tr></table></div>`;
      } else html += `<p><b>${esc(s.name)} 코스</b>: ${s.total}타 ${diffTag(s.total - PG.sum(s.pars))}</p>`;
    }
    html += `</section>`;
    if (r.weather && (r.weather.tMax != null || (r.weather.tags || []).length)) html += `<section class="card"><h2>그날 날씨</h2>${wxSummary(r.weather)}${(r.weather.tags || []).length ? `<div class="chips">${r.weather.tags.map(x => `<span class="tag plain">${esc(x)}</span>`).join('')}</div>` : ''}</section>`;
    html += analysisCards(a.good, a.improve, a.practice, a.factors);
    if (r.memo) html += `<section class="card"><h2>메모</h2><p style="white-space:pre-wrap">${esc(r.memo)}</p></section>`;
    html += `<div class="btn-row"><button class="btn" data-act="speak-round" data-id="${r.id}">🔊 소리로 듣기</button><button class="btn" data-act="share-round" data-id="${r.id}">📤 보내기</button></div><div style="height:10px"></div>
      <div class="btn-row"><a class="btn ghost" href="#round-edit-${r.id}">✏️ 고치기</a><button class="btn danger" data-act="del-round" data-id="${r.id}">🗑️ 지우기</button></div>`;
    return { title: '성적 분석', html, back: 'rounds' };
  };
  function analysisCards(good, improve, practice, factors) {
    let h = '';
    if (factors && factors.length) h += `<section class="card"><h2>🔎 그날의 상황</h2>${factors.map(f => `<p>• ${esc(f)}</p>`).join('')}</section>`;
    h += `<section class="card"><h2>👍 잘한 점</h2>${good.map(g => `<div class="note good"><b>${esc(g.t)}</b>${esc(g.d)}</div>`).join('')}</section>`;
    h += `<section class="card"><h2>💡 보완할 점</h2>${improve.map(g => `<div class="note warn"><b>${esc(g.t)}</b>${esc(g.d)}</div>`).join('')}</section>`;
    h += `<section class="card"><h2>🏌️ 다음 연습 과제</h2>${practice.map((p, i) => `<div class="note info"><b>${i + 1}.</b>${esc(p)}</div>`).join('')}</section>`;
    return h;
  }
  function roundText(r) {
    const a = PG.analyzeRound(r, db.rounds, course(r.courseId));
    return `[파크골프 성적] ${fmtDate(r.date, true)}\n${r.title || ''} ${r.courseName || ''}\n총 ${a.totals.strokes}타 (${PG.sign(a.totals.diff)})${r.rank ? ` · ${r.rank}등` : ''}\n\n잘한 점\n${a.good.map(g => '· ' + g.t).join('\n')}\n\n보완할 점\n${a.improve.map(g => '· ' + g.t + ' — ' + g.d).join('\n')}\n\n연습 과제\n${a.practice.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
  }
  acts['speak-round'] = el => speak(roundText(byId(db.rounds, el.dataset.id)));
  acts['share-round'] = el => shareText('파크골프 성적', roundText(byId(db.rounds, el.dataset.id)));
  acts['del-round'] = async el => { if (await ask('이 기록을 지울까요?', '지우면 되돌릴 수 없어요.', '지우기', true)) { db.rounds = db.rounds.filter(r => r.id !== el.dataset.id); save(); go('rounds'); } };

  /* ════════════════ 나의 분석 ════════════════ */
  views.analysis = () => {
    const a = PG.analyzeOverall(db.rounds, db.courses);
    if (!a) return { title: '나의 플레이 분석', html: `<div class="empty"><span class="ico">📊</span>성적을 한 번 이상 기록하면<br>플레이 스타일을 분석해 드려요.</div><a class="btn primary block xl" href="#round-new">성적 기록하기</a>` };
    const bt = a.bestTotals;
    let html = `<section class="card"><h2>나의 플레이 스타일</h2><p class="big" style="margin:0">${esc(a.style)}</p></section>
    <div class="wx" style="margin-bottom:16px"><div><span class="k">기록한 경기</span><span class="v">${a.count}번</span></div><div><span class="k">9홀당 평균</span><span class="v">${PG.signF(a.avgPer9)}타</span></div>
      <div><span class="k">최고 기록</span><span class="v">${bt.strokes}타 (${PG.sign(bt.diff)})</span><span class="k">${fmtDate(a.best.date)}</span></div><div><span class="k">버디 이상</span><span class="v">${a.counts.birdie}번</span>${a.counts.hio ? `<span class="k">홀인원 ${a.counts.hio}번 🎉</span>` : ''}</div></div>`;
    if (a.series.length >= 2) html += `<section class="card"><h2>성적 흐름</h2><p class="muted small" style="margin-top:0">9홀마다 기준 타수보다 몇 타 더 쳤는지예요. <b>아래로 내려갈수록 잘 친 것</b>이에요. 점을 누르면 자세히 보여요.</p><div class="chart" id="chart"></div></section>`;
    const pt = a.parTypes;
    if (a.holesCount) html += `<section class="card"><h2>홀 종류별 평균</h2><p class="muted small" style="margin-top:0">기준 타수보다 평균 몇 타 더 쳤는지</p><div class="wx" style="grid-template-columns:repeat(3,1fr)">${[3, 4, 5].map(k => `<div><span class="k">파${k} 홀</span><span class="v">${pt[k] ? PG.signF(pt[k].avg) : '-'}</span><span class="k">${pt[k] ? pt[k].n + '홀' : ''}</span></div>`).join('')}</div></section>`;
    const wx = a.wxBuckets.filter(b => b.n);
    if (wx.length) html += `<section class="card"><h2>날씨별 성적</h2>${wx.map(b => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span class="grow"><b>${b.label}</b> <span class="muted small">${b.n}번</span></span><span class="big">${PG.signF(b.avg)}</span>${b.others != null ? `<span class="muted small">다른 날 ${PG.signF(b.others)}</span>` : ''}</div>`).join('')}<p class="muted small">숫자는 9홀당 기준보다 더 친 타수예요.</p></section>`;
    html += analysisCards(a.good, a.improve, a.practice);
    html += `<button class="btn block" data-act="speak-overall">🔊 소리로 듣기</button>`;
    return { title: '나의 플레이 분석', html, after: () => drawChart($('#chart'), a.series) };
  };
  acts['speak-overall'] = () => {
    const a = PG.analyzeOverall(db.rounds, db.courses);
    speak(`나의 플레이 스타일은 ${a.style}. 잘한 점. ${a.good.map(g => g.t).join('. ')}. 보완할 점. ${a.improve.map(g => g.t + '. ' + g.d).join(' ')} 연습 과제. ${a.practice.join(' ')}`);
  };

  /* 성적 흐름 그래프 (한 줄) */
  function drawChart(box, series) {
    if (!box || series.length < 2) return;
    const W = 600, H = 260, L = 44, R = 16, T = 16, B = 40;
    const ys = series.map(s => s.per9);
    let lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
    const padY = (hi - lo) * 0.15 || 1; lo -= padY; hi += padY;
    const x = i => L + (series.length === 1 ? 0 : (i * (W - L - R)) / (series.length - 1));
    const y = v => T + ((v - lo) / (hi - lo)) * (H - T - B); // 아래로 = 큰 값? → 잘 친 게 아래가 되도록 큰 값(많이 침)이 위
    const yy = v => H - B - (y(v) - T); // 뒤집기: 많이 친 것이 위
    const step = Math.max(1, Math.ceil((hi - lo) / 5));
    let grid = '';
    for (let v = Math.ceil(lo); v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${yy(v)}" y2="${yy(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${yy(v) + 5}" text-anchor="end" font-size="14" fill="var(--muted)">${v > 0 ? '+' + v : v}</text>`;
    const par0 = `<line x1="${L}" x2="${W - R}" y1="${yy(0)}" y2="${yy(0)}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${yy(0) - 6}" text-anchor="end" font-size="13" fill="var(--muted)">기준(파)</text>`;
    const path = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yy(s.per9).toFixed(1)}`).join(' ');
    const labelIdx = [0, series.length - 1];
    const xl = labelIdx.map(i => `<text x="${x(i)}" y="${H - 12}" text-anchor="${i ? 'end' : 'start'}" font-size="14" fill="var(--muted)">${series[i].date.slice(2).replace(/-/g, '.')}</text>`).join('');
    const dots = series.map((s, i) => `<circle cx="${x(i)}" cy="${yy(s.per9)}" r="6" fill="var(--primary)" stroke="var(--card)" stroke-width="2"/><circle cx="${x(i)}" cy="${yy(s.per9)}" r="22" fill="transparent" data-i="${i}" style="cursor:pointer"/>`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="경기별 9홀당 기준 대비 타수 그래프">${grid}${par0}<path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xl}</svg><div class="tip"></div>`;
    const tip = box.querySelector('.tip'), svg = box.querySelector('svg');
    const show = i => {
      const s = series[i], r = svg.getBoundingClientRect(), k = r.width / W;
      tip.innerHTML = `${fmtDate(s.date)} · ${esc(s.name || '')}<br>${s.totals.strokes}타 (${PG.sign(s.totals.diff)})`;
      tip.style.left = Math.min(r.width - 70, Math.max(70, x(i) * k)) + 'px'; tip.style.top = yy(s.per9) * k + 'px'; tip.style.display = 'block';
    };
    svg.querySelectorAll('[data-i]').forEach(c => { c.addEventListener('mouseenter', () => show(+c.dataset.i)); c.addEventListener('click', () => show(+c.dataset.i)); });
    svg.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  }

  /* ════════════════ 내기 ════════════════ */
  views.bets = () => {
    const live = db.bets.filter(b => b.status === 'playing');
    const done = db.bets.filter(b => b.status === 'done').sort((a, b) => b.date.localeCompare(a.date));
    let html = `<a class="btn primary block xl" href="#bet-new">＋ 새 내기 시작하기</a>`;
    if (live.length) html += `<h2 class="section-title">하고 있는 내기</h2><ul class="list">${live.map(b => `<li><a href="#bet-play-${b.id}"><span class="ico">⏳</span><span class="main"><span class="title">${esc(b.players.join(' · '))}</span><span class="sub">${fmtDate(b.date)} · 점당 ${wonPlain(b.unit)}</span></span><span class="right small">이어서<br>하기 ▶</span></a></li>`).join('')}</ul>`;
    // 누적
    const me = db.settings.name;
    const acc = {};
    for (const b of done) { const s = PG.settleBet(b); for (const p of b.players) acc[p] = (acc[p] || 0) + s.money[p]; }
    const names = Object.keys(acc).sort((a, b) => acc[b] - acc[a]);
    if (names.length) html += `<section class="card"><h2>지금까지 내기 합계</h2>${names.map(p => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)"><span class="grow big">${esc(p)}${p === me ? ' <span class="tag info">나</span>' : ''}</span><span class="big ${acc[p] > 0 ? 'money-plus' : acc[p] < 0 ? 'money-minus' : ''}">${won(acc[p])}</span></div>`).join('')}<p class="muted small">＋는 딴 돈, −는 잃은 돈이에요.</p></section>`;
    if (done.length) html += `<h2 class="section-title">지난 내기</h2><ul class="list">${done.map(b => { const s = PG.settleBet(b); const mine = me && b.players.includes(me) ? s.money[me] : null; return `<li><a href="#bet-${b.id}"><span class="ico">💰</span><span class="main"><span class="title">${esc(b.players.join(' · '))}</span><span class="sub">${fmtDate(b.date)}${b.place ? ' · ' + esc(b.place) : ''} · ${b.totalsOnly ? '합계' : b.mode === 'hole' ? '홀 이기기' : '타당'}</span></span>${mine != null ? `<span class="right ${mine > 0 ? 'money-plus' : mine < 0 ? 'money-minus' : ''}">${won(mine)}</span>` : ''}</a></li>`; }).join('')}</ul>`;
    else if (!live.length) html += `<div class="empty"><span class="ico">💰</span>함께 친 분들 이름과 점당 금액만 정하면<br>타수를 넣을 때마다 자동으로 정산해 드려요.</div>`;
    return { title: '내기', html };
  };

  let bdraft = null;
  views['bet-new'] = () => {
    if (!bdraft) {
      const me = db.settings.name;
      const fav = db.courses.find(c => c.fav) || db.courses[0];
      bdraft = Object.assign({ players: me ? [me] : [], unit: 1000, mode: 'stroke', carry: false, bonus: false, totalsOnly: false, nHoles: 18, place: fav ? fav.name : '' }, window._betPrefill || {});
      window._betPrefill = null;
    }
    const d = bdraft;
    const recent = db.players.filter(p => !d.players.includes(p)).slice(0, 12);
    const units = [100, 500, 1000, 2000, 5000];
    let html = `<section class="card"><h2>1. 누구와 치나요?</h2>
      <div class="chips" style="margin-bottom:12px">${d.players.map((p, i) => `<button type="button" class="chip" aria-pressed="true" data-act="bn-rm" data-i="${i}" aria-label="${esc(p)} 빼기">${esc(p)} ✕</button>`).join('') || '<span class="muted">아직 아무도 없어요</span>'}</div>
      <div class="row"><input type="text" id="bn-name" class="grow" placeholder="이름 넣기" style="flex:1;min-width:0" enterkeyhint="done"><button type="button" class="btn primary" data-act="bn-add">추가</button></div>
      ${recent.length ? `<h3>전에 같이 친 분 (누르면 추가)</h3><div class="chips">${recent.map(p => `<button type="button" class="chip" data-act="bn-pick" data-v="${esc(p)}">＋ ${esc(p)}</button>`).join('')}</div>` : ''}
    </section>
    <section class="card"><h2>2. 점당 얼마?</h2>
      <div class="chips">${units.map(u => `<button type="button" class="chip" data-act="bn-unit" data-v="${u}" aria-pressed="${d.unit === u}">${u.toLocaleString()}원</button>`).join('')}</div>
      <label class="field" style="margin-top:12px"><span>직접 넣기 (원)</span><input type="number" inputmode="numeric" id="bn-unit" value="${d.unit}" step="100" min="0"></label>
    </section>
    <section class="card"><h2>3. 내기 방식</h2>
      <div class="seg">${[['stroke', '타당'], ['hole', '홀 이기기']].map(([v, l]) => `<button type="button" class="chip" data-act="bn-mode" data-v="${v}" aria-pressed="${d.mode === v}">${l}</button>`).join('')}</div>
      <div class="note info">${d.mode === 'stroke' ? '<b>타당</b>다 친 뒤 사람마다 서로 타수 차이만큼 주고받아요. 예) 나 70타, 영희 73타, 점당 1,000원 → 영희가 나에게 3,000원.' : '<b>홀 이기기</b>홀마다 혼자 제일 적게 친 사람이 다른 사람들에게 1점씩 받아요. 같은 타수가 있으면 그 홀은 비겨요.'}</div>
      ${d.mode === 'hole' ? `<button type="button" class="check" data-act="bn-toggle" data-k="carry" aria-pressed="${d.carry}"><span class="box">${d.carry ? '✓' : ''}</span><span class="lbl">비기면 다음 홀로 점수 쌓기 (이월)</span></button>` : ''}
      <button type="button" class="check" data-act="bn-toggle" data-k="bonus" aria-pressed="${d.bonus}" ${d.totalsOnly ? 'disabled' : ''}><span class="box">${d.bonus ? '✓' : ''}</span><span class="lbl">버디 보너스 (버디 1점, 홀인원 3점씩 더 받기)</span></button>
    </section>
    <section class="card"><h2>4. 몇 홀 치나요?</h2>
      <div class="seg">${[9, 18, 27, 36].map(n => `<button type="button" class="chip" data-act="bn-holes" data-v="${n}" aria-pressed="${d.nHoles === n}">${n}홀</button>`).join('')}</div>
      <div style="height:12px"></div>
      <div class="seg">${[[false, '홀마다 넣기'], [true, '합계만 넣기']].map(([v, l]) => `<button type="button" class="chip" data-act="bn-tot" data-v="${v}" aria-pressed="${d.totalsOnly === v}">${l}</button>`).join('')}</div>
      ${d.totalsOnly ? '<p class="muted small">합계만 넣을 때는 타당 방식으로만 계산해요.</p>' : ''}
      <label class="field" style="margin-top:12px"><span>골프장 (안 넣어도 돼요)</span><input type="text" id="bn-place" value="${esc(d.place)}" list="bn-courses"><datalist id="bn-courses">${db.courses.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
    </section>
    <button type="button" class="btn primary block xl" data-act="bn-start">▶ 내기 시작</button>`;
    return { title: '새 내기', html, back: 'bets', after: () => { const n = $('#bn-name'); n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); acts['bn-add'](); } }); } };
  };
  const rerenderBet = () => { const y = window.scrollY; readBetInputs(); render(); window.scrollTo(0, y); };
  function readBetInputs() { const u = $('#bn-unit'); if (u) bdraft.unit = Math.max(0, Number(u.value) || 0); const p = $('#bn-place'); if (p) bdraft.place = p.value.trim(); }
  acts['bn-add'] = () => {
    const n = $('#bn-name'); const v = n.value.trim();
    if (!v) return toast('이름을 넣어 주세요');
    if (bdraft.players.includes(v)) return toast('이미 있는 이름이에요');
    if (bdraft.players.length >= 8) return toast('8명까지 할 수 있어요');
    bdraft.players.push(v); rerenderBet(); setTimeout(() => $('#bn-name') && $('#bn-name').focus(), 50);
  };
  acts['bn-pick'] = el => { if (bdraft.players.length >= 8) return toast('8명까지 할 수 있어요'); bdraft.players.push(el.dataset.v); rerenderBet(); };
  acts['bn-rm'] = el => { bdraft.players.splice(Number(el.dataset.i), 1); rerenderBet(); };
  acts['bn-unit'] = el => { bdraft.unit = Number(el.dataset.v); $('#bn-unit').value = bdraft.unit; rerenderBet(); };
  acts['bn-mode'] = el => { bdraft.mode = el.dataset.v; rerenderBet(); };
  acts['bn-toggle'] = el => { bdraft[el.dataset.k] = !bdraft[el.dataset.k]; rerenderBet(); };
  acts['bn-holes'] = el => { bdraft.nHoles = Number(el.dataset.v); rerenderBet(); };
  acts['bn-tot'] = el => { bdraft.totalsOnly = el.dataset.v === 'true'; if (bdraft.totalsOnly) { bdraft.mode = 'stroke'; bdraft.bonus = false; } rerenderBet(); };
  acts['bn-start'] = () => {
    readBetInputs();
    const d = bdraft;
    if (d.players.length < 2) return toast('두 명 이상 넣어 주세요');
    const c = db.courses.find(x => x.name === d.place);
    const pars = [];
    const lay = (c && c.layout) || [];
    for (let i = 0; i < d.nHoles / 9; i++) pars.push(...(lay[i] ? lay[i].pars : PG.DEFAULT_PARS));
    const bet = { id: uid(), date: today(), place: d.place, players: [...d.players], unit: d.unit, mode: d.totalsOnly ? 'stroke' : d.mode, carry: d.carry, bonus: !d.totalsOnly && d.bonus, totalsOnly: d.totalsOnly, pars, scores: {}, totals: {}, cur: 0, status: 'playing' };
    for (const p of bet.players) { bet.scores[p] = pars.map(() => null); bet.totals[p] = PG.sum(pars); }
    db.bets.push(bet);
    for (const p of bet.players) { db.players = [p, ...db.players.filter(x => x !== p)].slice(0, 30); }
    save(); bdraft = null;
    go('bet-play-' + bet.id);
  };

  views['bet-play'] = id => {
    const b = byId(db.bets, id); if (!b) return views.bets();
    const s = PG.settleBet(b);
    let html = '';
    if (b.totalsOnly) {
      html += `<section class="card"><h2>사람마다 전체 타수를 넣으세요</h2><p class="muted small">기준 ${PG.sum(b.pars)}타 (${b.pars.length}홀)</p>${b.players.map((p, i) => `<div class="player-row"><span class="name">${esc(p)}</span><div class="stepper"><button type="button" data-act="bp-tot" data-i="${i}" data-d="-1" aria-label="${esc(p)} 한 타 빼기">－</button><input type="number" inputmode="numeric" class="val" data-tot="${i}" value="${b.totals[p]}" style="width:3.4em;min-height:60px;text-align:center;font-weight:900;font-size:1.5rem;padding:4px"><button type="button" class="plus" data-act="bp-tot" data-i="${i}" data-d="1" aria-label="${esc(p)} 한 타 더하기">＋</button></div></div>`).join('')}</section>`;
      html += liveBox(b, s);
      html += `<button type="button" class="btn primary block xl" data-act="bp-finish" data-id="${b.id}">🧮 정산하기</button>`;
    } else {
      const i = b.cur, par = b.pars[i], n = b.pars.length;
      const sec = Math.floor(i / 9), names = PG.SECTION_NAMES;
      html += `<section class="card center"><p class="muted" style="margin:0">${names[sec] || ''} 코스</p><p class="huge" style="margin:4px 0">${i + 1}번 홀</p><button type="button" class="par-chip" data-act="bp-par" style="font-size:1.1rem;padding:6px 18px">기준 파${par} (눌러서 바꾸기)</button>
        <div class="dots" aria-label="홀 고르기">${b.pars.map((_, k) => `<button type="button" data-act="bp-go" data-k="${k}" class="${k === i ? 'cur' : b.players.every(p => b.scores[p][k]) ? 'done' : ''}" aria-label="${k + 1}번 홀">${k + 1}</button>`).join('')}</div></section>
      <section class="card">${b.players.map((p, pi) => { const v = b.scores[p][i] || par; return `<div class="player-row"><div><span class="name">${esc(p)}</span><br><span class="muted small">지금까지 ${s.totals[p] - (b.scores[p][i] || 0) + v}타</span> ${holeTag(v, par)}</div><div class="stepper"><button type="button" data-act="bp-step" data-p="${pi}" data-d="-1" aria-label="${esc(p)} 한 타 빼기">－</button><span class="val">${v}</span><button type="button" class="plus" data-act="bp-step" data-p="${pi}" data-d="1" aria-label="${esc(p)} 한 타 더하기">＋</button></div></div>`; }).join('')}</section>
      <div class="btn-row"><button type="button" class="btn" data-act="bp-prev" ${i === 0 ? 'disabled' : ''}>◀ 이전 홀</button>${i < n - 1 ? `<button type="button" class="btn primary" data-act="bp-next">다음 홀 ▶</button>` : `<button type="button" class="btn primary" data-act="bp-finish" data-id="${b.id}">🧮 정산하기</button>`}</div>
      <div style="height:16px"></div>${liveBox(b, s)}
      ${i < n - 1 ? `<button type="button" class="btn ghost block" data-act="bp-finish" data-id="${b.id}">여기까지만 하고 정산하기</button>` : ''}`;
    }
    html += `<div style="height:10px"></div><button type="button" class="btn danger block" data-act="bp-del" data-id="${b.id}">이 내기 지우기</button>`;
    return { title: `내기 · 점당 ${wonPlain(b.unit)}`, html, back: 'bets', after: () => {
      document.querySelectorAll('[data-tot]').forEach(inp => inp.addEventListener('change', () => { b.totals[b.players[inp.dataset.tot]] = Math.max(0, Number(inp.value) || 0); save(); refreshLive(b); }));
    } };
  };
  function liveBox(b, s) {
    return `<section class="card" id="liveBox"><h2>지금 정산하면 ${b.totalsOnly ? '' : `<span class="muted small">(${s.holesDone}홀까지)</span>`}</h2>${[...b.players].sort((x, y) => s.money[y] - s.money[x]).map(p => `<div class="row" style="padding:6px 0"><span class="grow"><b>${esc(p)}</b> <span class="muted small">${s.totals[p]}타</span></span><span class="big ${s.money[p] > 0 ? 'money-plus' : s.money[p] < 0 ? 'money-minus' : ''}">${won(s.money[p])}</span></div>`).join('')}</section>`;
  }
  function refreshLive(b) { const el = $('#liveBox'); if (el) el.outerHTML = liveBox(b, PG.settleBet(b)); }
  const curBet = () => byId(db.bets, parse().id);
  function fillHole(b) { const i = b.cur; for (const p of b.players) if (!b.scores[p][i]) b.scores[p][i] = b.pars[i]; }
  const rerenderKeep = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  acts['bp-step'] = el => { const b = curBet(); fillHole(b); const p = b.players[el.dataset.p]; b.scores[p][b.cur] = Math.min(15, Math.max(1, b.scores[p][b.cur] + Number(el.dataset.d))); save(); rerenderKeep(); };
  acts['bp-par'] = () => { const b = curBet(); b.pars[b.cur] = b.pars[b.cur] >= 5 ? 3 : b.pars[b.cur] + 1; save(); rerenderKeep(); };
  acts['bp-next'] = () => { const b = curBet(); fillHole(b); b.cur = Math.min(b.pars.length - 1, b.cur + 1); save(); render(); };
  acts['bp-prev'] = () => { const b = curBet(); b.cur = Math.max(0, b.cur - 1); save(); render(); };
  acts['bp-go'] = el => { const b = curBet(); b.cur = Number(el.dataset.k); save(); render(); };
  acts['bp-tot'] = el => { const b = curBet(); const p = b.players[el.dataset.i]; b.totals[p] = Math.max(0, (Number(b.totals[p]) || 0) + Number(el.dataset.d)); save(); const inp = document.querySelector(`[data-tot="${el.dataset.i}"]`); if (inp) inp.value = b.totals[p]; refreshLive(b); };
  acts['bp-finish'] = async el => {
    const b = byId(db.bets, el.dataset.id);
    if (!b.totalsOnly) {
      fillHole(b);
      const missing = b.pars.length - PG.completedHoles(b).length;
      if (missing > 0 && !(await ask('정산할까요?', `아직 넣지 않은 홀이 ${missing}개 있어요. 넣은 홀까지만 계산해요.`, '정산하기'))) return;
    }
    b.status = 'done'; save(); go('bet-' + b.id);
  };
  acts['bp-del'] = async el => { if (await ask('이 내기를 지울까요?', '지우면 되돌릴 수 없어요.', '지우기', true)) { db.bets = db.bets.filter(x => x.id !== el.dataset.id); save(); go('bets'); } };

  views.bet = id => {
    const b = byId(db.bets, id); if (!b) return views.bets();
    const s = PG.settleBet(b);
    const parSum = b.totalsOnly ? PG.sum(b.pars) : PG.completedHoles(b).reduce((a, i) => a + b.pars[i], 0);
    const medals = ['🥇', '🥈', '🥉'];
    let html = `<section class="card"><p class="muted" style="margin:0">${fmtDate(b.date, true)}${b.place ? ' · ' + esc(b.place) : ''}</p><p style="margin:4px 0 0"><b>${b.totalsOnly || b.mode === 'stroke' ? '타당' : '홀 이기기'}</b> · 점당 ${wonPlain(b.unit)}${b.bonus ? ' · 버디 보너스' : ''}${b.carry ? ' · 이월' : ''}${s.holesDone != null ? ` · ${s.holesDone}홀` : ''}</p></section>
      <section class="card"><h2>🏆 순위와 정산</h2>${s.ranking.map((p, i) => `<div class="rank-row"><span class="medal">${medals[i] || i + 1 + '등'}</span><div><span class="big">${esc(p)}</span><br><span class="muted">${s.totals[p]}타 ${diffTag(s.totals[p] - parSum)}</span></div><span class="big ${s.money[p] > 0 ? 'money-plus' : s.money[p] < 0 ? 'money-minus' : ''}">${won(s.money[p])}</span></div>`).join('')}</section>
      <section class="card"><h2>💸 이렇게 주고받으세요</h2>${s.transfers.length ? s.transfers.map(t => `<div class="transfer"><span class="who">${esc(t.from)}님 ➜ ${esc(t.to)}님께</span><span class="amt">${wonPlain(t.amount)}</span></div>`).join('') : '<p>주고받을 돈이 없어요. 모두 비겼어요!</p>'}</section>`;
    const holeLog = s.log.filter(l => l.hole);
    if (holeLog.length) html += `<section class="card"><details><summary class="big" style="cursor:pointer;min-height:48px">홀별 내용 보기</summary>${holeLog.map(l => `<p>• ${l.hole}번 홀: ${l.bonus ? `${esc(l.bonus)} ${esc(l.what)} 보너스 ${l.k}점` : l.winner ? `${esc(l.winner)} 승 (${l.pot}점)` : '비김' + (b.carry ? ' → 다음 홀로' : '')}</p>`).join('')}</details></section>`;
    html += `<div class="btn-row"><button class="btn" data-act="bet-share" data-id="${b.id}">📤 결과 보내기</button><button class="btn" data-act="bet-speak" data-id="${b.id}">🔊 소리로 듣기</button></div><div style="height:10px"></div>
      <div class="btn-row"><button class="btn ghost" data-act="bet-reopen" data-id="${b.id}">✏️ 타수 고치기</button><button class="btn" data-act="bet-again" data-id="${b.id}">🔁 같은 분들과 또</button></div><div style="height:10px"></div>
      <button class="btn danger block" data-act="bp-del" data-id="${b.id}">🗑️ 지우기</button>`;
    return { title: '내기 결과', html, back: 'bets' };
  };
  function betText(b) {
    const s = PG.settleBet(b);
    return `[파크골프 내기 결과] ${fmtDate(b.date, true)}${b.place ? ' ' + b.place : ''}\n점당 ${wonPlain(b.unit)}\n\n${s.ranking.map((p, i) => `${i + 1}등 ${p} ${s.totals[p]}타  ${won(s.money[p])}`).join('\n')}\n\n주고받을 돈\n${s.transfers.map(t => `${t.from} → ${t.to} ${wonPlain(t.amount)}`).join('\n') || '없음'}`;
  }
  acts['bet-share'] = el => shareText('내기 결과', betText(byId(db.bets, el.dataset.id)));
  acts['bet-speak'] = el => { const b = byId(db.bets, el.dataset.id); const s = PG.settleBet(b); speak(s.ranking.map((p, i) => `${i + 1}등 ${p}, ${s.totals[p]}타, ${s.money[p] >= 0 ? '받을 돈' : '줄 돈'} ${wonPlain(s.money[p])}`).join('. ') + '. ' + s.transfers.map(t => `${t.from}님이 ${t.to}님에게 ${wonPlain(t.amount)}`).join('. ')); };
  acts['bet-reopen'] = el => { const b = byId(db.bets, el.dataset.id); b.status = 'playing'; save(); go('bet-play-' + b.id); };
  acts['bet-again'] = el => { const b = byId(db.bets, el.dataset.id); bdraft = null; window._betPrefill = { players: [...b.players], unit: b.unit, mode: b.mode, carry: b.carry, bonus: b.bonus, totalsOnly: b.totalsOnly, nHoles: b.pars.length, place: b.place }; go('bet-new'); };

  /* ════════════════ 골프장 ════════════════ */
  let searchState = { q: '', results: null, loading: false, err: '' };
  views.courses = () => {
    let html = `<section class="card"><h2>🔍 골프장 찾기</h2>
      <div class="row"><input type="search" id="cs-q" class="grow" style="flex:1;min-width:0" placeholder="예) 반포, 송도, OO파크골프장" value="${esc(searchState.q)}" enterkeyhint="search"><button class="btn primary" data-act="cs-search">찾기</button></div>
      <div style="height:10px"></div><button class="btn block" data-act="cs-near">📍 내 주변 골프장 찾기</button>
      <div id="cs-results">${searchResultsHtml()}</div>
      <a class="btn ghost block" href="#course-new" style="margin-top:10px">✏️ 직접 입력해서 추가</a></section>`;
    if (window._returnTo) html = `<div class="note info"><b>골프장을 추가하면</b>성적 입력 화면으로 돌아갈 수 있어요. <a href="#${window._returnTo}" data-act="cs-return">돌아가기 ▶</a></div>` + html;
    if (db.courses.length) {
      html += `<h2 class="section-title">내 골프장</h2><ul class="list">${db.courses.map(c => `<li><a href="#course-${c.id}"><span class="ico">${c.fav ? '⭐' : '⛳'}</span><span class="main"><span class="title">${esc(c.name)}</span><span class="sub">${esc(c.address || '')}</span></span><span class="right small" data-mini="${c.id}">${c.lat != null ? '<span class="spinner"></span>' : ''}</span></a></li>`).join('')}</ul>`;
    } else html += `<div class="empty"><span class="ico">⛳</span>자주 가는 골프장을 찾아 추가해 두면<br>날씨와 운영 상황을 바로 볼 수 있어요.</div>`;
    return { title: '골프장', html, after: () => {
      const q = $('#cs-q'); q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); acts['cs-search'](); } });
      db.courses.forEach(async c => {
        const el = document.querySelector(`[data-mini="${c.id}"]`); if (!el || c.lat == null) return;
        try { const d = await courseNow(c); el.innerHTML = `${WX.wxIcon(d.w.current.weather_code)} ${Math.round(d.w.current.temperature_2m)}℃<br><span class="tag ${['good', 'warn', 'bad'][d.status.level]}">${d.status.label}</span>`; } catch (e) { el.textContent = ''; }
      });
    } };
  };
  function searchResultsHtml() {
    const s = searchState;
    if (s.loading) return `<p class="muted"><span class="spinner"></span> 찾는 중…</p>`;
    if (s.err) return `<div class="note bad">${esc(s.err)}</div>`;
    if (!s.results) return '';
    if (!s.results.length) return `<div class="note warn"><b>찾지 못했어요</b>동네 이름만 넣어 보거나, '직접 입력해서 추가'를 눌러 주세요.</div>`;
    return `<h3>찾은 곳 (${s.results.length}곳) — 눌러서 추가</h3><ul class="list">${s.results.map((r, i) => {
      const have = db.courses.find(c => c.name === r.name);
      return `<li><button class="item" data-act="cs-add" data-i="${i}"><span class="ico">${have ? '✅' : '➕'}</span><span class="main"><span class="title">${esc(r.name)}</span><span class="sub">${esc(r.address || '')}${r.dist != null ? ` · ${r.dist.toFixed(1)}km` : ''}</span></span></button></li>`;
    }).join('')}</ul>`;
  }
  const paintResults = () => { const el = $('#cs-results'); if (el) el.innerHTML = searchResultsHtml(); };
  acts['cs-search'] = async () => {
    const q = $('#cs-q').value.trim(); if (!q) return toast('찾을 이름을 넣어 주세요');
    searchState = { q, results: null, loading: true, err: '' }; paintResults();
    try { searchState.results = await WX.searchCourses(q); } catch (e) { searchState.err = '인터넷 연결을 확인해 주세요.'; }
    searchState.loading = false; paintResults();
  };
  acts['cs-near'] = () => {
    if (!navigator.geolocation) return toast('위치 기능을 쓸 수 없어요');
    searchState = { q: '', results: null, loading: true, err: '' }; paintResults();
    navigator.geolocation.getCurrentPosition(async pos => {
      try { searchState.results = await WX.nearbyCourses(pos.coords.latitude, pos.coords.longitude, 15); } catch (e) { searchState.err = '주변 골프장을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.'; }
      searchState.loading = false; paintResults();
    }, () => { searchState.loading = false; searchState.err = '위치 사용을 허용해 주세요. (휴대폰 설정 → 위치)'; paintResults(); }, { timeout: 15000 });
  };
  acts['cs-add'] = el => {
    const r = searchState.results[Number(el.dataset.i)];
    let c = db.courses.find(x => x.name === r.name);
    if (!c) {
      c = { id: uid(), name: r.name, address: r.address, lat: r.lat, lon: r.lon, phone: r.phone || '', fav: !db.courses.length, info: { closedDays: [], open: '', close: '' }, features: {}, memo: r.hours ? '운영시간(지도 정보): ' + r.hours : '' };
      db.courses.push(c); save(); toast('내 골프장에 추가했어요');
    }
    if (window._returnTo === 'round-new' && draft) { draft.courseId = c.id; draft.sections = []; setSections(draft, draft.nSec); window._returnTo = null; return go('round-new'); }
    go('course-' + c.id);
  };
  acts['cs-return'] = el => { const t = window._returnTo; window._returnTo = null; go(t); };

  views.course = id => {
    const c = course(id); if (!c) return views.courses();
    const f = c.features || {}, info = c.info || {};
    const rs = db.rounds.filter(r => r.courseId === c.id);
    const stats = rs.length ? { n: rs.length, avg: PG.avg(rs.map(r => PG.roundTotals(r).per9)), best: Math.min(...rs.map(r => PG.roundTotals(r).diff)) } : null;
    const naver = 'https://map.naver.com/p/search/' + encodeURIComponent(c.name);
    const kakao = c.lat != null ? `https://map.kakao.com/link/map/${encodeURIComponent(c.name)},${c.lat},${c.lon}` : 'https://map.kakao.com/?q=' + encodeURIComponent(c.name);
    const missing = !f.grass || !info.open;
    let html = `<section class="card"><h2 style="font-size:1.25rem">${c.fav ? '⭐ ' : ''}${esc(c.name)}</h2><p class="muted">${esc(c.address || '주소 없음')}</p>
      <div class="btn-row">${c.phone ? `<a class="btn primary" href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">📞 전화하기</a>` : `<a class="btn ghost" href="#course-edit-${c.id}">📞 전화번호 넣기</a>`}<a class="btn" href="${kakao}" target="_blank" rel="noopener">🗺️ 지도 보기</a></div>
      ${c.phone ? `<p class="center muted small">${esc(c.phone)}</p>` : ''}<p class="center small"><a href="${naver}" target="_blank" rel="noopener">네이버 지도에서 찾기</a></p></section>
      <section class="card"><h2>오늘 운영 상황 (예상)</h2><div id="cwx">${c.lat != null ? '<p class="muted"><span class="spinner"></span> 날씨를 불러오는 중…</p>' : `<p class="muted">위치가 없어 날씨를 볼 수 없어요.</p><a class="btn block" href="#course-edit-${c.id}">위치 찾기</a>`}</div>
      <p class="muted small">날씨와 휴장일로 짐작한 것이에요. 대회·공사로 쉴 수도 있으니 가기 전에 꼭 전화로 확인하세요.</p></section>`;
    html += `<section class="card"><h2>골프장 특징</h2>
      ${missing ? `<div class="note info"><b>정보를 채워 주세요</b>잔디·경사·휴장일을 넣으면 운영 예상과 성적 분석이 더 정확해져요.</div>` : ''}
      <div class="wx"><div><span class="k">잔디</span><span class="v">${esc(f.grass || '모름')}</span></div><div><span class="k">경사</span><span class="v">${esc(f.terrain || '모름')}</span></div><div><span class="k">코스 길이</span><span class="v">${esc(f.length || '모름')}</span></div><div><span class="k">강가(하천)</span><span class="v">${f.river ? '예' : '아니요'}</span></div>
      <div><span class="k">휴장일</span><span class="v">${info.closedDays && info.closedDays.length ? info.closedDays.map(d => DOW[d]).join('·') + '요일' : '모름'}</span></div><div><span class="k">운영 시간</span><span class="v">${info.open ? `${esc(info.open)}~${esc(info.close)}` : '모름'}</span></div></div>
      ${c.memo ? `<p style="white-space:pre-wrap">${esc(c.memo)}</p>` : ''}</section>`;
    if (stats) html += `<section class="card"><h2>여기서 친 기록</h2><div class="wx"><div><span class="k">경기 수</span><span class="v">${stats.n}번</span></div><div><span class="k">9홀당 평균</span><span class="v">${PG.signF(stats.avg)}</span></div></div></section>`;
    html += `<div class="btn-row"><a class="btn ghost" href="#course-edit-${c.id}">✏️ 정보 고치기</a><button class="btn" data-act="c-round" data-id="${c.id}">📝 여기서 친 성적</button></div><div style="height:10px"></div>
      <div class="btn-row"><button class="btn" data-act="c-event" data-id="${c.id}">📅 여기로 일정</button><button class="btn danger" data-act="c-del" data-id="${c.id}">🗑️ 지우기</button></div>`;
    return { title: '골프장 정보', html, back: 'courses', after: () => loadCourseWx(c) };
  };
  async function loadCourseWx(c) {
    const box = $('#cwx'); if (!box || c.lat == null) return;
    try {
      const d = await courseNow(c); const cur = d.w.current; const st = d.status;
      const pm = d.aq && d.aq.current ? WX.pmGrade(d.aq.current.pm10, d.aq.current.pm2_5) : null;
      const hours = WX.bestHours(d.w);
      const D = d.w.daily; const todayIdx = D.time.indexOf(today());
      let h = `<div class="status-big ${['good', 'warn', 'bad'][st.level]}"><span class="ico">${st.icon}</span><div><div class="t">${st.label}</div></div></div>${st.reasons.map(r => `<p>• ${esc(r)}</p>`).join('')}
        <div class="wx" style="margin-top:12px"><div><span class="k">지금 날씨</span><span class="v">${WX.wxIcon(cur.weather_code)} ${WX.wxName(cur.weather_code)}</span></div><div><span class="k">기온 (체감)</span><span class="v">${Math.round(cur.temperature_2m)}℃ <span class="small">(${Math.round(cur.apparent_temperature)}℃)</span></span></div>
        <div><span class="k">바람</span><span class="v">초속 ${Math.round(cur.wind_speed_10m)}m</span></div><div><span class="k">미세먼지</span><span class="v">${pm ? pm.icon + ' ' + pm.name : '-'}</span></div>
        ${todayIdx >= 0 ? `<div><span class="k">오늘 최고/최저</span><span class="v">${Math.round(D.temperature_2m_max[todayIdx])}° / ${Math.round(D.temperature_2m_min[todayIdx])}°</span></div><div><span class="k">비 올 확률</span><span class="v">${D.precipitation_probability_max[todayIdx] != null ? D.precipitation_probability_max[todayIdx] + '%' : '-'}</span></div>
        <div><span class="k">해 뜨는 시간</span><span class="v">${D.sunrise[todayIdx].slice(11)}</span></div><div><span class="k">해 지는 시간</span><span class="v">${D.sunset[todayIdx].slice(11)}</span></div>` : ''}</div>`;
      if (hours.length) { const best = hours.find(x => x.best); h += `<h3>오늘 시간별 날씨 ${best ? `<span class="tag good">${best.hour}시가 가장 좋아요</span>` : ''}</h3><div class="hours">${hours.map(x => `<div class="${x.best ? 'best' : ''}"><b>${x.hour}시</b><br>${WX.wxIcon(x.code)}<br>${Math.round(x.temp)}℃<br><span class="muted">비 ${x.pop}%</span></div>`).join('')}</div>`; }
      const fut = D.time.map((t, i) => ({ t, i })).filter(x => x.t > today()).slice(0, 3);
      if (fut.length) h += `<h3>앞으로 3일</h3><div class="hours">${fut.map(({ t, i }) => `<div style="min-width:96px"><b>${fmtDate(t).replace(/^\d+월 /, '')}</b><br>${WX.wxIcon(D.weather_code[i])} ${WX.wxName(D.weather_code[i])}<br>${Math.round(D.temperature_2m_min[i])}°/${Math.round(D.temperature_2m_max[i])}°<br><span class="muted">비 ${D.precipitation_probability_max[i] != null ? D.precipitation_probability_max[i] : '-'}%</span></div>`).join('')}</div>`;
      box.innerHTML = h;
    } catch (e) { box.innerHTML = `<div class="note bad"><b>날씨를 불러오지 못했어요</b>인터넷 연결을 확인하고 다시 열어 주세요.</div>`; }
  }
  acts['c-round'] = el => { const c = course(el.dataset.id); const rs = db.rounds.filter(r => r.courseId === c.id); if (!rs.length) { draft = null; window._roundPrefill = { courseId: c.id }; return go('round-new'); } go('rounds'); };
  acts['c-event'] = el => { evDraft = null; window._eventPrefill = { courseId: el.dataset.id }; go('event-new'); };
  acts['c-del'] = async el => { if (await ask('이 골프장을 지울까요?', '성적 기록은 남아 있어요.', '지우기', true)) { db.courses = db.courses.filter(c => c.id !== el.dataset.id); save(); go('courses'); } };

  let cdraft = null;
  views['course-new'] = () => { cdraft = { id: '', name: '', address: '', lat: null, lon: null, phone: '', fav: !db.courses.length, info: { closedDays: [], open: '', close: '' }, features: {}, memo: '' }; return courseForm('골프장 직접 추가', 'courses'); };
  views['course-edit'] = id => { const c = course(id); if (!c) return views.courses(); cdraft = JSON.parse(JSON.stringify(c)); cdraft.info = Object.assign({ closedDays: [], open: '', close: '' }, cdraft.info); cdraft.features = cdraft.features || {}; return courseForm('골프장 정보 고치기', 'course-' + id); };
  function courseForm(title, back) {
    const c = cdraft, f = c.features, info = c.info;
    const seg = (k, opts) => `<div class="seg">${opts.map(o => `<button type="button" class="chip" data-act="cf-feat" data-k="${k}" data-v="${o}" aria-pressed="${f[k] === o}">${o}</button>`).join('')}</div>`;
    const html = `<section class="card">
      <label class="field"><span>골프장 이름</span><input type="text" id="cf-name" value="${esc(c.name)}" placeholder="예) 한강 OO파크골프장"></label>
      <label class="field"><span>주소 (동네 이름만 넣어도 돼요)</span><input type="text" id="cf-addr" value="${esc(c.address)}"></label>
      <button type="button" class="btn block" data-act="cf-locate">📍 위치 찾기 ${c.lat != null ? '<span class="tag good">찾음</span>' : ''}</button>
      <div id="cf-loc"></div>
      <div style="height:14px"></div>
      <label class="field"><span>전화번호</span><input type="tel" id="cf-phone" value="${esc(c.phone)}" placeholder="예) 02-123-4567"></label>
      <button type="button" class="check" data-act="cf-fav" aria-pressed="${!!c.fav}"><span class="box">${c.fav ? '✓' : ''}</span><span class="lbl">⭐ 자주 가는 곳 (처음 화면에 날씨 보이기)</span></button>
    </section>
    <section class="card"><h2>운영 정보</h2>
      <label class="field"><span>정기 휴장일 (여러 개 가능)</span></label>
      <div class="chips" style="margin-bottom:14px">${DOW.map((d, i) => `<button type="button" class="chip" data-act="cf-day" data-v="${i}" aria-pressed="${info.closedDays.includes(i)}">${d}</button>`).join('')}</div>
      <div class="btn-row"><label class="field"><span>여는 시간</span><input type="time" id="cf-open" value="${esc(info.open)}"></label><label class="field"><span>닫는 시간</span><input type="time" id="cf-close" value="${esc(info.close)}"></label></div>
    </section>
    <section class="card"><h2>코스 특징 (분석에 쓰여요)</h2>
      <h3>잔디</h3>${seg('grass', ['천연잔디', '인조잔디'])}
      <h3>경사</h3>${seg('terrain', ['평지', '보통', '경사 많음'])}
      <h3>코스 길이</h3>${seg('length', ['짧은 편', '보통', '긴 편'])}
      <div style="height:12px"></div>
      <button type="button" class="check" data-act="cf-river" aria-pressed="${!!f.river}"><span class="box">${f.river ? '✓' : ''}</span><span class="lbl">강가·하천 옆이에요 (바람·침수 영향)</span></button>
      <label class="field"><span>메모</span><textarea id="cf-memo" placeholder="예) 주차장 넓음, 3번 홀 그린 빠름">${esc(c.memo)}</textarea></label>
    </section>
    <button type="button" class="btn primary block xl" data-act="cf-save">💾 저장</button>`;
    return { title, html, back };
  }
  function readCourse() {
    const g = id => document.getElementById(id);
    cdraft.name = g('cf-name').value.trim(); cdraft.address = g('cf-addr').value.trim(); cdraft.phone = g('cf-phone').value.trim();
    cdraft.info.open = g('cf-open').value; cdraft.info.close = g('cf-close').value; cdraft.memo = g('cf-memo').value;
  }
  // 다시 그릴 때 cdraft 를 유지하려고 별도 처리
  const keepC = fn => el => { readCourse(); fn(el); const y = window.scrollY; const saved = cdraft; const r = parse(); const v = r.name === 'course-new' ? courseForm('골프장 직접 추가', 'courses') : courseForm('골프장 정보 고치기', 'course-' + r.id); cdraft = saved; app.innerHTML = v.html; window.scrollTo(0, y); };
  acts['cf-feat'] = keepC(el => { const k = el.dataset.k; cdraft.features[k] = cdraft.features[k] === el.dataset.v ? '' : el.dataset.v; });
  acts['cf-river'] = keepC(() => { cdraft.features.river = !cdraft.features.river; });
  acts['cf-fav'] = keepC(() => { cdraft.fav = !cdraft.fav; });
  acts['cf-day'] = keepC(el => { const v = Number(el.dataset.v), a = cdraft.info.closedDays, i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); });
  acts['cf-locate'] = async () => {
    readCourse();
    const q = [cdraft.name, cdraft.address].filter(Boolean).join(' ');
    if (!q) return toast('이름이나 주소를 먼저 넣어 주세요');
    const box = $('#cf-loc'); box.innerHTML = '<p class="muted"><span class="spinner"></span> 찾는 중…</p>';
    try {
      let res = await WX.searchCourses(q);
      if (!res.length && cdraft.address) res = await WX.searchCourses(cdraft.address);
      if (!res.length) { box.innerHTML = '<div class="note warn"><b>찾지 못했어요</b>주소를 동네 이름(예: 서초구 반포동)으로 바꿔 보세요.</div>'; return; }
      box.innerHTML = `<p><b>맞는 곳을 눌러 주세요</b></p><ul class="list">${res.slice(0, 6).map((r, i) => `<li><button class="item" data-act="cf-pick" data-i="${i}"><span class="ico">📍</span><span class="main"><span class="title">${esc(r.name)}</span><span class="sub">${esc(r.address)}</span></span></button></li>`).join('')}</ul>`;
      window._locRes = res;
    } catch (e) { box.innerHTML = '<div class="note bad">인터넷 연결을 확인해 주세요.</div>'; }
  };
  acts['cf-pick'] = keepC(el => { const r = window._locRes[Number(el.dataset.i)]; cdraft.lat = r.lat; cdraft.lon = r.lon; if (!cdraft.address) cdraft.address = r.address; if (!cdraft.name) cdraft.name = r.name; toast('위치를 찾았어요'); });
  acts['cf-save'] = () => {
    readCourse();
    if (!cdraft.name) return toast('골프장 이름을 넣어 주세요');
    if (cdraft.fav) db.courses.forEach(c => { if (c.id !== cdraft.id) c.fav = false; });
    if (!cdraft.id) { cdraft.id = uid(); db.courses.push(cdraft); } else { const i = db.courses.findIndex(c => c.id === cdraft.id); db.courses[i] = cdraft; }
    // 성적의 골프장 이름도 같이 맞춤
    db.rounds.forEach(r => { if (r.courseId === cdraft.id) r.courseName = cdraft.name; });
    save(); const id = cdraft.id; cdraft = null; toast('저장했어요');
    if (window._returnTo === 'round-new' && draft) { draft.courseId = id; draft.sections = []; setSections(draft, draft.nSec); window._returnTo = null; return go('round-new'); }
    go('course-' + id);
  };

  /* ════════════════ 일정 ════════════════ */
  const EV_ICON = { 대회: '🏆', 모임: '👥', 연습: '⛳', 기타: '📌' };
  views.schedule = () => {
    const up = db.events.filter(e => e.date >= today()).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const past = db.events.filter(e => e.date < today()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
    let html = `<a class="btn primary block xl" href="#event-new">＋ 일정 추가하기</a>`;
    const card = e => {
      const rec = e.type === '대회' && e.date <= today() && !db.rounds.find(r => r.eventId === e.id);
      return `<section class="card"><div class="row"><span style="font-size:2rem">${EV_ICON[e.type] || '📌'}</span><div class="grow"><p class="big" style="margin:0">${esc(e.title)}</p><p style="margin:0">${fmtDate(e.date)} ${fmtTime(e.time)}</p>${e.place ? `<p class="muted" style="margin:0">📍 ${esc(e.place)}</p>` : ''}</div><span class="dday">${dday(e.date)}</span></div>
        ${e.memo ? `<p class="muted small" style="white-space:pre-wrap">${esc(e.memo)}</p>` : ''}
        <div style="height:10px"></div>
        ${e.date >= today() ? `<div class="btn-row"><button class="btn" data-act="ev-ics" data-id="${e.id}">📅 삼성 캘린더</button><a class="btn" href="${gcalUrl(e)}" target="_blank" rel="noopener">구글 캘린더</a></div><div style="height:10px"></div>` : ''}
        ${rec ? `<button class="btn primary block" data-act="ev-record" data-id="${e.id}">📝 이 대회 성적 기록하기</button><div style="height:10px"></div>` : ''}
        <div class="btn-row"><a class="btn ghost" href="#event-edit-${e.id}">✏️ 고치기</a><button class="btn danger" data-act="ev-del" data-id="${e.id}">🗑️ 지우기</button></div></section>`;
    };
    if (up.length) html += `<h2 class="section-title">다가오는 일정 (${up.length})</h2>${up.map(card).join('')}`;
    else html += `<div class="empty"><span class="ico">📅</span>다가오는 파크골프 일정이 없어요.</div>`;
    html += `<section class="card"><h2>📲 삼성 캘린더와 연결</h2>
      <p>일정마다 <b>‘삼성 캘린더’</b> 버튼을 누르면 캘린더에 넣을 수 있어요.</p>
      <div class="btn-row" style="margin:12px 0"><button class="btn" data-act="ev-ics-all" ${up.length ? '' : 'disabled'}>모든 일정 한 번에</button><label class="btn" for="ev-import" style="cursor:pointer">캘린더에서 가져오기</label></div>
      <input type="file" id="ev-import" accept=".ics,text/calendar" hidden>
      <details><summary style="cursor:pointer;font-weight:800;min-height:48px">자세한 방법 보기</summary>
      <p><b>넣기:</b> 버튼을 누르면 ‘공유’ 창이 뜨면 <b>캘린더</b>를 고르세요. 파일이 내려받아지면 알림창에서 파일을 눌러 <b>캘린더</b>로 열고 ‘저장’을 누르면 돼요. 알림(하루 전·2시간 전)도 같이 들어가요.</p>
      <p><b>구글 캘린더:</b> 삼성 캘린더에 구글 계정이 연결돼 있다면 ‘구글 캘린더’로 넣어도 삼성 캘린더에 같이 보여요.</p>
      <p><b>가져오기:</b> 삼성 캘린더 일정을 파일(.ics)로 내보낸 뒤 ‘캘린더에서 가져오기’로 고르면 <b>파크골프·골프·대회</b>가 들어간 일정만 골라서 가져와요.</p>
      <p class="muted small">휴대폰 보안 때문에 이 앱이 삼성 캘린더를 직접 읽거나 바꾸지는 못해요.</p></details></section>`;
    if (past.length) html += `<h2 class="section-title">지난 일정</h2>${past.map(card).join('')}`;
    return { title: '파크골프 일정', html, after: () => { $('#ev-import').addEventListener('change', importIcs); } };
  };
  function gcalUrl(e) {
    const [s, en] = evTimes(e);
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${f(s)}/${f(en)}`, location: e.place || '', details: (e.memo || '') + '\n(파크골프 수첩에서 추가)', ctz: 'Asia/Seoul' });
  }
  function evTimes(e) {
    const s = new Date(`${e.date}T${e.time || '09:00'}:00+09:00`);
    let en = e.end ? new Date(`${e.date}T${e.end}:00+09:00`) : new Date(s.getTime() + 4 * 3600000);
    if (en <= s) en = new Date(s.getTime() + 4 * 3600000);
    return [s, en];
  }
  function icsFor(events) {
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const fold = s => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const al = db.settings.alarms || [];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//parkgolf-note//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const e of events) {
      const [s, en] = evTimes(e);
      lines.push('BEGIN:VEVENT', `UID:${e.id}@parkgolf-note`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(s)}`, `DTEND:${f(en)}`, `SUMMARY:${fold('⛳ ' + e.title)}`);
      if (e.place) lines.push(`LOCATION:${fold(e.place)}`);
      lines.push(`DESCRIPTION:${fold((e.memo || '') + '\n파크골프 수첩에서 추가한 일정')}`, 'CATEGORIES:파크골프');
      if (al.includes('1d')) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${fold('내일 ' + e.title)}`, 'TRIGGER:-P1D', 'END:VALARM');
      if (al.includes('2h')) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${fold(e.title)}`, 'TRIGGER:-PT2H', 'END:VALARM');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  async function sendIcs(events, name) {
    const text = icsFor(events);
    try {
      const file = new File([text], name, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '파크골프 일정' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    download(name, text, 'text/calendar');
    toast('캘린더 파일을 받았어요. 알림창에서 파일을 눌러 캘린더로 여세요.', 4500);
  }
  acts['ev-ics'] = el => { const e = byId(db.events, el.dataset.id); sendIcs([e], `parkgolf-${e.date}.ics`); };
  acts['ev-ics-all'] = () => sendIcs(db.events.filter(e => e.date >= today()), 'parkgolf-schedule.ics');
  acts['ev-del'] = async el => { if (await ask('이 일정을 지울까요?', '삼성 캘린더에 넣은 일정은 캘린더에서 따로 지워 주세요.', '지우기', true)) { db.events = db.events.filter(e => e.id !== el.dataset.id); save(); render(); } };
  acts['ev-record'] = el => { const e = byId(db.events, el.dataset.id); draft = null; window._roundPrefill = { kind: '대회', title: e.title, date: e.date, courseId: e.courseId || '', eventId: e.id }; go('round-new'); };

  function parseIcs(text) {
    const raw = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const out = []; let cur = null;
    const un = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    for (const line of raw) {
      if (line === 'BEGIN:VEVENT') cur = {};
      else if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; }
      else if (cur) {
        const i = line.indexOf(':'); if (i < 0) continue;
        const key = line.slice(0, i).split(';')[0].toUpperCase(), params = line.slice(0, i), val = line.slice(i + 1);
        if (key === 'SUMMARY') cur.title = un(val);
        else if (key === 'LOCATION') cur.place = un(val);
        else if (key === 'DESCRIPTION') cur.memo = un(val);
        else if (key === 'UID') cur.uid = val;
        else if (key === 'DTSTART' || key === 'DTEND') {
          const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); if (!m) continue;
          let d;
          if (!m[4]) d = { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
          else {
            let dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
            if (m[7]) dt = new Date(dt.getTime() + 9 * 3600000); // UTC → 한국 시간
            else if (!/TZID=Asia\/Seoul/i.test(params) && /TZID=/i.test(params)) { /* 다른 시간대는 그대로 둠 */ }
            const iso = dt.toISOString();
            d = { date: iso.slice(0, 10), time: iso.slice(11, 16) };
          }
          if (key === 'DTSTART') { cur.date = d.date; cur.time = d.time; } else cur.end = d.time;
        }
      }
    }
    return out.filter(e => e.date && e.title);
  }
  async function importIcs(ev) {
    const file = ev.target.files[0]; if (!file) return;
    const text = await file.text();
    const all = parseIcs(text);
    const re = /파크|골프|파골|대회|라운딩/;
    const pick = all.filter(e => re.test(e.title + ' ' + (e.place || '')));
    let n = 0;
    for (const e of pick) {
      if (db.events.find(x => (x.uid && x.uid === e.uid) || (x.title.replace(/^⛳ /, '') === e.title.replace(/^⛳ /, '') && x.date === e.date))) continue;
      const type = /대회/.test(e.title) ? '대회' : /모임|동호회|회원/.test(e.title) ? '모임' : '연습';
      db.events.push({ id: uid(), uid: e.uid, type, title: e.title.replace(/^⛳ /, ''), date: e.date, time: e.time, end: e.end || '', place: e.place || '', memo: e.memo || '', courseId: '' });
      n++;
    }
    save();
    toast(`일정 ${all.length}개 중 파크골프 일정 ${n}개를 가져왔어요`, 4000);
    render();
  }

  let evDraft = null;
  views['event-new'] = () => { evDraft = Object.assign({ id: '', type: '대회', title: '', date: today(), time: '09:00', end: '', courseId: '', place: '', memo: '' }, window._eventPrefill || {}); window._eventPrefill = null; if (evDraft.courseId) evDraft.place = (course(evDraft.courseId) || {}).name || ''; return eventForm('일정 추가', 'schedule'); };
  views['event-edit'] = id => { const e = byId(db.events, id); if (!e) return views.schedule(); evDraft = JSON.parse(JSON.stringify(e)); return eventForm('일정 고치기', 'schedule'); };
  function eventForm(title, back) {
    const e = evDraft;
    const html = `<section class="card">
      <label class="field"><span>어떤 일정인가요?</span></label>
      <div class="seg" style="margin-bottom:14px">${Object.keys(EV_ICON).map(k => `<button type="button" class="chip" data-act="ef-type" data-v="${k}" aria-pressed="${e.type === k}">${EV_ICON[k]}<br>${k}</button>`).join('')}</div>
      <label class="field"><span>제목</span><input type="text" id="ef-title" value="${esc(e.title)}" placeholder="예) 시장배 파크골프 대회"></label>
      <label class="field"><span>날짜</span><input type="date" id="ef-date" value="${esc(e.date)}"></label>
      <div class="btn-row"><label class="field"><span>시작 시간</span><input type="time" id="ef-time" value="${esc(e.time)}"></label><label class="field"><span>끝 시간</span><input type="time" id="ef-end" value="${esc(e.end)}"></label></div>
      <label class="field"><span>장소</span><input type="text" id="ef-place" value="${esc(e.place)}" list="ef-courses" placeholder="골프장 이름"><datalist id="ef-courses">${db.courses.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
      <label class="field"><span>메모 (준비물, 모이는 곳 등)</span><textarea id="ef-memo">${esc(e.memo)}</textarea></label>
    </section>
    <button type="button" class="btn primary block xl" data-act="ef-save">💾 저장</button>
    <p class="muted small center">저장한 뒤 ‘삼성 캘린더’ 버튼으로 휴대폰 캘린더에 넣을 수 있어요.</p>`;
    return { title, html, back };
  }
  acts['ef-type'] = el => { evDraft.type = el.dataset.v; document.querySelectorAll('[data-act="ef-type"]').forEach(b => b.setAttribute('aria-pressed', b === el)); };
  acts['ef-save'] = () => {
    const g = id => document.getElementById(id); const e = evDraft;
    e.date = g('ef-date').value; e.time = g('ef-time').value; e.end = g('ef-end').value; e.place = g('ef-place').value.trim(); e.memo = g('ef-memo').value;
    e.title = g('ef-title').value.trim() || `${e.place ? e.place + ' ' : ''}파크골프 ${e.type}`;
    if (!e.date) return toast('날짜를 골라 주세요');
    const c = db.courses.find(x => x.name === e.place); e.courseId = c ? c.id : '';
    if (!e.id) { e.id = uid(); db.events.push(e); } else { const i = db.events.findIndex(x => x.id === e.id); db.events[i] = e; }
    save(); evDraft = null;
    toast('저장했어요');
    go('schedule');
  };

  /* ════════════════ 준비물 ════════════════ */
  const ITEMS = ['파크골프채(클럽)', '공 (여분 1~2개)', '티(공 받침)', '장갑', '모자', '물·음료', '간식 (바나나·사탕)', '수건', '선크림', '회원증·신분증', '상비약 (혈압약 등)', '휴대폰 충전'];
  views.checklist = () => {
    if (db.checklist.date !== today()) db.checklist = { date: today(), checked: {} };
    const fav = db.courses.find(c => c.fav) || db.courses[0];
    const all = ITEMS.concat(db.settings.extraItems || []);
    const html = `<section class="card"><h2>오늘 챙길 것</h2><p class="muted small" style="margin-top:0">챙긴 것은 눌러서 표시하세요. 내일이 되면 다시 비워져요.</p>
      ${all.map(it => `<button type="button" class="check" data-act="ck" data-v="${esc(it)}" aria-pressed="${!!db.checklist.checked[it]}"><span class="box">${db.checklist.checked[it] ? '✓' : ''}</span><span class="lbl">${esc(it)}</span></button>`).join('')}
      <div class="row" style="margin-top:12px"><input type="text" id="ck-new" placeholder="더 넣을 물건" style="flex:1;min-width:0"><button class="btn" data-act="ck-add">추가</button></div></section>
      ${fav ? `<section class="card"><h2>🌤️ 오늘 날씨에 맞춰 더 챙기세요</h2><div id="ck-wx"><p class="muted"><span class="spinner"></span> 불러오는 중…</p></div></section>` : ''}
      <button class="btn ghost block" data-act="ck-reset">모두 비우기</button>`;
    return { title: '준비물 챙기기', html, after: async () => {
      const box = $('#ck-wx'); if (!box || !fav || fav.lat == null) { if (box) box.innerHTML = '<p class="muted">자주 가는 골프장 위치가 있으면 날씨에 맞는 준비물을 알려 드려요.</p>'; return; }
      try {
        const d = await courseNow(fav); const D = d.w.daily, i = D.time.indexOf(today());
        const tips = [];
        if (D.precipitation_probability_max[i] >= 40) tips.push('☂️ 우산·우비 (비 올 확률 ' + D.precipitation_probability_max[i] + '%)');
        if (D.temperature_2m_max[i] >= 28) tips.push('🧊 물 넉넉히, 쿨토시·양산');
        if (D.temperature_2m_min[i] <= 5) tips.push('🧤 핫팩·두꺼운 장갑·목도리');
        if (D.uv_index_max && D.uv_index_max[i] >= 6) tips.push('🧴 선크림·선글라스 (자외선 강함)');
        if (D.wind_speed_10m_max[i] >= 7) tips.push('🧥 바람막이 (바람 강함)');
        if (d.aq && d.aq.current && WX.pmGrade(d.aq.current.pm10, d.aq.current.pm2_5).g >= 3) tips.push('😷 마스크 (미세먼지 나쁨)');
        box.innerHTML = `<p class="muted small" style="margin-top:0">${esc(fav.name)} 기준</p>` + (tips.length ? tips.map(t => `<div class="note info">${esc(t)}</div>`).join('') : '<p>오늘은 날씨가 무난해요. 기본 준비물만 챙기세요.</p>');
      } catch (e) { box.innerHTML = '<p class="muted">날씨를 불러오지 못했어요.</p>'; }
    } };
  };
  acts.ck = el => { const v = el.dataset.v; db.checklist.checked[v] = !db.checklist.checked[v]; save(); el.setAttribute('aria-pressed', db.checklist.checked[v]); el.querySelector('.box').textContent = db.checklist.checked[v] ? '✓' : ''; };
  acts['ck-add'] = () => { const v = $('#ck-new').value.trim(); if (!v) return; db.settings.extraItems = [...(db.settings.extraItems || []), v]; save(); rerenderKeep(); };
  acts['ck-reset'] = () => { db.checklist = { date: today(), checked: {} }; save(); render(); };

  /* ════════════════ 몸풀기 ════════════════ */
  const STRETCH = [
    ['목 돌리기', '천천히 오른쪽으로 5번, 왼쪽으로 5번 돌려요. 어지러우면 멈추세요.'],
    ['어깨 으쓱', '어깨를 귀까지 올렸다가 툭 떨어뜨려요. 10번.'],
    ['팔 앞으로 뻗기', '깍지를 끼고 팔을 앞으로 쭉 뻗어 10초 버텨요. 3번.'],
    ['허리 비틀기', '클럽을 어깨 뒤에 걸고 천천히 좌우로 몸통을 돌려요. 양쪽 10번.'],
    ['손목 털기', '손목을 가볍게 털고 돌려요. 안쪽·바깥쪽 10번씩.'],
    ['무릎 굽혔다 펴기', '의자나 클럽을 짚고 무릎을 살짝 굽혔다 펴요. 10번.'],
    ['발목 돌리기', '한 발씩 발끝을 땅에 대고 발목을 돌려요. 양쪽 10번.'],
    ['연습 스윙', '힘을 빼고 반만 휘두르는 스윙 10번, 마지막에 연습 퍼팅 5번.']
  ];
  views.stretch = () => ({
    title: '몸풀기 체조',
    html: `<div class="note info"><b>경기 전 10분</b>다치지 않게 천천히, 아프면 바로 멈추세요.</div>${STRETCH.map(([t, d], i) => `<section class="card"><h2>${i + 1}. ${t}</h2><p>${d}</p></section>`).join('')}<button class="btn primary block xl" data-act="st-speak">🔊 소리로 따라 하기</button>`
  });
  acts['st-speak'] = () => speak('몸풀기 체조를 시작합니다. ' + STRETCH.map(([t, d], i) => `${i + 1}번, ${t}. ${d}`).join(' '));

  /* ════════════════ 설정·백업 ════════════════ */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  views.more = () => {
    const s = db.settings;
    const html = `<section class="card"><h2>내 이름</h2><p class="muted small" style="margin-top:0">내기에서 '나'로 표시되고, 처음 화면에서 불러 드려요.</p><div class="row"><input type="text" id="st-name" value="${esc(s.name)}" style="flex:1;min-width:0" placeholder="예) 김순자"><button class="btn primary" data-act="st-name">저장</button></div></section>
    <section class="card"><h2>글자 크기</h2><div class="seg">${[['normal', '보통'], ['big', '크게'], ['huge', '아주 크게']].map(([v, l]) => `<button class="chip" data-act="st-size" data-v="${v}" aria-pressed="${s.size === v}">${l}</button>`).join('')}</div>
      <h3>화면 밝기</h3><div class="seg">${[['light', '밝게'], ['dark', '어둡게'], ['auto', '휴대폰 따라']].map(([v, l]) => `<button class="chip" data-act="st-theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join('')}</div></section>
    <section class="card"><h2>캘린더 알림</h2><p class="muted small" style="margin-top:0">삼성 캘린더에 넣을 때 같이 넣을 알림</p><div class="chips">${[['1d', '하루 전'], ['2h', '2시간 전']].map(([v, l]) => `<button class="chip" data-act="st-alarm" data-v="${v}" aria-pressed="${(s.alarms || []).includes(v)}">${l}</button>`).join('')}</div></section>
    <section class="card"><h2>📱 휴대폰 화면에 앱 아이콘 만들기</h2>
      ${installEvt ? '<button class="btn primary block" data-act="st-install">홈 화면에 추가</button>' : ''}
      <p><b>삼성 인터넷:</b> 아래쪽 ☰ 메뉴 → <b>‘현재 페이지 추가’</b> → <b>‘홈 화면’</b></p><p><b>크롬:</b> 오른쪽 위 ⋮ → <b>‘홈 화면에 추가’</b></p></section>
    <section class="card"><h2>💾 기록 백업</h2><p class="muted small" style="margin-top:0">기록은 이 휴대폰 안에만 저장돼요. 휴대폰을 바꾸기 전에 꼭 백업하세요.</p>
      <div class="btn-row"><button class="btn" data-act="bk-save">파일로 저장</button><button class="btn" data-act="bk-copy">글로 복사</button></div>
      <h3>되살리기</h3><div class="btn-row"><label class="btn ghost" for="bk-file" style="cursor:pointer">파일 고르기</label><button class="btn ghost" data-act="bk-paste">글 붙여넣기</button></div><input type="file" id="bk-file" accept=".json,application/json" hidden>
      <p class="muted small">성적 ${db.rounds.length}개 · 내기 ${db.bets.length}개 · 골프장 ${db.courses.length}곳 · 일정 ${db.events.length}개</p></section>
    <section class="card"><h2>도움말</h2><p class="small">날씨: Open-Meteo(기상 예보·과거 기록) · 미세먼지: Open-Meteo 대기질 · 골프장 찾기: 오픈스트리트맵</p><p class="small muted">운영 상황은 날씨와 휴장일로 짐작한 것이에요. 대회·공사·잔디 보수로 쉴 수 있으니 전화로 확인하세요.</p></section>
    <button class="btn danger block" data-act="st-wipe">모든 기록 지우기</button>`;
    return { title: '설정·백업', html, after: () => { $('#bk-file').addEventListener('change', async ev => { const f = ev.target.files[0]; if (f) restore(await f.text()); }); } };
  };
  acts['st-name'] = () => { db.settings.name = $('#st-name').value.trim(); save(); toast('저장했어요'); };
  acts['st-size'] = el => { db.settings.size = el.dataset.v; save(); applySettings(); rerenderKeep(); };
  acts['st-theme'] = el => { db.settings.theme = el.dataset.v; save(); applySettings(); rerenderKeep(); };
  acts['st-alarm'] = el => { const a = db.settings.alarms = db.settings.alarms || []; const i = a.indexOf(el.dataset.v); if (i >= 0) a.splice(i, 1); else a.push(el.dataset.v); save(); el.setAttribute('aria-pressed', i < 0); };
  acts['st-install'] = async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } };
  acts['bk-save'] = () => download(`parkgolf-backup-${today()}.json`, JSON.stringify(db), 'application/json');
  acts['bk-copy'] = async () => { try { await navigator.clipboard.writeText(JSON.stringify(db)); toast('복사했어요. 카카오톡 ‘나와의 채팅’에 붙여 넣어 두세요.', 4000); } catch (e) { modal(`<h2>아래 글을 길게 눌러 모두 복사하세요</h2><textarea readonly style="min-height:200px">${esc(JSON.stringify(db))}</textarea><button class="btn primary block" data-res="ok">닫기</button>`); } };
  acts['bk-paste'] = () => modal(`<h2>백업한 글을 붙여 넣으세요</h2><textarea id="bk-text" style="min-height:200px"></textarea><div class="btn-row"><button class="btn ghost" data-res="no">취소</button><button class="btn primary" data-act="bk-do">되살리기</button></div>`);
  acts['bk-do'] = () => { const t = $('#bk-text').value; document.querySelector('.modal-back').remove(); restore(t); };
  async function restore(text) {
    let data; try { data = JSON.parse(text); } catch (e) { return toast('백업 내용이 올바르지 않아요'); }
    if (!data || !Array.isArray(data.rounds)) return toast('백업 내용이 올바르지 않아요');
    if (!(await ask('되살릴까요?', `지금 기록이 백업 내용(성적 ${data.rounds.length}개)으로 바뀌어요.`, '되살리기'))) return;
    db = Object.assign(blank(), data, { settings: Object.assign(blank().settings, data.settings || {}) }); save(); applySettings(); toast('되살렸어요'); go('home');
  }
  acts['st-wipe'] = async () => {
    if (!(await ask('정말 모두 지울까요?', '성적·내기·골프장·일정이 모두 지워지고 되돌릴 수 없어요. 먼저 백업하세요.', '모두 지우기', true))) return;
    db = blank(); save(); applySettings(); go('home');
  };

  /* ── 시작 ───────────────────────────────────────── */
  applySettings();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
