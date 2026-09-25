// Cloudflare Pages 미들웨어: 사이트 전체를 비밀번호 하나로 잠근다 (Zero Trust 대신, 무료·결제 수단 불필요).
// 비밀번호는 Pages 프로젝트의 암호화 변수 SITE_PASSWORD 에만 둔다 (저장소에 넣지 말 것).
// - 브라우저·앱: /__login 에서 한 번 입력하면 1년짜리 쿠키로 기억
// - 예약 작업: Authorization: Bearer <SITE_PASSWORD> 헤더
// - 앱 설치·도메인 확인에 필요한 공개 파일만 예외
const COOKIE = "sp_auth";
const OPEN = new Set(["/.well-known/assetlinks.json", "/manifest.webmanifest", "/robots.txt",
                      "/icon-180.png", "/icon-192.png", "/icon-512.png"]);
const MAX_AGE = 60 * 60 * 24 * 365;

async function tokenFor(password) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("stock-paper:" + password));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookieOf(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : "";
}

function safeNext(v) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

function loginPage(next, error, status) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>아침증권신문 · 로그인</title>
<style>
:root{--paper:#edeae2;--ink:#17160f;--muted:#6a665b;--rule:#2a2922;--err:#c8102e;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--paper:#141517;--ink:#e7e3d8;--muted:#8f8a7e;--rule:#cfc9bb;--err:#ff6b66;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);
  font:16px/1.6 "Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;padding:16px}
form{width:100%;max-width:340px}
h1{font:400 40px/1 "Nanum Myeongjo","AppleMyungjo",serif;text-align:center;margin:0 0 12px}
.bar{border-top:3px double var(--rule);border-bottom:1px solid var(--rule);padding:5px 0;text-align:center;font-size:13px;color:var(--muted);margin-bottom:20px}
label{display:block;font-size:14px;margin-bottom:6px}
input{width:100%;font:inherit;padding:12px;border:1px solid var(--rule);background:transparent;color:inherit;border-radius:0}
button{width:100%;margin-top:12px;font:600 16px/1 inherit;padding:14px;border:0;background:var(--ink);color:var(--paper);cursor:pointer}
.err{color:var(--err);font-size:14px;margin:10px 0 0}
</style></head><body>
<form method="post" action="/__login">
<h1>아침증권신문</h1><div class="bar">개인용 · 비밀번호가 필요합니다</div>
<label for="pw">비밀번호</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">열기</button>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
</form></body></html>`;
  return new Response(html, { status: status || 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (OPEN.has(url.pathname)) return next();

  const password = env.SITE_PASSWORD;
  if (!password) {
    return new Response("SITE_PASSWORD 가 설정되지 않아 사이트를 열 수 없습니다. Cloudflare Pages 설정 → Variables and Secrets 에서 추가하세요.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const token = await tokenFor(password);

  if (url.pathname === "/__login") {
    if (request.method !== "POST") return loginPage(safeNext(url.searchParams.get("next")), "", 200);
    const form = await request.formData().catch(() => null);
    const given = form ? String(form.get("password") || "") : "";
    const dest = safeNext(form ? String(form.get("next") || "/") : "/");
    if (!same(await tokenFor(given), token)) {
      await new Promise((r) => setTimeout(r, 800));   // 무작위 대입 늦추기
      return loginPage(dest, "비밀번호가 맞지 않습니다.", 401);
    }
    return new Response(null, { status: 303, headers: {
      location: dest,
      "set-cookie": `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      "cache-control": "no-store",
    } });
  }

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (same(cookieOf(request, COOKIE), token) || (bearer && same(bearer, password))) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "private, no-cache");   // 잠긴 내용이 공용 캐시에 남지 않게
    return out;
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html")) {
    return loginPage(url.pathname + url.search, "", 401);
  }
  return new Response("unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
}
