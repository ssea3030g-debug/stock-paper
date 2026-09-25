// Cloudflare Pages Function: /api/holdings
// 내 종목 목록을 KV 네임스페이스(바인딩 이름 HOLDINGS)에 JSON 배열 하나로 저장한다.
// 개인용 단일 사용자 저장소라 문서별 키 대신 배열 통째 읽기/쓰기로 충분하다.
// 인증은 functions/_middleware.js(사이트 비밀번호)가 맡는다.
const KEY = "list";
const FIELDS = ["market", "code", "name", "query", "qty", "avg", "added_at"];
const MAX_ITEMS = 100;
const ID_RE = /^(?:(?:KR|US)-[A-Z0-9.\-]{1,20}|Q-[a-z0-9]{1,20})$/;   // 종목 문서만 (다른 키가 목록에 섞이지 않게)

function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { "content-type": "application/json" } }, init));
}
function err(status, code) {
  return json({ code }, { status });
}

async function readList(env) {
  const raw = await env.HOLDINGS.get(KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && ID_RE.test(x.id)) : [];
  } catch (e) {
    return [];
  }
}
function writeList(env, list) {
  return env.HOLDINGS.put(KEY, JSON.stringify(list));
}

function sanitize(d) {
  d = d && typeof d === "object" ? d : {};
  const out = {};
  for (const k of FIELDS) if (k in d) out[k] = d[k];
  if (out.market !== undefined && !["KR", "US", ""].includes(out.market)) delete out.market;
  if (typeof out.code === "string") out.code = out.code.slice(0, 20);
  else delete out.code;
  if (typeof out.name === "string") out.name = out.name.slice(0, 60);
  else delete out.name;
  if (typeof out.query === "string") out.query = out.query.slice(0, 80);
  else delete out.query;
  if (typeof out.qty !== "number" || !isFinite(out.qty)) delete out.qty;
  if (typeof out.avg !== "number" || !isFinite(out.avg)) delete out.avg;
  if (typeof out.added_at !== "string") delete out.added_at;
  return out;
}

export async function onRequestGet({ env }) {
  if (!env.HOLDINGS) return err(500, "no_kv_binding");
  return json(await readList(env));
}

export async function onRequestPut({ request, env }) {
  if (!env.HOLDINGS) return err(500, "no_kv_binding");
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err(400, "bad_request");
  }
  if (!body || typeof body.id !== "string" || !ID_RE.test(body.id)) return err(400, "bad_request");
  const list = await readList(env);
  const data = Object.assign({ id: body.id }, sanitize(body.data));
  const i = list.findIndex((x) => x.id === body.id);
  if (i >= 0) {
    list[i] = data;
  } else {
    if (list.length >= MAX_ITEMS) return err(400, "quota_exceeded");
    list.push(data);
  }
  await writeList(env, list);
  return json({ ok: true });
}

export async function onRequestPatch({ request, env }) {
  if (!env.HOLDINGS) return err(500, "no_kv_binding");
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err(400, "bad_request");
  }
  if (!body || typeof body.id !== "string" || !body.id) return err(400, "bad_request");
  const list = await readList(env);
  const i = list.findIndex((x) => x.id === body.id);
  if (i < 0) return err(404, "not_found");
  Object.assign(list[i], sanitize(body.data));
  await writeList(env, list);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.HOLDINGS) return err(500, "no_kv_binding");
  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  if (!body || typeof body.id !== "string" || !body.id) return err(400, "bad_request");
  const list = await readList(env);
  await writeList(env, list.filter((x) => x.id !== body.id));
  return json({ ok: true });
}
