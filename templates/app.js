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
  function money(v, cur) { return v == null ? "—" : (cur === "KRW" ? nf(v, 0) + "원" : "$" + nf(v, 2)); }
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
    if (p && h.qty && h.avg) {
      var g = (p.value - h.avg) * h.qty, r = (p.value / h.avg - 1) * 100;
      pl = ' · <span class="' + dirc(g) + '">' + (g > 0 ? "+" : "") + money(g, cur) + " (" + pct(r) + ")</span>";
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

  function renderList() {
    var list = holdings.length ? '<ul class="plist">' + holdings.map(rowHtml).join("") + "</ul>"
      : '<p class="msg">아직 추가한 종목이 없습니다. 아래에서 추가하세요.</p>';
    app.innerHTML =
      '<div><h2>내 종목</h2><p class="sub">' + esc(DATA.issue_date) + " 아침 발행 기준 · 종목을 누르면 중요 뉴스·실적·손익을 봅니다</p>" +
      (DATA.sample ? '<p class="sample">견본 — 샘플 데이터입니다</p>' : "") +
      '<p class="msg" id="rf-msg" aria-live="polite">' + esc(refreshMsg) + "</p></div>" +
      list + formHtml();
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
      '<label class="wide" for="f-q">종목 이름 또는 코드<input id="f-q" list="f-list" autocomplete="off" spellcheck="false" placeholder="삼성전자, 엔비디아, NVDA, 005930"></label>' +
      '<datalist id="f-list"></datalist>' +
      '<label for="f-qty">보유 수량 (선택)<input id="f-qty" inputmode="decimal" autocomplete="off" placeholder="10"></label>' +
      '<label for="f-avg">평균 단가 (선택)<input id="f-avg" inputmode="decimal" autocomplete="off" placeholder="원 / 달러"></label>' +
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
  function fillList(q) {
    var dl = document.getElementById("f-list");
    if (!dl) return;
    var n = q.replace(/\s/g, ""), out = [];
    if (n.length >= 1) {
      for (var k in USKO) { if (k.indexOf(n) === 0) out.push(k + " (" + USKO[k] + ")"); if (out.length >= 5) break; }
      var kr = (DATA.names && DATA.names.kr) || [];
      for (var i = 0; i < kr.length && out.length < 12; i++) if (kr[i][0].replace(/\s/g, "").indexOf(n) === 0) out.push(kr[i][0] + " (" + kr[i][1] + ")");
    }
    dl.innerHTML = out.map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join("");
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
    var id = r.market ? keyOf(r) : "Q-" + Date.now().toString(36);
    var h = { market: r.market, code: r.code, name: r.name, query: raw,
              qty: num(document.getElementById("f-qty").value), avg: num(document.getElementById("f-avg").value),
              added_at: new Date().toISOString() };
    var btn = ev.target.querySelector("button");
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

  /* ── 상세 ───────────────────────────── */
  function renderDetail(h) {
    var st = stockOf(h), p = st && st.price, cur = curOf(h, st), html = "";
    if (st && !h.code) h = Object.assign({}, h, { code: st.code, market: st.market, name: h.name || st.name });
    html += '<div><button type="button" class="btn ghost" id="back">← 내 종목</button></div>';
    html += '<div class="dhead"><div class="t">' + esc(h.name || (st && st.name) || h.code) + "<small>" +
      esc((st && st.exchange) || (h.market === "KR" ? "국내" : "미국")) + " " + esc(h.code) + "</small></div>";
    if (p) {
      html += '<div class="p ' + dirc(p.change) + '">' + money(p.value, cur) + "</div>" +
        '<div class="c ' + dirc(p.change) + '">' + (p.change == null ? "전일비 확인 불가" : signed(p.change, cur === "KRW" ? 0 : 2) + " (" + pct(p.change_pct) + ")") + "</div>" +
        '<div class="sub">기준 ' + esc(p.as_of) + ' · <a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.source) + "</a></div>";
    } else {
      html += '<p class="msg">' + (st ? "시세를 받지 못했습니다." : "이 종목 정보를 불러오는 중입니다. 1~2분 뒤 이 화면이 자동으로 바뀝니다.") + "</p>";
    }
    html += "</div>";

    if (p) {
      var val = h.qty ? p.value * h.qty : null, g = h.qty && h.avg ? (p.value - h.avg) * h.qty : null;
      html += '<div class="kv"><div><b>보유 수량</b><span>' + (h.qty ? nf(h.qty, h.qty % 1 ? 2 : 0) + "주" : "—") + "</span></div>" +
        "<div><b>평균 단가</b><span>" + money(h.avg, cur) + "</span></div>" +
        "<div><b>평가 금액</b><span>" + money(val, cur) + "</span></div>" +
        '<div><b>평가 손익</b><span class="' + dirc(g) + '">' + (g == null ? "—" : (g > 0 ? "+" : "") + money(g, cur)) + "</span></div>" +
        '<div><b>수익률</b><span class="' + dirc(g) + '">' + (g == null ? "—" : pct((p.value / h.avg - 1) * 100)) + "</span></div>" +
        "<div><b>52주 범위</b><span>" + (p.low52 && p.high52 ? nf((p.value - p.low52) / (p.high52 - p.low52) * 100, 0) + "% 위치" : "—") + "</span></div></div>";
      if (p.low52 && p.high52 && p.high52 > p.low52) {
        var pos = Math.max(0, Math.min(100, (p.value - p.low52) / (p.high52 - p.low52) * 100));
        html += '<div class="dsec"><div class="range" aria-hidden="true"><i style="left:calc(' + pos.toFixed(1) + '% - 1px)"></i></div>' +
          '<div class="rl"><span>52주 최저 ' + money(p.low52, cur) + "</span><span>최고 " + money(p.high52, cur) + "</span></div></div>";
      }
    }

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
        '<label for="e-avg">평균 단가<input id="e-avg" inputmode="decimal" value="' + esc(h.avg == null ? "" : h.avg) + '"></label></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">저장</button>' +
        '<button class="btn danger" type="button" id="del">종목 삭제</button></div><p class="msg" id="d-msg" aria-live="polite"></p></form>';
    }
    app.innerHTML = html;
    bindCharts();
    document.getElementById("back").addEventListener("click", function () { view = { name: "list" }; render(); window.scrollTo(0, 0); });
    var ef = document.getElementById("editf");
    if (ef) {
      ef.addEventListener("submit", function (ev) {
        ev.preventDefault();
        db.doc("holdings/" + h.id).update({ qty: num(document.getElementById("e-qty").value), avg: num(document.getElementById("e-avg").value) })
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
    if (!db || !DATA.refresh_trigger || !holdings.length || DATA.sample) return;
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
    function call(method, body) {
      return fetch("/api/holdings", { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.ok) return r.json();
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
            poll();
            setInterval(poll, 25000);
          },
        };
      },
    };
  }
  function refreshQuotes() {
    holdings.forEach(function (h) {
      if (!h.market || !h.code) return;
      fetch("/api/quote?market=" + encodeURIComponent(h.market) + "&code=" + encodeURIComponent(h.code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (q) {
          if (!q) return;
          var base = DATA.stocks[h.id] || liveStocks[h.id] || {};
          liveStocks[h.id] = Object.assign({}, base, { price: q });
          if (view.name === "list" || (view.name === "detail" && view.id === h.id)) render();
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
