const ORIGINS = ["https://hamdihudhaidh.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];
const KEYS = new Set(["data", "test"]);

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
    if (!KEYS.has(key)) return json(req, { ok: true, service: "xr-admin-api", endpoints: ["/data"] }, key ? 404 : 200);
    const stub = env.STORE.get(env.STORE.idFromName("main"));
    const inner = "https://store/?k=" + key;
    if (req.method === "GET") return json(req, await (await stub.fetch(inner)).text());
    const authed = safeEq(req.headers.get("X-Passcode") || "", env.ADMIN_PASSCODE || "\u0000none");
    if (req.method === "POST" && url.searchParams.get("check") === "1") return json(req, { ok: authed }, authed ? 200 : 401);
    if (!authed) return json(req, { error: "bad passcode" }, 401);
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 500000) return json(req, { error: "too large" }, 413);
      try { JSON.parse(body); } catch { return json(req, { error: "invalid json" }, 400); }
      await stub.fetch(inner, { method: "PUT", body });
      return json(req, { ok: true });
    }
    if (req.method === "DELETE") { await stub.fetch(inner, { method: "DELETE" }); return json(req, { ok: true }); }
    return json(req, { error: "method" }, 405);
  },
};
