const { resolveSafe } = require("./media/library");
const { createHistory } = require("./history");
const { youtubeId, watchUrl, YT_ID } = require("./youtube");

const AUTONEXT_MS = 8000;

const COUNTDOWN_MS = 4000;

function attachSockets(io, { room, manager, mediaDir, auth, chatMedia, youtube }) {
  io.use(auth.socketMiddleware);

  manager.on("status", (s) => io.emit("media-status", s));
  const history = createHistory();

  function historyList() {
    const st = room.stateForJoin();
    return history.list(st.media, st.position);
  }
  function emitHistory() {
    io.emit("history", historyList());
  }

  // Autoplay of YouTube's next suggestion when a video ends (either side can cancel).
  let autoNext = null; // {timer, item, mediaId}
  function cancelAutoNext(silent) {
    if (!autoNext) return;
    clearTimeout(autoNext.timer);
    autoNext = null;
    if (!silent) io.emit("autonext", null);
  }
  function playYouTube(id, by, title) {
    if (!YT_ID.test(id || "")) return;
    const url = watchUrl(id);
    io.emit("media-status", { status: "loading", by, title });
    load(() => manager.loadLink(url), { type: "link", url });
  }

  // Every change of what's playing goes through here, so the item being left lands in history.
  function switchTo(media, source, { position = 0, playing = false } = {}) {
    cancelAutoNext();
    if (media && source && source.type === "link") {
      const yt = youtubeId(source.url);
      if (yt) media.ytId = yt;
    }
    const cur = room.stateForJoin();
    history.record(cur.media, cur.position);
    history.attach(media, source);
    room.setMedia(media);
    const st = media && (position > 0 || playing) ? room.applyIntent({ type: playing ? "play" : "pause", position }) : room.stateForJoin();
    io.emit("state", st);
    emitHistory();
    return st;
  }

  async function load(fn, source, opts) {
    try {
      const media = await fn();
      switchTo(media, source, opts);
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
    socket.emit("history", historyList());
    io.emit("presence", { online: room.online() });

    socket.on("time-sync", (ack) => typeof ack === "function" && ack(Date.now()));

    socket.on("intent", (intent) => {
      if (!intent || !["play", "pause", "seek"].includes(intent.type)) return;
      io.emit("state", room.applyIntent(intent));
    });

    socket.on("chat", (input) => {
      const payload = chatMedia ? chatMedia.messagePayload(input) : input;
      if (!payload) return;
      const msg = room.addChat(name, payload);
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
      const u = String(url || "").trim();
      load(() => manager.loadLink(u), { type: "link", url: u });
    });

    socket.on("load-file", ({ path: rel } = {}) => {
      const abs = resolveSafe(mediaDir, rel);
      if (!abs) return socket.emit("media-error", { message: "File not found." });
      io.emit("media-status", { status: "loading", by: name });
      load(() => manager.loadFile(abs, rel), { type: "file", path: rel });
    });

    socket.on("load-external", ({ title, startAt } = {}) => {
      manager.stop();
      const pos = Math.max(0, Number(startAt) || 0);
      const t = String(title || "Other app").slice(0, 120);
      switchTo({ id: "ext-" + Date.now(), kind: "external", title: t }, { type: "external", title: t }, { position: pos || 0.001 });
    });

    socket.on("load-ext", ({ title, site, position, playing } = {}) => {
      manager.stop();
      const t = String(title || "").slice(0, 160);
      const st = String(site || "").slice(0, 40);
      switchTo({ id: "extn-" + Date.now(), kind: "ext", title: t, site: st, by: name }, { type: "ext", title: t, site: st }, { position: Math.max(0, Number(position) || 0), playing: !!playing });
    });

    socket.on("ext-title", ({ title, site } = {}) => {
      socket.broadcast.emit("ext-title", { name, title: String(title || "").slice(0, 160), site: String(site || "").slice(0, 40) });
    });

    socket.on("share-start", () => {
      manager.stop();
      switchTo({ id: "share-" + Date.now(), kind: "share", from: socket.id, title: `${name}'s screen` }, null, { playing: true });
    });

    socket.on("share-stop", () => {
      const m = room.media;
      if (m && m.kind === "share" && m.from === socket.id) switchTo(null, null);
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
      switchTo(null, null);
    });

    // Pick up something from this session's history where you left off (paused, so either can press play).
    socket.on("resume", ({ key } = {}) => {
      const e = history.get(String(key || ""));
      if (!e) return socket.emit("media-error", { message: "That item isn't in the list any more." });
      const opts = { position: e.position || 0 };
      const src = e.source;
      if (src.type === "link") {
        io.emit("media-status", { status: "loading", by: name });
        load(() => manager.loadLink(src.url), src, opts);
      } else if (src.type === "file") {
        const abs = resolveSafe(mediaDir, src.path);
        if (!abs) return socket.emit("media-error", { message: "That file isn't in the library any more." });
        io.emit("media-status", { status: "loading", by: name });
        load(() => manager.loadFile(abs, src.path), src, opts);
      } else if (src.type === "external") {
        manager.stop();
        switchTo({ id: "ext-" + Date.now(), kind: "external", title: src.title }, src, { position: opts.position || 0.001 });
      } else if (src.type === "ext") {
        manager.stop();
        switchTo({ id: "extn-" + Date.now(), kind: "ext", title: src.title, site: src.site, by: name }, src, { position: opts.position || 0.001 });
      }
    });

    socket.on("load-yt", ({ id, title } = {}) => playYouTube(String(id || ""), name, String(title || "").slice(0, 200)));

    socket.on("ended", async ({ id } = {}) => {
      const m = room.media;
      if (!youtube || !m || m.id !== id || !m.ytId || autoNext) return;
      autoNext = { pending: true, mediaId: m.id };
      let items = [];
      try {
        items = await youtube.upNext(m.ytId, m.title);
      } catch {}
      if (!autoNext || autoNext.mediaId !== m.id || !room.media || room.media.id !== m.id) return;
      const item = items[0];
      if (!item) return (autoNext = null);
      const at = Date.now() + AUTONEXT_MS;
      autoNext = { mediaId: m.id, item, timer: setTimeout(() => {
        autoNext = null;
        playYouTube(item.id, "Up next", item.title);
      }, AUTONEXT_MS) };
      io.emit("autonext", { item, at });
    });
    socket.on("autonext-cancel", () => cancelAutoNext());
    socket.on("autonext-now", () => {
      if (!autoNext || !autoNext.item) return;
      const item = autoNext.item;
      cancelAutoNext();
      playYouTube(item.id, name, item.title);
    });

    socket.on("history-clear", () => {
      history.clear();
      emitHistory();
    });

    socket.on("disconnect", () => {
      room.leave(socket.id);
      const m = room.media;
      if (m && m.kind === "share" && m.from === socket.id) switchTo(null, null);
      io.emit("presence", { online: room.online() });
    });
  });
}

module.exports = { attachSockets, COUNTDOWN_MS };
