{% raw %}
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("stock-data").textContent);
  var app = document.getElementById("app");
  var db = null;
  var liveStocks = {};
  var holdings = (DATA.snapshot || []).map(function (h) { return Object.assign({}, h, { id: keyOf(h) }); });
  var view = { name: "list" };
  var flash = null;
  var refreshMsg = "";

  function keyOf(h) { return String(h.market || "KR").toUpperCase() + "-" + String(h.code || "").toUpperCase(); }
  function stockOf(h) {
    if (liveStocks[h.id]) return liveStocks[h.id];
    if (DATA.stocks[h.id]) return DATA.stocks[h.id];
    for (var k in DATA.stocks) if (DATA.stocks[k].db_id === h.id) return DATA.stocks[k];
    return null;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nf(v, d) {
    if (v == null || isNaN(v)) return "—";
    return Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  var FX = DATA.fx && DATA.fx.rate ? DATA.fx : null;   // 원/달러 환율 {rate, as_of, source} — 미국 종목 원화 환산
  function usd(v) { return v == null ? "—" : "$" + nf(v, 2); }
  function krw(v) { return v == null ? "—" : nf(v, 0) + "원"; }
  // 평균 단가는 원화로 입력받는다 (avg_cur:"KRW"). 예전에 달러로 넣은 미국 종목(avg_cur 없음)은 달러로 보고 환산
  function avgCur(h) { return h.avg_cur || (h.market === "KR" ? "KRW" : "USD"); }
  function avgKrw(h) { return h.avg == null ? null : (avgCur(h) === "KRW" ? h.avg : (FX ? h.avg * FX.rate : null)); }
  function pxKrw(p, cur) { return !p || p.value == null ? null : (cur === "KRW" ? p.value : (FX ? p.value * FX.rate : null)); }
  function pnl(h, p, cur) {   // 평가 금액·손익·수익률 (원화). 원화로 못 맞추면(환율 없음) null
    var v = pxKrw(p, cur), a = avgKrw(h);
    if (v == null || !h.qty) return null;
    var out = { val: v * h.qty, cost: a == null ? null : a * h.qty };
    if (a) { out.gain = out.val - out.cost; out.ret = (v / a - 1) * 100; }
    return out;
  }
  function busy() { var a = document.activeElement; return !!(a && a.tagName === "INPUT" && app.contains(a)); }
  (function injectCss() {
    if (document.getElementById("sp-extra-css")) return;
    var el = document.createElement("style");
    el.id = "sp-extra-css";
    el.textContent = [
      ".psum{border:1px solid var(--rule);padding:12px 14px;display:grid;gap:10px;font:500 13px/1.45 var(--f-sans)}",
      ".psum .tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
      ".psum .tiles b{display:block;font:500 11.5px/1.3 var(--f-sans);color:var(--muted)}",
      ".psum .tiles span{font:700 20px/1.25 var(--f-sans);font-variant-numeric:tabular-nums}",
      ".psum .up{color:var(--up)} .psum .down{color:var(--down)}",
      ".wrow{display:grid;grid-template-columns:minmax(0,7em) 1fr 3.4em;gap:8px;align-items:center;font:400 12.5px/1.3 var(--f-sans);color:var(--ink-2)}",
      ".wrow .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".wrow .bar{height:8px;background:var(--hair)}",
      ".wrow .bar i{display:block;height:100%;background:var(--ink);border-radius:0 4px 4px 0}",
      ".wrow .v{text-align:right;font-variant-numeric:tabular-nums}",
      ".rng{display:flex;gap:6px;margin-bottom:8px}",
      ".rng button{appearance:none;font:600 12.5px/1 var(--f-sans);padding:8px 11px;border:1px solid var(--hair);background:none;color:inherit;cursor:pointer}",
      ".rng button[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}",
      ".pchart .read{font:600 14px/1.4 var(--f-sans);font-variant-numeric:tabular-nums;min-height:1.4em}",
      ".pchart .read small{font-weight:400;color:var(--muted);margin-right:6px}",
      ".pchart svg{display:block;width:100%;height:auto;touch-action:pan-y;cursor:crosshair}",
      ".pchart .cap{font:400 11.5px/1.45 var(--f-sans);color:var(--muted);margin:6px 0 0}",
      ".calc .fgrid input{font:500 15px/1.3 var(--f-sans)}",
      ".calc .kv{margin-top:10px}"
    ].join("\n");
    document.head.appendChild(el);
  })();
  function money(v, cur) {   // 내 종목 금액은 모두 원화로 (미국 종목은 환율 환산, 환율이 없으면 달러 그대로)
    if (v == null) return "—";
    if (cur === "KRW") return nf(v, 0) + "원";
    return FX ? nf(v * FX.rate, 0) + "원" : usd(v);
  }
  function dirc(v) { return v == null || v === 0 ? "flat" : (v > 0 ? "up" : "down"); }
  function pct(v) { return v == null ? "" : (v > 0 ? "+" : "") + nf(v, 2) + "%"; }
  function signed(v, d) { return v == null ? "—" : (v > 0 ? "▲" : v < 0 ? "▼" : "") + nf(Math.abs(v), d); }
  function curOf(h, st) { return (st && st.price && st.price.currency) || (h.market === "KR" ? "KRW" : "USD"); }
  function day(s) {
    if (!s) return "";
    var d = new Date(s.slice(0, 10) + "T00:00:00");
    return (d.getMonth() + 1) + "/" + d.getDate() + "(" + "일월화수목금토"[d.getDay()] + ")";
  }
  function big(v) {
    if (v == null) return "—";
    if (v >= 1e9) return "$" + nf(v / 1e9, 1) + "B";
    if (v >= 1e6) return "$" + nf(v / 1e6, 1) + "M";
    return "$" + nf(v, 0);
  }
  function num(v) { v = String(v || "").replace(/,/g, "").trim(); return v === "" || isNaN(v) ? null : Number(v); }

  /* ── 탭 ─────────────────────────────── */
  var tabs = { paper: document.getElementById("t-paper"), mine: document.getElementById("t-mine") };
  function show(which) {
    ["paper", "mine"].forEach(function (k) {
      var on = k === which;
      tabs[k].setAttribute("aria-selected", on ? "true" : "false");
      document.getElementById("v-" + k).hidden = !on;
    });
    if (which === "mine") render();
    window.scrollTo(0, 0);
  }
  tabs.paper.addEventListener("click", function () { show("paper"); });
  tabs.mine.addEventListener("click", function () { show("mine"); });
  if (location.hash === "#mine") show("mine");
  else if (/^#(KR|US)-[A-Z0-9.\-]+$/.test(location.hash)) { view = { name: "detail", id: location.hash.slice(1) }; show("mine"); }

  /* ── 목록 ───────────────────────────── */
  function rowHtml(h) {
    var st = stockOf(h), p = st && st.price, cur = curOf(h, st), pl = "";
    var pv = pnl(h, p, cur);
    if (pv && pv.gain != null) {
      pl = ' · <span class="' + dirc(pv.gain) + '">' + (pv.gain > 0 ? "+" : "") + krw(pv.gain) + " (" + pct(pv.ret) + ")</span>";
    }
    var right = p ? '<span class="l2 r ' + dirc(p.change_pct) + '">' + (p.change_pct == null ? "전일비 없음" : pct(p.change_pct)) + "</span>"
                  : '<span class="l2 r">' + (st ? "시세 없음" : "불러오는 중") + "</span>";
    return '<li><button type="button" class="row" data-id="' + esc(h.id) + '">' +
      '<span class="nm">' + esc(h.name || (st && st.name) || h.code) + "<small>" +
      esc((st && st.exchange) || (h.market === "KR" ? "국내" : "미국")) + " " + esc(h.code) + "</small></span>" +
      '<span class="px">' + (p ? money(p.value, cur) : "—") + "</span>" +
      '<span class="l2">' + (h.qty ? "보유 " + nf(h.qty, h.qty % 1 ? 2 : 0) + "주" : "보유 수량 미입력") + pl + "</span>" + right +
      "</button></li>";
  }

  function summaryHtml() {   // 내 종목 전체: 총 평가 금액·손익·수익률, 종목별 비중 (원화)
    var rows = [], tv = 0, tc = 0, tg = 0, nc = 0;
    holdings.forEach(function (h) {
      var st = stockOf(h), pv = pnl(h, st && st.price, curOf(h, st));
      if (!pv) return;
      rows.push({ name: h.name || (st && st.name) || h.code, val: pv.val });
      tv += pv.val;
      if (pv.gain != null) { tc += pv.cost; tg += pv.gain; nc++; }
    });
    if (!rows.length || !tv) return "";
    rows.sort(function (a, b) { return b.val - a.val; });
    return '<section class="psum" aria-label="내 종목 요약"><div class="tiles">' +
      "<div><b>총 평가 금액</b><span>" + krw(tv) + "</span></div>" +
      "<div><b>평가 손익" + (nc < rows.length ? " (평균 단가 넣은 " + nc + "종목)" : "") + "</b><span class=\"" + dirc(tg) + "\">" +
      (nc ? (tg > 0 ? "+" : "") + krw(tg) + '<small style="font-size:13px"> ' + pct(tc ? tg / tc * 100 : null) + "</small>" : "—") + "</span></div></div>" +
      '<div role="list" aria-label="종목별 비중" style="display:grid;gap:6px">' + rows.map(function (r) {
        var w = r.val / tv * 100;
        return '<div class="wrow" role="listitem"><span class="nm">' + esc(r.name) + '</span><span class="bar"><i style="width:' +
          Math.max(1, w).toFixed(1) + '%"></i></span><span class="v">' + nf(w, 1) + "%</span></div>";
      }).join("") + "</div>" +
      (FX && rows.length ? '<p class="msg" style="color:var(--muted)">미국 종목은 원/달러 ' + nf(FX.rate, 2) + "원으로 환산</p>" : "") + "</section>";
  }

  function renderList() {
    var list = holdings.length ? '<ul class="plist">' + holdings.map(rowHtml).join("") + "</ul>"
      : '<p class="msg">아직 추가한 종목이 없습니다. 아래에서 추가하세요.</p>';
    app.innerHTML =
      '<div><h2>내 종목</h2><p class="sub">' + esc(DATA.issue_date) + " 아침 발행 기준 · 종목을 누르면 중요 뉴스·실적·손익을 봅니다</p>" +
      (DATA.sample ? '<p class="sample">견본 — 샘플 데이터입니다</p>' : "") +
      '<p class="msg" id="rf-msg" aria-live="polite">' + esc(refreshMsg) + "</p></div>" +
      summaryHtml() + list + formHtml();
    app.querySelectorAll("button.row").forEach(function (b) {
      b.addEventListener("click", function () { view = { name: "detail", id: b.getAttribute("data-id") }; render(); window.scrollTo(0, 0); });
    });
    var f = document.getElementById("addf");
    if (f) {
      f.addEventListener("submit", onAdd);
      document.getElementById("f-q").addEventListener("input", function (ev) { fillList(ev.target.value); });
    }
    if (flash) { setMsg(flash.text, flash.err); flash = null; }
  }

  function formHtml() {
    if (!db) {
      return '<p class="msg">이 화면에서는 종목을 추가·수정할 수 없습니다. 바꿀 종목은 Claude 채팅으로 알려 주세요.</p>';
    }
    return '<form class="box" id="addf" novalidate><h3>종목 추가</h3><div class="fgrid">' +
      '<label class="wide" for="f-q">종목 이름 또는 코드<input id="f-q" autocomplete="off" spellcheck="false" placeholder="삼성전자, 넷플릭스, NFLX, 005930"></label>' +
      '<div class="wide" id="f-sug" role="listbox" aria-label="종목 후보" style="display:grid;gap:0"></div>' +
      '<label for="f-qty">보유 수량 (선택)<input id="f-qty" inputmode="decimal" autocomplete="off" placeholder="10"></label>' +
      '<label for="f-avg">평균 단가 (선택, 원)<input id="f-avg" inputmode="decimal" autocomplete="off" placeholder="원화, 예: 95000"></label>' +
      '</div><button class="btn" type="submit">추가</button><p class="msg" id="f-msg" aria-live="polite"></p></form>';
  }

  /* 이름 → 시장·코드 (국내 상장사 전체 + 자주 찾는 미국 종목 한글 이름) */
  var KR = {}, KRNAME = {};
  ((DATA.names && DATA.names.kr) || []).forEach(function (x) { KR[x[0].replace(/\s/g, "")] = x[1]; KRNAME[x[1]] = x[0]; });
  var USKO = (DATA.names && DATA.names.us) || {};
  function resolve(q) {
    var t = q.trim(), n = t.replace(/\s/g, ""), m = t.match(/\((\d{6})\)\s*$/);
    if (m) return { market: "KR", code: m[1], name: KRNAME[m[1]] || t.replace(/\s*\(\d{6}\)\s*$/, "") };
    if (/^\d{6}$/.test(n)) return { market: "KR", code: n, name: KRNAME[n] || "" };
    if (KR[n]) return { market: "KR", code: KR[n], name: t };
    if (USKO[n]) return { market: "US", code: USKO[n], name: t };
    if (/^[A-Za-z][A-Za-z.\-]{0,5}$/.test(t)) return { market: "US", code: t.toUpperCase(), name: "" };
    return { market: "", code: "", name: t };      // 모르는 이름 → 갱신 때 Claude 가 찾아 맞춤
  }
  var sugTimer = null, sugSeq = 0;
  function localCands(q) {
    var n = q.replace(/\s/g, ""), out = [];
    if (!n) return out;
    for (var k in USKO) { if (k.indexOf(n) === 0) out.push({ label: k, sub: "미국 " + USKO[k], value: k + " (" + USKO[k] + ")" }); if (out.length >= 5) break; }
    var kr = (DATA.names && DATA.names.kr) || [];
    for (var i = 0; i < kr.length && out.length < 10; i++) {
      if (kr[i][0].replace(/\s/g, "").indexOf(n) === 0) out.push({ label: kr[i][0], sub: "국내 " + kr[i][1], value: kr[i][0] + " (" + kr[i][1] + ")" });
    }
    return out;
  }
  function isLatin(q) { return /^[A-Za-z][A-Za-z0-9 .&,'\-]{1,40}$/.test(q.trim()); }
  function searchApi(q) {
    return fetch("/api/search?q=" + encodeURIComponent(q.trim())).then(function (r) { return r.ok ? r.json() : []; });
  }
  function drawSug(cands) {
    var box = document.getElementById("f-sug");
    if (!box) return;
    box.innerHTML = cands.map(function (c) {
      return '<button type="button" role="option" data-v="' + esc(c.value) + '" style="appearance:none;display:flex;justify-content:space-between;gap:8px;' +
        'width:100%;text-align:left;padding:11px 4px;border:0;border-bottom:1px solid var(--hair);background:transparent;color:inherit;font:500 15px/1.3 var(--f-sans);cursor:pointer">' +
        "<span>" + esc(c.label) + '</span><span style="color:var(--muted);font-size:12.5px;white-space:nowrap">' + esc(c.sub) + "</span></button>";
    }).join("");
    box.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        var inp = document.getElementById("f-q");
        inp.value = b.getAttribute("data-v"); box.innerHTML = ""; inp.focus();
      });
    });
  }
  function fillList(q) {
    var cands = localCands(q), seq = ++sugSeq;
    drawSug(cands);
    clearTimeout(sugTimer);
    if (!DATA.site_storage || !isLatin(q) || cands.length >= 5) return;
    sugTimer = setTimeout(function () {
      searchApi(q).then(function (list) {
        if (seq !== sugSeq) return;   // 그사이 더 입력했으면 버림
        var seen = {};
        cands.forEach(function (c) { seen[c.value] = 1; });
        list.forEach(function (x) {
          var v = x.name + " (" + x.code + ")";
          if (!seen[v]) cands.push({ label: x.name, sub: (x.market === "KR" ? "국내 " : "미국 ") + x.code, value: v });
        });
        drawSug(cands.slice(0, 10));
      }).catch(function () { /* 후보만 못 보여 줌 */ });
    }, 300);
  }

  function setMsg(text, err) {
    var m = document.getElementById("f-msg") || document.getElementById("d-msg");
    if (m) { m.textContent = text; m.className = "msg" + (err ? " err" : ""); }
  }

  function onAdd(ev) {
    ev.preventDefault();
    var raw = document.getElementById("f-q").value.trim().replace(/\s*\(([A-Z.\-]{1,6})\)\s*$/, function (_, t) { return " " + t; });
    if (!raw) return setMsg("종목 이름이나 코드를 입력하세요. 예: 삼성전자, 엔비디아, NVDA", true);
    var tick = raw.match(/\s([A-Z][A-Z.\-]{0,5})$/);
    var r = tick ? { market: "US", code: tick[1], name: raw.replace(/\s[A-Z.\-]+$/, "") } : resolve(raw);
    var btn = ev.target.querySelector("button[type=submit]");
    if (r.market || !DATA.site_storage) return save(r, raw, btn);
    if (!isLatin(raw)) {
      return setMsg("‘" + raw + "’ 종목을 찾지 못했습니다. 영어 이름이나 티커로 입력해 보세요. 예: NioCorp, NB", true);
    }
    btn.disabled = true;
    setMsg("종목을 찾는 중입니다…");
    searchApi(raw).then(function (list) {
      btn.disabled = false;
      if (!list.length) return setMsg("‘" + raw + "’ 종목을 찾지 못했습니다. 티커로 입력해 보세요. 예: NFLX, BRK.B", true);
      save({ market: list[0].market, code: list[0].code, name: list[0].name }, raw, btn);
    }).catch(function () { btn.disabled = false; setMsg("종목 검색에 실패했습니다. 잠시 뒤 다시 시도하세요.", true); });
  }
  function save(r, raw, btn) {
    var id = r.market ? keyOf(r) : "Q-" + Date.now().toString(36);
    var h = { market: r.market, code: r.code, name: r.name, query: raw,
              qty: num(document.getElementById("f-qty").value), avg: num(document.getElementById("f-avg").value), avg_cur: "KRW",
              added_at: new Date().toISOString() };
    btn.disabled = true;
    db.doc("holdings/" + id).set(h).then(function () {
      flash = { text: (r.name || raw) + (r.code ? " (" + r.code + ")" : "") + " 추가했습니다." +
        (r.market ? "" : " 종목을 찾아 맞추는 중입니다."), err: false };
      renderList();
      if (!DATA.stocks[id]) maybeRefresh("add");
    }).catch(function (e) {
      btn.disabled = false;
      setMsg(e && e.code === "quota_exceeded" ? "저장 공간이 가득 찼습니다. 종목을 몇 개 지운 뒤 다시 시도하세요."
             : "저장하지 못했습니다 (" + (e && e.code) + "). 이 페이지를 수정할 권한이 있는지 확인하세요.", true);
    });
  }

  /* ── 분기 실적 그래프 (묶음 막대, 한 축) ─────────────── */
  function chartHtml(rows, keys, labels, unit, scale, digits) {
    rows = rows.filter(function (r) { return keys.some(function (k) { return r[k] != null; }); });
    if (rows.length < 2) return "";
    var W = 340, H = 170, L = 34, R = 6, T = 22, B = 22, pw = W - L - R, ph = H - T - B;
    var vals = [];
    rows.forEach(function (r) { keys.forEach(function (k) { if (r[k] != null) vals.push(r[k] / scale); }); });
    var max = Math.max.apply(null, vals.concat([0])), min = Math.min.apply(null, vals.concat([0]));
    var step = niceStep((max - min) / 3), top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
    if (top === bot) top = bot + step;
    var y = function (v) { return T + ph * (top - v) / (top - bot); };
    var gw = pw / rows.length, bw = Math.min(16, (gw - 10) / keys.length - 2);
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(labels.join(", ") + " 분기 추이") + '">';
    for (var g = bot; g <= top + 1e-9; g += step) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '" class="' + (Math.abs(g) < 1e-9 ? "c-base" : "c-grid") + '"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(g) + 3.5).toFixed(1) + '" class="c-ax" text-anchor="end">' + nf(g, step < 1 ? 1 : 0) + "</text>";
    }
    rows.forEach(function (r, i) {
      var x0 = L + gw * i + (gw - (bw + 2) * keys.length + 2) / 2;
      keys.forEach(function (k, j) {
        if (r[k] == null) return;
        var v = r[k] / scale, x = x0 + j * (bw + 2), y0 = y(0), y1 = y(v), up = v >= 0, rad = Math.min(4, Math.abs(y1 - y0) / 2, bw / 2);
        var d = up ? "M" + x + "," + y0 + "V" + (y1 + rad) + "Q" + x + "," + y1 + " " + (x + rad) + "," + y1 + "H" + (x + bw - rad) + "Q" + (x + bw) + "," + y1 + " " + (x + bw) + "," + (y1 + rad) + "V" + y0 + "Z"
                   : "M" + x + "," + y0 + "V" + (y1 - rad) + "Q" + x + "," + y1 + " " + (x + rad) + "," + y1 + "H" + (x + bw - rad) + "Q" + (x + bw) + "," + y1 + " " + (x + bw) + "," + (y1 - rad) + "V" + y0 + "Z";
        svg += '<path d="' + d + '" class="c-s' + j + '"/>';
        if (i === rows.length - 1) svg += '<text x="' + (x + bw / 2) + '" y="' + (up ? y1 - 4 : y1 + 11) + '" class="c-lbl" text-anchor="middle">' + nf(v, digits) + "</text>";
      });
      svg += '<text x="' + (L + gw * i + gw / 2) + '" y="' + (H - 6) + '" class="c-ax" text-anchor="middle">' + esc(r.label) + "</text>" +
        '<rect x="' + (L + gw * i) + '" y="' + T + '" width="' + gw + '" height="' + ph + '" class="c-hit" data-i="' + i + '"/>';
    });
    svg += "</svg>";
    var legend = '<div class="c-leg">' + labels.map(function (l, j) { return '<span><i class="c-s' + j + '"></i>' + esc(l) + "</span>"; }).join("") +
      '<span class="c-unit">단위: ' + esc(unit) + "</span></div>";
    var tip = '<p class="c-tip" aria-live="polite">막대를 누르면 분기별 값을 봅니다.</p>';
    var tbl = '<details class="c-tbl"><summary>표로 보기</summary><table><thead><tr><th>분기</th>' + labels.map(function (l) { return "<th>" + esc(l) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr><td>" + esc(r.label) + "</td>" + keys.map(function (k) { return "<td>" + (r[k] == null ? "—" : nf(r[k] / scale, digits)) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></details>";
    return '<div class="chart" data-rows="' + esc(JSON.stringify(rows.map(function (r) {
      return [r.label].concat(keys.map(function (k) { return r[k] == null ? null : r[k] / scale; }));
    }))) + '" data-labels="' + esc(JSON.stringify(labels)) + '" data-unit="' + esc(unit) + '" data-digits="' + digits + '">' + legend + svg + tip + tbl + "</div>";
  }
  function niceStep(x) {
    if (!(x > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function bindCharts() {
    app.querySelectorAll(".chart").forEach(function (c) {
      var rows = JSON.parse(c.getAttribute("data-rows")), labels = JSON.parse(c.getAttribute("data-labels"));
      var unit = c.getAttribute("data-unit"), d = +c.getAttribute("data-digits"), tip = c.querySelector(".c-tip");
      c.querySelectorAll(".c-hit").forEach(function (h) {
        var show = function () {
          var r = rows[+h.getAttribute("data-i")];
          c.querySelectorAll(".c-hit").forEach(function (x) { x.classList.toggle("on", x === h); });
          tip.textContent = r[0] + " · " + labels.map(function (l, j) { return l + " " + (r[j + 1] == null ? "—" : nf(r[j + 1], d) + unit); }).join(" · ");
        };
        h.addEventListener("mouseenter", show); h.addEventListener("click", show);
      });
    });
    app.querySelectorAll("button.fil").forEach(function (b) {
      b.addEventListener("click", function () {
        var box = document.getElementById(b.getAttribute("aria-controls")), open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", open ? "false" : "true"); box.hidden = open;
      });
    });
  }

  /* ── 시세 그래프 (일별 종가, 한 줄 + 내 평균 단가 점선) ─────── */
  var chartRange = "3mo", histCache = {};
  function chartSec() {
    return '<div class="dsec pchart"><h4>시세 그래프</h4><div class="rng" role="group" aria-label="기간">' +
      [["1mo", "1개월"], ["3mo", "3개월"], ["1y", "1년"]].map(function (r) {
        return '<button type="button" data-r="' + r[0] + '" aria-pressed="' + (r[0] === chartRange) + '">' + r[1] + "</button>";
      }).join("") + '</div><div id="pc-box"><p class="msg">불러오는 중…</p></div></div>';
  }
  function bindPriceChart(h, cur) {
    document.querySelectorAll(".rng button").forEach(function (b) {
      b.addEventListener("click", function () {
        chartRange = b.getAttribute("data-r");
        document.querySelectorAll(".rng button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        loadChart(h, cur);
      });
    });
    loadChart(h, cur);
  }
  function loadChart(h, cur) {
    var key = h.market + "-" + h.code + "-" + chartRange, box = document.getElementById("pc-box");
    if (!box) return;
    var go = histCache[key] ? Promise.resolve(histCache[key])
      : fetch("/api/history?market=" + encodeURIComponent(h.market) + "&code=" + encodeURIComponent(h.code) + "&range=" + chartRange)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { if (d && d.points) histCache[key] = d; return d; });
    go.then(function (d) {
      box = document.getElementById("pc-box");
      if (!box) return;
      if (!d || !d.points) { box.innerHTML = '<p class="msg">시세 기록을 받지 못했습니다.</p>'; return; }
      drawChart(box, d, h, cur);
    }).catch(function () { if (box) box.innerHTML = '<p class="msg">시세 기록을 받지 못했습니다.</p>'; });
  }
  function drawChart(box, d, h, cur) {
    var rate = cur === "KRW" ? 1 : (FX ? FX.rate : null);
    var fmt = function (v) { return rate ? nf(v * rate, 0) + "원" : "$" + nf(v, 2); };
    var pts = d.points, n = pts.length, W = 320, H = 150, L = 4, R = 4, T = 10, B = 20;
    var ys = pts.map(function (x) { return x[1]; });
    var avg = h.avg == null ? null : (rate ? (avgKrw(h) == null ? null : avgKrw(h) / rate) : (avgCur(h) === "USD" ? h.avg : null));
    var lo = Math.min.apply(null, ys.concat(avg == null ? [] : [avg])), hi = Math.max.apply(null, ys.concat(avg == null ? [] : [avg]));
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X = function (i) { return L + (W - L - R) * i / (n - 1); };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var path = pts.map(function (x, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(x[1]).toFixed(1); }).join("");
    var day = function (t) { var dd = new Date(t * 1000); return (dd.getMonth() + 1) + "/" + dd.getDate(); };
    var yr = function (t) { var dd = new Date(t * 1000); return dd.getFullYear() + "." + (dd.getMonth() + 1) + "." + dd.getDate(); };
    var first = ys[0], last = ys[n - 1], chg = (last / first - 1) * 100;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc((h.name || h.code) + " 일별 종가 " + yr(pts[0][0]) + "~" + yr(pts[n - 1][0]) + ", " + fmt(first) + "에서 " + fmt(last)) + '">' +
      '<line x1="0" x2="' + W + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="var(--hair)" stroke-width="1"/>' +
      (avg == null ? "" : '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(avg).toFixed(1) + '" y2="' + Y(avg).toFixed(1) +
        '" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>') +
      '<path d="' + path + '" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line id="pc-x" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>' +
      '<circle id="pc-dot" r="4" cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(last).toFixed(1) + '" fill="var(--ink)" stroke="var(--paper)" stroke-width="2"/>' +
      '<text x="' + L + '" y="' + (H - 5) + '" font-size="10" fill="var(--muted)" font-family="var(--f-sans)">' + day(pts[0][0]) + "</text>" +
      '<text x="' + (W - R) + '" y="' + (H - 5) + '" font-size="10" fill="var(--muted)" text-anchor="end" font-family="var(--f-sans)">' + day(pts[n - 1][0]) + "</text>" +
      '<rect id="pc-hit" x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/></svg>';
    var read = function (i) {
      return "<small>" + yr(pts[i][0]) + "</small>" + fmt(pts[i][1]) +
        (avg ? ' <small class="' + dirc(pts[i][1] - avg) + '" style="margin-left:6px">평균 대비 ' + pct((pts[i][1] / avg - 1) * 100) + "</small>" : "");
    };
    box.innerHTML = '<div class="read" id="pc-read" aria-live="polite">' + read(n - 1) + "</div>" + svg +
      '<p class="cap">기간 등락 <span class="' + dirc(chg) + '">' + pct(chg) + "</span> · 최저 " + fmt(Math.min.apply(null, ys)) +
      " · 최고 " + fmt(Math.max.apply(null, ys)) + (avg == null ? "" : " · 점선: 내 평균 단가 " + fmt(avg)) +
      (rate && rate !== 1 ? " · 현재 환율 " + nf(rate, 2) + "원으로 환산" : "") + " · 일별 종가, " + esc(d.source || "") + "</p>";
    var svgEl = box.querySelector("svg"), hit = box.querySelector("#pc-hit"), xl = box.querySelector("#pc-x"),
        dot = box.querySelector("#pc-dot"), rd = box.querySelector("#pc-read");
    function at(ev) {
      var r = svgEl.getBoundingClientRect(), cx = (ev.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(n - 1, Math.round((cx - L) / (W - L - R) * (n - 1))));
      xl.setAttribute("x1", X(i)); xl.setAttribute("x2", X(i)); xl.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(ys[i]));
      rd.innerHTML = read(i);
    }
    function reset() {
      xl.setAttribute("visibility", "hidden");
      dot.setAttribute("cx", X(n - 1)); dot.setAttribute("cy", Y(last));
      rd.innerHTML = read(n - 1);
    }
    hit.addEventListener("pointermove", at);
    hit.addEventListener("pointerdown", at);
    hit.addEventListener("pointerleave", reset);
  }

  /* ── 가격 흐름·배당·애널리스트 의견·AI 매도 점검 ─────────── */
  function cell(label, v, cls) { return "<div><b>" + esc(label) + '</b><span class="' + (cls || "") + '">' + v + "</span></div>"; }
  function padCells(n) { return new Array((3 - n % 3) % 3 + 1).join('<div aria-hidden="true"></div>'); }
  function flowSec(st, cur) {
    var g = st.signals;
    if (!g || !g.last) return "";
    var vs = function (ma) { return ma ? '<small style="font-weight:400"> (현재 ' + pct((g.last / ma - 1) * 100) + ")</small>" : ""; };
    var cells = [cell("20일 이동평균", money(g.ma20, cur) + vs(g.ma20)), cell("60일 이동평균", money(g.ma60, cur) + vs(g.ma60)),
                 cell("1년 범위 위치", g.pos_1y == null ? "—" : nf(g.pos_1y, 0) + "%"),
                 cell("1개월 등락", pct(g.ret_1m), dirc(g.ret_1m)), cell("3개월 등락", pct(g.ret_3m), dirc(g.ret_3m)),
                 cell("1년 고점 대비", pct(g.from_high_pct), dirc(g.from_high_pct))];
    return '<div class="dsec"><h4>가격 흐름</h4><div class="kv">' + cells.join("") + "</div>" +
      '<p class="sub" style="margin-top:6px">' + esc(g.as_of) + " 종가 기준 · " + esc(g.source || "") + "</p></div>";
  }
  function divSec(h, st, cur) {
    var d = st.dividends;
    if (!d) return "";
    var hist = d.history || [];
    if (!hist.length && d.yield_indicated_pct == null) {
      return '<div class="dsec"><h4>배당</h4><p class="msg">최근 2년 동안 배당 기록이 없습니다.</p></div>';
    }
    var cells = [cell("배당수익률 (최근 1년)", d.ttm_yield_pct == null ? "—" : nf(d.ttm_yield_pct, 2) + "%"),
                 cell("주당 배당금 (최근 1년)", money(d.ttm_per_share, cur)), cell("최근 1년 지급 횟수", (d.count_ttm || 0) + "회")];
    if (h.qty && d.ttm_per_share) cells.push(cell("내 예상 연 배당금", money(d.ttm_per_share * h.qty, cur)));
    if (d.yield_indicated_pct != null) cells.push(cell("예정 배당수익률", nf(d.yield_indicated_pct, 2) + "%"));
    if (d.payout_ratio_pct != null) cells.push(cell("배당성향", nf(d.payout_ratio_pct, 1) + "%"));
    if (d.growth_5y_pct != null) cells.push(cell("5년 배당 성장률 (연)", pct(d.growth_5y_pct), dirc(d.growth_5y_pct)));
    return '<div class="dsec"><h4>배당</h4><div class="kv">' + cells.join("") + padCells(cells.length) + "</div>" +
      (hist.length ? "<table><thead><tr><th>지급 기준일</th><th>주당 배당금</th></tr></thead><tbody>" +
        hist.slice().reverse().map(function (x) { return "<tr><td>" + esc(x.date) + "</td><td>" + money(x.amount, cur) + "</td></tr>"; }).join("") +
        "</tbody></table>" : "") +
      '<p class="sub" style="margin-top:6px">' + esc(d.source || "") + (cur !== "KRW" && FX ? " · 현재 환율로 원화 환산" : "") +
      " · 세전 금액</p></div>";
  }
  function analystSec(st) {
    var a = st.analyst;
    if (!a) return "";
    var rows = [["강력 매수", a.strongBuy], ["매수", a.buy], ["보유", a.hold], ["매도", a.sell], ["강력 매도", a.strongSell]];
    var tot = rows.reduce(function (t, r) { return t + (r[1] || 0); }, 0);
    if (!tot) return "";
    return '<div class="dsec"><h4>애널리스트 투자의견</h4><div style="display:grid;gap:6px">' + rows.map(function (r) {
        var w = (r[1] || 0) / tot * 100;
        return '<div class="wrow"><span class="nm">' + r[0] + '</span><span class="bar"><i style="width:' + Math.max(w ? 1 : 0, w).toFixed(1) +
          '%"></i></span><span class="v">' + (r[1] || 0) + "명</span></div>";
      }).join("") + '</div><p class="sub" style="margin-top:6px">' + esc(a.period || "") + " 기준 " + tot + "명 · " + esc(a.source || "") +
      " · 목표가는 무료로 받을 수 있는 공식 출처가 없어 싣지 않음</p></div>";
  }
  var CONSENT = "sp_ai_consent_v1";
  function consented() { try { return localStorage.getItem(CONSENT) === "1"; } catch (e) { return !!window.__spConsent; } }
  function setConsent(v) { window.__spConsent = v; try { v ? localStorage.setItem(CONSENT, "1") : localStorage.removeItem(CONSENT); } catch (e) { /* 이 화면에서만 */ } }
  function levelTxt(st, key, cur) {
    var l = key && st.levels && st.levels[key];
    return l ? money(l.value, cur) + '<small style="font-weight:400;display:block;color:var(--muted)">' + esc(l.label) + "</small>" : "—";
  }
  function adviceSec(st, cur) {
    var head = '<div class="dsec" id="adv"><h4>AI 매도 점검 <small style="font-weight:400;color:var(--muted)">참고용</small></h4>';
    if (!consented()) {
      return head + '<div class="box" style="gap:10px"><p class="msg">AI(Claude)가 여러 조건을 세워 이 종목의 보유·매도 시점을 점검한 <b>참고 의견</b>입니다. ' +
        "예측이 아니며 틀릴 수 있습니다.</p>" +
        '<label style="display:flex;gap:8px;align-items:flex-start;font:500 13.5px/1.5 var(--f-sans)"><input type="checkbox" id="adv-ok" style="width:20px;height:20px;flex:none;margin:2px 0 0;padding:0;accent-color:var(--ink)">' +
        "투자 판단과 그 결과에 대한 책임은 모두 본인에게 있음을 확인합니다.</label>" +
        '<button type="button" class="btn" id="adv-go" disabled>확인하고 보기</button></div></div>';
    }
    var a = st.advice;
    if (!a) {
      return head + '<p class="msg">아직 점검 의견이 없습니다. 다음 아침 신문(또는 새 종목 반영) 때 만들어집니다.</p>' +
        '<p class="sub"><button type="button" class="btn ghost" id="adv-off" style="padding:6px 8px;font-size:12px">확인 철회</button></p></div>';
    }
    var tone = { "보유 유지": "flat", "추가 매수 검토": "up", "일부 매도 검토": "down", "매도 검토": "down", "판단 보류": "flat" }[a.view] || "flat";
    return head +
      '<p style="margin:0 0 10px"><span class="' + tone + '" style="display:inline-block;border:2px solid currentColor;padding:4px 10px;font:700 16px/1.2 var(--f-sans)">' +
      esc(a.view) + "</span></p>" +
      '<div class="kv">' + cell("추천 목표가", levelTxt(st, a.target, cur)) + cell("손절 참고선", levelTxt(st, a.stop, cur)) +
      cell("충족한 조건", (a.conditions || []).filter(function (c) { return c.met; }).length + " / " + (a.conditions || []).length) + "</div>" +
      '<ul style="list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px;font:400 14px/1.55 var(--f-sans)">' +
      (a.conditions || []).map(function (c) {
        return '<li style="display:grid;grid-template-columns:1.6em 1fr;gap:4px"><span aria-label="' + (c.met ? "충족" : "미충족") + '" style="font-weight:700">' +
          (c.met ? "✓" : "✗") + "</span><span><b>" + esc(c.name) + "</b> — " + esc(c.detail) + "</span></li>";
      }).join("") + "</ul>" +
      (a.sell_timing ? '<p style="margin:10px 0 0;font:600 14px/1.55 var(--f-sans)">매도 검토 시점: <span style="font-weight:400">' + esc(a.sell_timing) + "</span></p>" : "") +
      '<p style="margin:8px 0 0;font:400 14px/1.6 var(--f-serif)">' + esc(a.summary) + "</p>" +
      '<p class="sub" style="margin-top:8px">AI(Claude)가 ' + esc(DATA.issue_date) + " 아침 데이터만으로 쓴 참고 의견입니다. 예측·보장이 아니며, " +
      "투자 판단과 책임은 본인에게 있습니다. 목표가·손절선은 데이터로 계산한 기준선 중에서 고른 값입니다. " +
      '<button type="button" class="btn ghost" id="adv-off" style="padding:4px 6px;font-size:12px">확인 철회</button></p></div>';
  }
  function bindAdvice() {
    var ok = document.getElementById("adv-ok"), go = document.getElementById("adv-go"), off = document.getElementById("adv-off");
    if (ok && go) {
      ok.addEventListener("change", function () { go.disabled = !ok.checked; });
      go.addEventListener("click", function () { if (ok.checked) { setConsent(true); render(); var el = document.getElementById("adv"); if (el) el.scrollIntoView(); } });
    }
    if (off) off.addEventListener("click", function () { setConsent(false); render(); });
  }

  /* ── 물타기·불타기 계산기 (원화) ────────────── */
  var calcState = {};
  function calcSec(h, p, cur) {
    var c = calcState[h.id] || {}, px = pxKrw(p, cur);
    var v = function (k, d) { return esc(c[k] != null ? c[k] : d); };
    return '<div class="dsec calc"><h4>물타기·불타기 계산기</h4>' +
      '<p class="msg" style="margin-bottom:8px">추가로 살 가격과 수량을 넣으면 새 평균 단가를 계산합니다. 계산 도구일 뿐 매수 권유가 아닙니다.</p>' +
      '<div class="fgrid"><label for="c-px">추가 매수가 (원)<input id="c-px" inputmode="decimal" autocomplete="off" value="' + v("px", px ? Math.round(px) : "") + '"></label>' +
      '<label for="c-qty">추가 수량 (주)<input id="c-qty" inputmode="decimal" autocomplete="off" placeholder="10" value="' + v("qty", "") + '"></label>' +
      '<label class="wide" for="c-goal">목표 평균 단가 (원, 선택) — 이 값까지 맞추려면 몇 주?<input id="c-goal" inputmode="decimal" autocomplete="off" value="' + v("goal", "") + '"></label></div>' +
      '<div class="kv" id="c-out" aria-live="polite"></div><p class="msg" id="c-note" style="margin-top:8px"></p></div>';
  }
  function bindCalc(h, p, cur) {
    if (!document.getElementById("c-px")) return;
    var val = function (id) { return document.getElementById(id).value; };
    function run() {
      calcState[h.id] = { px: val("c-px"), qty: val("c-qty"), goal: val("c-goal") };
      var a = avgKrw(h), q = h.qty || 0, bx = num(val("c-px")), bq = num(val("c-qty")), goal = num(val("c-goal")), now = pxKrw(p, cur);
      var cells = [], notes = [];
      if (bx && bq) {
        var nq = q + bq, na = q && a != null ? (a * q + bx * bq) / nq : bx;
        cells.push(["새 평균 단가", krw(na)], ["총 보유 수량", nf(nq, nq % 1 ? 2 : 0) + "주"], ["추가 매수 금액", krw(bx * bq)]);
        if (now) cells.push(["현재가 기준 수익률", '<span class="' + dirc(now - na) + '">' + pct((now / na - 1) * 100) + "</span>"]);
        if (q && a != null) cells.push(["평균 단가 변화", '<span class="' + dirc(na - a) + '">' + (na - a > 0 ? "+" : "") + krw(na - a) + "</span>"]);
      }
      if (goal && bx) {
        if (!q || a == null) notes.push("목표 수량을 계산하려면 보유 수량·평균 단가를 먼저 넣으세요.");
        else if (!((bx < goal && goal < a) || (bx > goal && goal > a))) notes.push("목표 평균 단가는 지금 평균 단가(" + krw(a) + ")와 추가 매수가 사이여야 계산할 수 있습니다.");
        else {
          var need = Math.ceil(q * (a - goal) / (goal - bx));
          cells.push(["목표까지 필요 수량", nf(need, 0) + "주"], ["필요 금액", krw(need * bx)]);
        }
      }
      if (!cells.length && !notes.length) notes.push(q && a != null ? "추가 수량을 넣으면 결과가 나옵니다." : "추가 수량을 넣으면 결과가 나옵니다. 보유 수량·평균 단가를 넣어 두면 합쳐서 계산합니다.");
      var out = document.getElementById("c-out");
      out.innerHTML = cells.map(function (x) { return "<div><b>" + esc(x[0]) + "</b><span>" + x[1] + "</span></div>"; }).join("") +
        new Array((3 - cells.length % 3) % 3 + 1).join('<div aria-hidden="true"></div>');   // 3칸 격자의 빈 칸 채움
      out.hidden = !cells.length;
      document.getElementById("c-note").textContent = notes.join(" ");
    }
    ["c-px", "c-qty", "c-goal"].forEach(function (id) { document.getElementById(id).addEventListener("input", run); });
    run();
  }

  /* ── 상세 ───────────────────────────── */
  function renderDetail(h) {
    var st = stockOf(h), p = st && st.price, cur = curOf(h, st), html = "";
    if (st && !h.code) h = Object.assign({}, h, { code: st.code, market: st.market, name: h.name || st.name });
    html += '<div><button type="button" class="btn ghost" id="back">← 내 종목</button></div>';
    html += '<div class="dhead"><div class="t">' + esc(h.name || (st && st.name) || h.code) + "<small>" +
      esc((st && st.exchange) || (h.market === "KR" ? "국내" : "미국")) + " " + esc(h.code) + "</small></div>";
    if (p) {
      html += '<div class="p ' + dirc(p.change) + '">' + money(p.value, cur) + "</div>" +
        '<div class="c ' + dirc(p.change) + '">' + (p.change == null ? "전일비 확인 불가"
          : (cur !== "KRW" && FX ? signed(p.change * FX.rate, 0) + "원" : signed(p.change, cur === "KRW" ? 0 : 2)) + " (" + pct(p.change_pct) + ")") + "</div>" +
        '<div class="sub">기준 ' + esc(p.as_of) + ' · <a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.source) + "</a>" +
        (cur !== "KRW" && FX ? "<br>" + usd(p.value) + " × 환율 " + nf(FX.rate, 2) + "원 (" + esc(FX.as_of || "") + " · " + esc(FX.source || "") + ")" : "") + "</div>";
    } else {
      html += '<p class="msg">' + (st ? "시세를 받지 못했습니다." : "이 종목 정보를 불러오는 중입니다. 1~2분 뒤 이 화면이 자동으로 바뀝니다.") + "</p>";
    }
    html += "</div>";

    if (p) {
      var pv = pnl(h, p, cur) || {}, g = pv.gain == null ? null : pv.gain;
      html += '<div class="kv"><div><b>보유 수량</b><span>' + (h.qty ? nf(h.qty, h.qty % 1 ? 2 : 0) + "주" : "—") + "</span></div>" +
        "<div><b>평균 단가</b><span>" + krw(avgKrw(h)) + (avgCur(h) === "USD" && h.avg != null ? "<small> (" + usd(h.avg) + " 입력)</small>" : "") + "</span></div>" +
        "<div><b>평가 금액</b><span>" + krw(pv.val) + "</span></div>" +
        '<div><b>평가 손익</b><span class="' + dirc(g) + '">' + (g == null ? "—" : (g > 0 ? "+" : "") + krw(g)) + "</span></div>" +
        '<div><b>수익률</b><span class="' + dirc(g) + '">' + (g == null ? "—" : pct(pv.ret)) + "</span></div>" +
        "<div><b>52주 범위</b><span>" + (p.low52 && p.high52 ? nf((p.value - p.low52) / (p.high52 - p.low52) * 100, 0) + "% 위치" : "—") + "</span></div></div>";
      if (p.low52 && p.high52 && p.high52 > p.low52) {
        var pos = Math.max(0, Math.min(100, (p.value - p.low52) / (p.high52 - p.low52) * 100));
        html += '<div class="dsec"><div class="range" aria-hidden="true"><i style="left:calc(' + pos.toFixed(1) + '% - 1px)"></i></div>' +
          '<div class="rl"><span>52주 최저 ' + money(p.low52, cur) + "</span><span>최고 " + money(p.high52, cur) + "</span></div></div>";
      }
    }

    if (p && DATA.site_storage && h.market && h.code) html += chartSec();
    if (st) html += flowSec(st, cur) + divSec(h, st, cur) + analystSec(st) + adviceSec(st, cur);
    if (p) html += calcSec(h, p, cur);

    if (st && st.earnings) {
      var e = st.earnings;
      html += '<div class="dsec"><h4>실적</h4>';
      if (e.next) {
        html += '<p class="next">다음 실적 발표 ' + day(e.next.date) + " " + esc(e.next.hour || "") +
          "<small>" + esc(e.next.quarter) + " · EPS 예상 " + (e.next.eps_est == null ? "—" : "$" + nf(e.next.eps_est, 2)) +
          " · 매출 예상 " + big(e.next.rev_est) + "</small></p>";
      } else if (h.market === "US") {
        html += '<p class="msg">180일 안에 잡힌 실적 발표 일정이 없습니다.</p>';
      }
      if (e.history && e.history.length) {
        var hist = e.history.slice().reverse().map(function (x) {
          return { label: String(x.quarter || "").replace(/^FY(\d\d)(\d\d) /, "$2.") , est: x.eps_est, act: x.eps_act };
        });
        html += chartHtml(hist, ["est", "act"], ["EPS 예상", "EPS 실제"], "달러", 1, 2);
        html += "<table><thead><tr><th>분기</th><th>EPS 예상</th><th>EPS 실제</th><th>서프라이즈</th></tr></thead><tbody>" +
          e.history.map(function (x) {
            return "<tr><td>" + esc(x.quarter) + "</td><td>" + (x.eps_est == null ? "—" : nf(x.eps_est, 2)) + "</td><td>" +
              (x.eps_act == null ? "—" : nf(x.eps_act, 2)) + '</td><td class="' + dirc(x.surprise_pct) + '">' + pct(x.surprise_pct) + "</td></tr>";
          }).join("") + "</tbody></table>";
      }
      if (st.financials && st.financials.length) {
        html += '<p class="sub" style="margin-top:6px">분기 매출액·영업이익 (연결 기준)</p>' +
          chartHtml(st.financials, ["revenue", "op"], ["매출액", "영업이익"], "조원", 1e12, 1);
      }
      if (st.filings && st.filings.length) {
        html += '<ul class="fils">' + st.filings.map(function (f, i) {
          var bid = "fb-" + i, has = f.points && f.points.length;
          return "<li>" + (has
            ? '<button type="button" class="fil" aria-expanded="false" aria-controls="' + bid + '"><span>' + esc(f.title) + '</span><span class="d">' + day(f.date) + " ▾</span></button>" +
              '<div class="fbody" id="' + bid + '" hidden><ul>' + f.points.map(function (pt) { return "<li>" + esc(pt) + "</li>"; }).join("") +
              '</ul><a href="' + esc(f.url) + '" target="_blank" rel="noopener">공시 원문 보기</a></div>'
            : '<div class="fil nolink"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.title) + '</a><span class="d">' + day(f.date) + "</span></div>") + "</li>";
        }).join("") + "</ul>";
      }
      if (e.note) html += '<p class="sub">' + esc(e.note) + "</p>";
      html += '<p class="sub">출처: ' + esc(e.source || "") + "</p></div>";
    }

    if (st) {
      html += '<div class="dsec"><h4>찌라시·풍문</h4><p class="warnline">사실로 확인되지 않은 이야기입니다. 원문과 회사 공시로 직접 확인하세요.</p>';
      if (st.rumors && st.rumors.length) {
        html += '<ul class="rumor">' + st.rumors.map(function (r) {
          var c = r.status === "회사 부인" ? "d" : (r.status === "미확인" ? "u" : "c");
          return '<li><span class="st ' + c + '">' + esc(r.status) + '</span><h3><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + "</a></h3>" +
            (r.summary ? "<p>" + esc(r.summary) + "</p>" : "") + '<span class="m">' + esc(r.source || "") + " · " + esc(r.date || "") + "</span></li>";
        }).join("") + "</ul>";
      } else {
        html += '<p class="msg">최근 이 종목에 도는 풍문이나 해명 공시가 없습니다.</p>';
      }
      html += "</div>";
    }

    if (st) {
      html += '<div class="dsec"><h4>중요 뉴스</h4>';
      if (st.news && st.news.length) {
        html += '<div class="news">' + st.news.map(function (a) {
          return '<article class="art"><div class="meta">' + esc(a.source) + " · " + esc((a.published || "").replace("T", " ").slice(5, 16)) +
            (a.lang === "en" ? " · 영문 기사" : "") + '</div><h3><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) +
            "</a></h3>" + (a.summary ? "<p>" + esc(a.summary) + "</p>" : "") + "</article>";
        }).join("") + "</div>";
      } else {
        html += '<p class="msg">최근 7일 동안 이 종목에 큰 영향을 줄 만한 뉴스가 없습니다.</p>';
      }
      html += "</div>";
    }

    if (db) {
      html += '<form class="box" id="editf" novalidate><h3>보유 정보 수정</h3><div class="fgrid">' +
        '<label for="e-qty">보유 수량<input id="e-qty" inputmode="decimal" value="' + esc(h.qty == null ? "" : h.qty) + '"></label>' +
        '<label for="e-avg">평균 단가 (원)<input id="e-avg" inputmode="decimal" value="' + esc(avgKrw(h) == null ? (h.avg == null ? "" : h.avg) : Math.round(avgKrw(h))) + '"></label></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">저장</button>' +
        '<button class="btn danger" type="button" id="del">종목 삭제</button></div><p class="msg" id="d-msg" aria-live="polite"></p></form>';
    }
    app.innerHTML = html;
    bindCharts();
    if (document.getElementById("pc-box")) bindPriceChart(h, cur);
    bindCalc(h, p, cur);
    bindAdvice();
    document.getElementById("back").addEventListener("click", function () { view = { name: "list" }; render(); window.scrollTo(0, 0); });
    var ef = document.getElementById("editf");
    if (ef) {
      ef.addEventListener("submit", function (ev) {
        ev.preventDefault();
        db.doc("holdings/" + h.id).update({ qty: num(document.getElementById("e-qty").value), avg: num(document.getElementById("e-avg").value), avg_cur: "KRW" })
          .then(function () { setMsg("저장했습니다."); })
          .catch(function (e) { setMsg("저장하지 못했습니다 (" + (e && e.code) + ").", true); });
      });
      var del = document.getElementById("del"), armed = false;
      del.addEventListener("click", function () {
        if (!armed) { armed = true; del.textContent = "정말 삭제 (한 번 더 누르기)"; return; }
        db.doc("holdings/" + h.id).delete().then(function () {
          flash = { text: (h.name || h.code) + " 삭제했습니다.", err: false };
          view = { name: "list" }; render();
        }).catch(function (e) { setMsg("삭제하지 못했습니다 (" + (e && e.code) + ").", true); });
      });
    }
  }

  function render() {
    if (view.name === "detail") {
      var h = holdings.filter(function (x) { return x.id === view.id; })[0];
      if (h) return renderDetail(h);
      view = { name: "list" };
    }
    renderList();
  }


  /* ── 앱을 열 때 갱신 요청 ────────────── */
  function setRefresh(text, err) {
    refreshMsg = text;
    var m = document.getElementById("rf-msg");
    if (m) { m.textContent = text; m.className = "msg" + (err ? " err" : ""); }
  }
  var REFRESH_MSG = {
    not_in_manifest: "자동 갱신이 허용되지 않았습니다. 페이지를 새로 열어 허용하거나, Claude 채팅에 ‘갱신’이라고 보내세요.",
    server_not_connected: "Claude Code Remote 커넥터가 없어 자동 갱신을 못 했습니다. claude.ai 설정 → 커넥터에서 추가하세요.",
    needs_reauth: "Claude Code Remote 연결이 만료됐습니다. claude.ai 설정 → 커넥터에서 다시 연결하세요.",
    blocked_by_policy: "조직 정책으로 자동 갱신이 막혀 있습니다. Claude 채팅에 ‘갱신’이라고 보내세요.",
    approval_required: "조직 정책상 승인이 필요해 자동 갱신을 못 했습니다. Claude 채팅에 ‘갱신’이라고 보내세요."
  };
  function maybeRefresh(reason) {
    if (!db || DATA.site_storage || !DATA.refresh_trigger || !holdings.length || DATA.sample) return;   // Cloudflare 앱은 매시간 예약 작업이 대신함
    var age = Date.now() - (Date.parse(DATA.holdings_at || DATA.collected_at) || 0);
    var missing = holdings.some(function (h) { return !stockOf(h); });
    if (reason !== "add" && !missing && age < (DATA.refresh_after_min || 30) * 60000) return;
    var ref = db.doc("meta/refresh");
    ref.get().then(function (snap) {
      var last = snap.exists ? (Date.parse((snap.data() || {}).requested_at) || 0) : 0;
      var pageAt = Date.parse(DATA.holdings_at || DATA.collected_at) || 0;
      if (Date.now() - last < 10 * 60000 && pageAt < last) {   // 이미 요청했고 아직 반영 전
        setRefresh("최신 정보로 바꾸는 중입니다. 1~2분 뒤 이 화면이 자동으로 바뀝니다.");
        return;
      }
      return ref.set({ requested_at: new Date().toISOString(), reason: reason }).then(fire);
    }).catch(function () { /* 저장소 오류면 조용히 넘어감 */ });
  }
  function fire() {
    return Promise.resolve(window.claude.use("mcp")).then(function (mcp) {
      if (!mcp) { setRefresh("이 화면에서는 자동 갱신을 쓸 수 없습니다. Claude 채팅에 ‘갱신’이라고 보내세요.", true); return; }
      setRefresh("최신 정보로 바꾸는 중입니다. 1~2분 뒤 이 화면이 자동으로 바뀝니다.");
      return mcp.callTool("Claude Code Remote", "fire_trigger", { trigger_id: DATA.refresh_trigger }, { cache: false })
        .catch(function (e) {
          var code = e && e.code;
          setRefresh(REFRESH_MSG[code] || ("갱신 요청이 전달되지 않았을 수 있습니다 (" + code + "). 몇 분 뒤에도 그대로면 Claude 채팅에 ‘갱신’이라고 보내세요."), true);
        });
    });
  }

  /* ── Cloudflare 배포용 저장소·시세 (window.claude 가 없을 때) ──
     내 종목 저장은 /api/holdings(KV), 시세는 /api/quote(Yahoo 프록시)로 대신한다.
     실시간 동기화는 없어서 짧은 간격으로 다시 물어보는 방식으로 흉내 낸다. */
  function siteDb() {
    var pollNow = function () {};
    function call(method, body) {
      return fetch("/api/holdings", { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.ok) { pollNow(); return r.json(); }   // 저장 직후 목록을 바로 다시 받음
          return r.json().catch(function () { return {}; }).then(function (e) {
            var err = new Error("api"); err.code = e.code || ("http_" + r.status); throw err;
          });
        });
    }
    function list() { return fetch("/api/holdings").then(function (r) { if (!r.ok) throw new Error("http_" + r.status); return r.json(); }); }
    return {
      doc: function (path) {
        var id = path.split("/")[1];
        return {
          get: function () {
            return list().then(function (arr) {
              var d = arr.filter(function (x) { return x.id === id; })[0];
              return { exists: !!d, data: function () { return d; } };
            });
          },
          set: function (data) { return call("PUT", { id: id, data: data }); },
          update: function (patch) { return call("PATCH", { id: id, data: patch }); },
          delete: function () { return call("DELETE", { id: id }); },
        };
      },
      collection: function () {
        return {
          onSnapshot: function (cb, errCb) {
            function poll() {
              list().then(function (arr) {
                cb({ docs: arr.map(function (x) { return { id: x.id, data: function () { return x; } }; }) });
              }).catch(function (e) { if (errCb) errCb({ code: "network" }); });
            }
            pollNow = poll;
            poll();
            setInterval(poll, 25000);
          },
        };
      },
    };
  }
  function refreshQuotes() {
    fetch("/api/quote?market=FX&code=USDKRW").then(function (r) { return r.ok ? r.json() : null; }).then(function (q) {
      if (!q || !q.value) return;
      var had = !!FX;
      FX = { rate: q.value, as_of: (q.as_of || "").slice(0, 10) + " 최근값", source: q.source || "Yahoo Finance" };
      if (!busy() && (!had || view.name === "list")) render();
    }).catch(function () { /* 신문에 실린 환율로 계속 */ });
    holdings.forEach(function (h) {
      if (!h.market || !h.code) return;
      fetch("/api/quote?market=" + encodeURIComponent(h.market) + "&code=" + encodeURIComponent(h.code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (q) {
          if (!q) return;
          var base = DATA.stocks[h.id] || liveStocks[h.id] || {};
          if (q.as_of && /T/.test(q.as_of)) {   // ISO → "9/26 05:00 (한국 시간)"
            var t = new Date(q.as_of);
            if (!isNaN(t)) q.as_of = (t.getMonth() + 1) + "/" + t.getDate() + " " + String(t.getHours()).padStart(2, "0") + ":" +
              String(t.getMinutes()).padStart(2, "0") + " (한국 시간)";
          }
          if (!q.url) delete q.url;
          liveStocks[h.id] = Object.assign({}, base, { price: Object.assign({}, base.price || {}, q) });   // 52주 범위 등은 신문 값 유지
          if (!busy() && (view.name === "list" || (view.name === "detail" && view.id === h.id))) render();
        }).catch(function () { /* 이번 주기는 건너뜀 */ });
    });
  }

  /* ── 저장소 연결 ─────────────────────── */
  render();
  if (DATA.site_storage) {
    db = siteDb();
    var siteFirst = true;
    db.collection("holdings").onSnapshot(function (snap) {
      holdings = snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); })
        .sort(function (a, b) { return String(a.added_at || "").localeCompare(String(b.added_at || "")); });
      if (siteFirst || view.name === "list") render();
      refreshQuotes();
      siteFirst = false;
    }, function (e) {
      flash = { text: "저장소 연결이 끊겼습니다 (" + (e && e.code) + "). 새로고침하세요.", err: true };
      render();
    });
    setInterval(refreshQuotes, 30000);
  } else {
    var use = window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null);
    Promise.resolve(use).then(function (ns) {
      if (!ns) return;
      db = ns;
      var first = true;
      db.collection("holdings").onSnapshot(function (snap) {
        holdings = snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); })
          .sort(function (a, b) { return String(a.added_at || "").localeCompare(String(b.added_at || "")); });
        // 편집 중인 입력을 지우지 않도록, 목록 화면이거나 처음 받을 때만 다시 그림
        if (first || view.name === "list") render();
        if (first) maybeRefresh("open");
        first = false;
      }, function (e) {
        flash = { text: "저장소 연결이 끊겼습니다 (" + (e && e.code) + "). 새로고침하세요.", err: true };
        render();
      });
    }).catch(function () { /* 저장소 없이도 동작 */ });
  }
})();
{% endraw %}
