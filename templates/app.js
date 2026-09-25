{% raw %}
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("stock-data").textContent);
  var app = document.getElementById("app");
  var db = null;
  var holdings = (DATA.snapshot || []).map(function (h) { return Object.assign({}, h, { id: keyOf(h) }); });
  var view = { name: "list" };
  var flash = null;
  var refreshMsg = "";

  function keyOf(h) { return String(h.market || "KR").toUpperCase() + "-" + String(h.code || "").toUpperCase(); }
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

  /* ── 목록 ───────────────────────────── */
  function rowHtml(h) {
    var st = DATA.stocks[h.id], p = st && st.price, cur = curOf(h, st), pl = "";
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
    if (f) f.addEventListener("submit", onAdd);
    if (flash) { setMsg(flash.text, flash.err); flash = null; }
  }

  function formHtml() {
    if (!db) {
      return '<p class="msg">종목 추가·수정은 claude.ai에서 이 페이지를 열었을 때만 됩니다.</p>';
    }
    return '<form class="box" id="addf" novalidate><h3>종목 추가</h3><div class="fgrid">' +
      '<label for="f-market">시장<select id="f-market"><option value="KR">국내</option><option value="US">미국</option></select></label>' +
      '<label for="f-code">종목코드·티커<input id="f-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="005930 / NVDA"></label>' +
      '<label class="wide" for="f-name">이름 (선택)<input id="f-name" autocomplete="off" placeholder="삼성전자"></label>' +
      '<label for="f-qty">보유 수량 (선택)<input id="f-qty" inputmode="decimal" autocomplete="off" placeholder="10"></label>' +
      '<label for="f-avg">평균 단가 (선택)<input id="f-avg" inputmode="decimal" autocomplete="off" placeholder="원 / 달러"></label>' +
      '</div><button class="btn" type="submit">추가</button><p class="msg" id="f-msg" aria-live="polite"></p></form>';
  }

  function setMsg(text, err) {
    var m = document.getElementById("f-msg") || document.getElementById("d-msg");
    if (m) { m.textContent = text; m.className = "msg" + (err ? " err" : ""); }
  }

  function onAdd(ev) {
    ev.preventDefault();
    var market = document.getElementById("f-market").value;
    var code = document.getElementById("f-code").value.trim().toUpperCase();
    if (market === "KR" && !/^\d{6}$/.test(code)) return setMsg("국내 종목은 6자리 숫자 코드로 입력하세요. 예: 005930", true);
    if (market === "US" && !/^[A-Z][A-Z.\-]{0,9}$/.test(code)) return setMsg("미국 종목은 티커로 입력하세요. 예: NVDA, BRK.B", true);
    var h = { market: market, code: code, name: document.getElementById("f-name").value.trim(),
              qty: num(document.getElementById("f-qty").value), avg: num(document.getElementById("f-avg").value),
              added_at: new Date().toISOString() };
    var btn = ev.target.querySelector("button");
    btn.disabled = true;
    db.doc("holdings/" + keyOf(h)).set(h).then(function () {
      flash = { text: (h.name || code) + " 추가했습니다.", err: false };
      renderList();
      if (!DATA.stocks[keyOf(h)]) maybeRefresh("add");
    }).catch(function (e) {
      btn.disabled = false;
      setMsg(e && e.code === "quota_exceeded" ? "저장 공간이 가득 찼습니다. 종목을 몇 개 지운 뒤 다시 시도하세요."
             : "저장하지 못했습니다 (" + (e && e.code) + "). 이 페이지를 수정할 권한이 있는지 확인하세요.", true);
    });
  }

  /* ── 상세 ───────────────────────────── */
  function renderDetail(h) {
    var st = DATA.stocks[h.id], p = st && st.price, cur = curOf(h, st), html = "";
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
        html += "<table><thead><tr><th>분기</th><th>EPS 예상</th><th>EPS 실제</th><th>서프라이즈</th></tr></thead><tbody>" +
          e.history.map(function (x) {
            return "<tr><td>" + esc(x.quarter) + "</td><td>" + (x.eps_est == null ? "—" : nf(x.eps_est, 2)) + "</td><td>" +
              (x.eps_act == null ? "—" : nf(x.eps_act, 2)) + '</td><td class="' + dirc(x.surprise_pct) + '">' + pct(x.surprise_pct) + "</td></tr>";
          }).join("") + "</tbody></table>";
      }
      if (st.filings && st.filings.length) {
        html += '<ul class="disc">' + st.filings.map(function (f) {
          return '<li><div class="rep"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.title) + '</a></div><div class="d">' + day(f.date) + "</div></li>";
        }).join("") + "</ul>";
      }
      if (e.note) html += '<p class="sub">' + esc(e.note) + "</p>";
      html += '<p class="sub">출처: ' + esc(e.source || "") + "</p></div>";
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
    var missing = holdings.some(function (h) { return !DATA.stocks[h.id]; });
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

  /* ── 저장소 연결 ─────────────────────── */
  render();
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
})();
{% endraw %}
