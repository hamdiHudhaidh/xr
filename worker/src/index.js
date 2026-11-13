const ORIGINS = ["https://hamdihudhaidh.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const KEYS = new Set(["data", "test", "avatars"]);
const MAX_BYTES = { data: 500000, test: 500000, avatars: 20000000 };
const AVATAR_ONE_MAX = 400000;
const AVATAR_NAME_MAX = 80;
const AVATAR_MAX_COUNT = 200;
const AVATAR_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/;

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
const json = (req, body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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
    const key = new URL(req.url).searchParams.get("k");
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
    if (!KEYS.has(key)) return json(req, { ok: true, service: "xr-admin-api", endpoints: ["/data", "/avatars"] }, key ? 404 : 200);
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
