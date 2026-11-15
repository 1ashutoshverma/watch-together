const crypto = require("crypto");

const COOKIE = "wt";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

function sign(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  const h = req.headers || {};
  return h["cf-connecting-ip"] || (req.socket && req.socket.remoteAddress) || req.address || "unknown";
}

function createAuth({ password, secret, now = Date.now, ttlMs = 24 * 60 * 60 * 1000 }) {
  const key = secret || crypto.randomBytes(32);
  const fails = new Map();

  function login(pw, rawName, ip) {
    const t = now();
    const rec = fails.get(ip);
    if (rec && rec.resetAt < t) fails.delete(ip);
    const cur = fails.get(ip);
    if (cur && cur.count >= MAX_FAILS) return { ok: false, error: "rate-limited" };

    if (!safeEqual(pw || "", password)) {
      const r = fails.get(ip) || { count: 0, resetAt: t + WINDOW_MS };
      r.count++;
      fails.set(ip, r);
      return { ok: false, error: "wrong-password" };
    }
    const name = String(rawName || "").trim().slice(0, 24);
    if (!name) return { ok: false, error: "name-required" };
    fails.delete(ip);
    const payload = Buffer.from(name).toString("base64url") + "." + (t + ttlMs);
    return { ok: true, name, token: payload + "." + sign(key, payload) };
  }

  function verify(token) {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[0] + "." + parts[1];
    if (!safeEqual(sign(key, payload), parts[2])) return null;
    if (Number(parts[1]) < now()) return null;
    return { name: Buffer.from(parts[0], "base64url").toString() };
  }

  function tokenFromReq(req) {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) return auth.slice(7);
    return parseCookies(req.headers.cookie)[COOKIE];
  }

  function httpMiddleware(req, res, next) {
    const user = verify(tokenFromReq(req));
    if (!user) {
      if (req.method === "GET" && (req.path === "/" || req.path.endsWith(".html"))) return res.redirect("/login.html");
      return res.status(401).json({ error: "unauthorized" });
    }
    req.user = user;
    next();
  }

  function socketMiddleware(socket, next) {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || (socket.handshake.query && socket.handshake.query.token) || parseCookies(socket.handshake.headers.cookie)[COOKIE];
    const user = verify(token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  }

  // Engine-level gate so unauthenticated clients can't even open a socket.io transport.
  function allowRequest(req, callback) {
    let token = parseCookies(req.headers.cookie)[COOKIE];
    if (!verify(token)) {
      try {
        token = new URL(req.url, "http://x").searchParams.get("token");
      } catch {
        token = null;
      }
    }
    callback(null, !!verify(token));
  }

  function cookieFor(req, token) {
    const secure = req.headers["x-forwarded-proto"] === "https" || req.secure;
    return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? "; Secure" : ""}`;
  }

  return { login, verify, httpMiddleware, socketMiddleware, allowRequest, cookieFor, clientIp };
}

module.exports = { createAuth, parseCookies, clientIp, COOKIE };
