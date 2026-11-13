const ORIGINS = ["https://hamdihudhaidh.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const KEYS = new Set(["data", "test", "avatars"]);
const MAX_BYTES = { data: 500000, test: 500000, avatars: 20000000 };
const AVATAR_ONE_MAX = 400000;
const AVATAR_NAME_MAX = 80;
const AVATAR_MAX_COUNT = 200;
const AVATAR_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;
const CLICKER_MAX = 9999;
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 40;
const rateBuckets = new Map();

function cors(req) {
  const o = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Passcode",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (req, body, status = 200, extra = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function todayRiyadh(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function clientIp(req) {
  return req.headers.get("CF-Connecting-IP") || (req.headers.get("X-Forwarded-For") || "").split(",")[0].trim() || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  let arr = rateBuckets.get(ip) || [];
  arr = arr.filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { rateBuckets.set(ip, arr); return true; }
  arr.push(now);
  rateBuckets.set(ip, arr);
  return false;
}

function parseClickerBody(parsed, today) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "expected an object" };
  if (typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return { error: "date must be today" };
  if (parsed.date !== today) return { error: "date must be today" };
  const src = (parsed.numbers && typeof parsed.numbers === "object" && !Array.isArray(parsed.numbers))
    ? parsed.numbers
    : null;
  if (!src) return { error: "expected numbers" };
  const out = {};
  for (const k of Object.keys(src)) {
    if (!/^[1-8]$/.test(k)) return { error: "unknown session key" };
    const v = src[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "bad session" };
    const rec = {};
    for (const field of ["participants", "engagement"]) {
      if (!(field in v)) continue;
      const n = v[field];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > CLICKER_MAX) {
        return { error: "values must be non-negative integers under 10000" };
      }
      rec[field] = n;
    }
    if ("participants" in rec || "engagement" in rec) out[k] = rec;
  }
  return { ok: true, numbers: out };
}

function validateAvatars(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "expected an object of name → image";
  const keys = Object.keys(obj);
  if (keys.length > AVATAR_MAX_COUNT) return "too many avatars";
  for (const name of keys) {
    if (typeof name !== "string" || !name.trim() || name.length > AVATAR_NAME_MAX) return "bad name";
    const v = obj[name];
    if (v == null || v === "") { delete obj[name]; continue; }
    if (typeof v !== "string") return "image must be a data URL";
    if (v.length > AVATAR_ONE_MAX) return "image too large";
    if (!AVATAR_RE.test(v)) return "image must be a jpeg, png or webp data URL";
  }
  return null;
}

export class Store {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    const key = url.searchParams.get("k");
    const op = url.searchParams.get("op");
    if (req.method === "POST" && op === "clicker" && key === "data") {
      let patch;
      try { patch = await req.json(); } catch { return new Response("bad", { status: 400 }); }
      const today = typeof patch.today === "string" ? patch.today : "";
      const numbers = patch.numbers && typeof patch.numbers === "object" && !Array.isArray(patch.numbers) ? patch.numbers : {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return new Response("bad date", { status: 400 });
      let data = {};
      try { data = JSON.parse((await this.state.storage.get("data")) || "{}"); } catch { data = {}; }
      if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
      if (!data.numbers || typeof data.numbers !== "object" || Array.isArray(data.numbers)) data.numbers = {};
      if (Object.keys(numbers).length) data.numbers[today] = numbers;
      else delete data.numbers[today];
      data.updatedAt = new Date().toISOString();
      await this.state.storage.put("data", JSON.stringify(data));
      return new Response(JSON.stringify({ ok: true, date: today }), { headers: { "Content-Type": "application/json" } });
    }
    if (req.method === "GET") return new Response((await this.state.storage.get(key)) || "{}");
    if (req.method === "PUT") { await this.state.storage.put(key, await req.text()); return new Response("ok"); }
    if (req.method === "DELETE") { await this.state.storage.delete(key); return new Response("ok"); }
    return new Response("bad", { status: 405 });
  }
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const key = url.pathname.replace(/^\/+|\/+$/g, "") || "";

    if (key === "clicker") {
      if (req.method === "GET") return json(req, { ok: true, date: todayRiyadh() });
      if (req.method !== "PUT") return json(req, { error: "method" }, 405);
      if (rateLimited(clientIp(req))) return json(req, { error: "rate limit" }, 429, { "Retry-After": "30" });
      let parsed;
      try {
        const text = await req.text();
        if (text.length > 20000) return json(req, { error: "too large" }, 413);
        parsed = JSON.parse(text);
      } catch { return json(req, { error: "invalid json" }, 400); }
      const today = todayRiyadh();
      const check = parseClickerBody(parsed, today);
      if (!check.ok) return json(req, { error: check.error }, 400);
      const stub = env.STORE.get(env.STORE.idFromName("main"));
      const inner = "https://store/?k=data&op=clicker";
      const res = await stub.fetch(inner, { method: "POST", body: JSON.stringify({ today, numbers: check.numbers }) });
      if (!res.ok) return json(req, { error: "store" }, 500);
      return json(req, { ok: true, date: today });
    }

    if (!KEYS.has(key)) return json(req, { ok: true, service: "xr-admin-api", endpoints: ["/data", "/avatars", "/clicker"] }, key ? 404 : 200);
    const stub = env.STORE.get(env.STORE.idFromName("main"));
    const inner = "https://store/?k=" + key;
    if (req.method === "GET") return json(req, await (await stub.fetch(inner)).text());
    const authed = safeEq(req.headers.get("X-Passcode") || "", env.ADMIN_PASSCODE || "\u0000none");
    if (req.method === "POST" && url.searchParams.get("check") === "1") return json(req, { ok: authed }, authed ? 200 : 401);
    if (!authed) return json(req, { error: "bad passcode" }, 401);
    if (req.method === "PUT") {
      const body = await req.text();
      const limit = MAX_BYTES[key] || 500000;
      if (body.length > limit) return json(req, { error: "too large" }, 413);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return json(req, { error: "invalid json" }, 400); }
      if (key === "avatars") {
        const err = validateAvatars(parsed);
        if (err) return json(req, { error: err }, 400);
        await stub.fetch(inner, { method: "PUT", body: JSON.stringify(parsed) });
        return json(req, { ok: true });
      }
      await stub.fetch(inner, { method: "PUT", body });
      return json(req, { ok: true });
    }
    if (req.method === "DELETE") { await stub.fetch(inner, { method: "DELETE" }); return json(req, { ok: true }); }
    return json(req, { error: "method" }, 405);
  },
};
