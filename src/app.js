const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { createAuth } = require("./auth");
const { createRoom } = require("./room");
const { createMediaManager } = require("./media/fetcher");
const { mediaRoutes } = require("./media/routes");
const { attachSockets } = require("./sockets");

const PUBLIC = path.join(__dirname, "..", "public");
const OPEN_FILES = new Set(["/login.html", "/login.js", "/app.css", "/icon.svg"]);

function createServer(config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  const auth = createAuth({ password: config.password });
  const room = createRoom();
  const manager = createMediaManager({ cookiesBrowser: config.cookiesBrowser });

  app.use((req, res, next) => {
    res.set({ "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    next();
  });

  // CORS only for the extension login (token-based, no cookies).
  app.use("/api/login", (req, res, next) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" });
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.post("/api/login", express.json({ limit: "4kb" }), (req, res) => {
    const { password, name } = req.body || {};
    const r = auth.login(password, name, auth.clientIp(req));
    if (!r.ok) return res.status(r.error === "rate-limited" ? 429 : 401).json({ error: r.error });
    res.set("Set-Cookie", auth.cookieFor(req, r.token));
    res.json({ ok: true, name: r.name, token: r.token });
  });

  app.post("/api/logout", (req, res) => {
    res.set("Set-Cookie", "wt=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (req.method === "GET" && OPEN_FILES.has(req.path)) return res.sendFile(path.join(PUBLIC, req.path));
    next();
  });

  app.use(auth.httpMiddleware);
  app.get("/api/me", (req, res) => res.json({ name: req.user.name }));
  app.get("/vendor/hls.min.js", (req, res) => res.sendFile(require.resolve("hls.js/dist/hls.min.js")));
  app.use(mediaRoutes({ manager, mediaDir: config.mediaDir }));
  app.use(express.static(PUBLIC, { index: "index.html" }));

  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true, maxHttpBufferSize: 1e6, cors: { origin: true, credentials: false } });
  attachSockets(io, { room, manager, mediaDir: config.mediaDir, auth });

  return { app, server, io, auth, room, manager };
}

module.exports = { createServer };
