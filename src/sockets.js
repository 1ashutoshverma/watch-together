const { resolveSafe } = require("./media/library");

const COUNTDOWN_MS = 4000;

function attachSockets(io, { room, manager, mediaDir, auth }) {
  io.use(auth.socketMiddleware);

  manager.on("status", (s) => io.emit("media-status", s));

  async function load(fn) {
    try {
      const media = await fn();
      io.emit("state", room.setMedia(media));
      io.emit("media-status", { status: "ready" });
    } catch (e) {
      if (e.superseded) return;
      io.emit("media-status", { status: "error" });
      io.emit("media-error", { message: e.message || "Couldn't load that." });
    }
  }

  io.on("connection", (socket) => {
    const name = socket.data.user.name;
    const joined = room.join(name, socket.id);
    if (!joined.ok) {
      socket.emit("room-full");
      return socket.disconnect(true);
    }
    socket.join("room");
    socket.emit("hello", { name, serverNow: Date.now() });
    socket.emit("state", room.stateForJoin());
    socket.emit("chat-history", room.chat());
    io.emit("presence", { online: room.online() });

    socket.on("time-sync", (ack) => typeof ack === "function" && ack(Date.now()));

    socket.on("intent", (intent) => {
      if (!intent || !["play", "pause", "seek"].includes(intent.type)) return;
      io.emit("state", room.applyIntent(intent));
    });

    socket.on("chat", (text) => {
      const msg = room.addChat(name, text);
      if (msg) io.emit("chat", msg);
    });

    socket.on("typing", () => socket.broadcast.emit("typing", { name }));
    socket.on("panic", () => {
      const s = room.stateForJoin();
      io.emit("state", room.applyIntent({ type: "pause", position: s.position }));
      io.emit("panic", { by: name });
    });

    socket.on("countdown", ({ action } = {}) => {
      if (!["play", "pause"].includes(action)) return;
      const at = Date.now() + (action === "play" ? COUNTDOWN_MS : 0);
      io.emit("countdown", { action, at, by: name });
      const s = room.stateForJoin();
      setTimeout(() => {
        io.emit("state", room.applyIntent({ type: action, position: s.position }));
      }, at - Date.now());
    });

    socket.on("load-link", ({ url } = {}) => {
      io.emit("media-status", { status: "loading", by: name });
      load(() => manager.loadLink(String(url || "").trim()));
    });

    socket.on("load-file", ({ path: rel } = {}) => {
      const abs = resolveSafe(mediaDir, rel);
      if (!abs) return socket.emit("media-error", { message: "File not found." });
      io.emit("media-status", { status: "loading", by: name });
      load(() => manager.loadFile(abs, rel));
    });

    socket.on("load-external", ({ title, startAt } = {}) => {
      manager.stop();
      const pos = Math.max(0, Number(startAt) || 0);
      room.setMedia({ id: "ext-" + Date.now(), kind: "external", title: String(title || "Other app").slice(0, 120) });
      io.emit("state", room.applyIntent({ type: "seek", position: pos }));
    });

    socket.on("load-ext", ({ title, site } = {}) => {
      manager.stop();
      const cur = room.media;
      if (cur && cur.kind === "ext" && cur.site === site && cur.title === title) return;
      io.emit("state", room.setMedia({ id: "extn-" + Date.now(), kind: "ext", title: String(title || "").slice(0, 160), site: String(site || "").slice(0, 40), by: name }));
    });

    socket.on("ext-title", ({ title, site } = {}) => {
      socket.broadcast.emit("ext-title", { name, title: String(title || "").slice(0, 160), site: String(site || "").slice(0, 40) });
    });

    socket.on("share-start", () => {
      manager.stop();
      room.setMedia({ id: "share-" + Date.now(), kind: "share", from: socket.id, title: `${name}'s screen` });
      io.emit("state", room.applyIntent({ type: "play", position: 0 }));
    });

    socket.on("share-stop", () => {
      const m = room.media;
      if (m && m.kind === "share" && m.from === socket.id) io.emit("state", room.setMedia(null));
    });

    socket.on("share-want", () => {
      const m = room.media;
      if (m && m.kind === "share") io.to(m.from).emit("share-want", { from: socket.id });
    });

    socket.on("rtc", ({ to, data } = {}) => {
      if (typeof to !== "string") return;
      io.to(to).emit("rtc", { from: socket.id, data });
    });

    socket.on("stop-media", () => {
      manager.stop();
      io.emit("state", room.setMedia(null));
    });

    socket.on("disconnect", () => {
      room.leave(socket.id);
      const m = room.media;
      if (m && m.kind === "share" && m.from === socket.id) io.emit("state", room.setMedia(null));
      io.emit("presence", { online: room.online() });
    });
  });
}

module.exports = { attachSockets, COUNTDOWN_MS };
