// Holds the socket to the Just us server (extension origin, so site CSPs don't apply) and relays to tabs.
importScripts("socket.io.min.js");

let socket = null;
let offset = 0;
let last = { state: null, chat: [], online: [], me: "", connected: false, error: "" };
const ports = new Set();

function broadcast(msg) {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {}
  }
}

function syncClock() {
  const samples = [];
  let n = 0;
  const once = () => {
    const t0 = Date.now();
    socket.timeout(3000).emit("time-sync", (err, server) => {
      if (!err) {
        const t1 = Date.now();
        samples.push({ rtt: t1 - t0, off: server - (t0 + t1) / 2 });
      }
      if (++n < 5) once();
      else if (samples.length) {
        samples.sort((a, b) => a.rtt - b.rtt);
        offset = samples[0].off;
        broadcast({ type: "offset", offset });
      }
    });
  };
  once();
}

async function connect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  const { server, token } = await chrome.storage.local.get(["server", "token"]);
  last = { ...last, connected: false, error: server && token ? "" : "Open the extension popup and sign in." };
  broadcast({ type: "status", ...last });
  if (!server || !token) return;

  socket = io(server, { transports: ["websocket"], auth: { token }, query: { token }, reconnectionDelayMax: 5000 });
  socket.on("connect", () => {
    last.connected = true;
    last.error = "";
    broadcast({ type: "status", ...last });
    syncClock();
  });
  socket.on("disconnect", () => {
    last.connected = false;
    broadcast({ type: "status", ...last });
  });
  socket.on("connect_error", (e) => {
    last.connected = false;
    last.error = e.message === "unauthorized" ? "Session expired. Sign in again from the popup." : "Can't reach the Mac. Is the server running and the link current?";
    broadcast({ type: "status", ...last });
  });
  socket.on("hello", ({ name }) => (last.me = name));
  socket.on("room-full", () => {
    last.error = "Room is full.";
    broadcast({ type: "status", ...last });
  });
  socket.on("state", (s) => {
    last.state = s;
    broadcast({ type: "state", state: s });
  });
  socket.on("chat-history", (msgs) => {
    last.chat = msgs;
    broadcast({ type: "chat-history", msgs });
  });
  socket.on("chat", (m) => {
    last.chat = [...last.chat, m].slice(-200);
    broadcast({ type: "chat", msg: m });
  });
  socket.on("presence", ({ online }) => {
    last.online = online;
    broadcast({ type: "presence", online });
  });
  for (const ev of ["countdown", "typing", "ext-title", "panic"]) socket.on(ev, (data) => broadcast({ type: ev, data }));
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "just-us") return;
  ports.add(port);
  port.postMessage({ type: "status", ...last });
  port.postMessage({ type: "offset", offset });
  if (last.state) port.postMessage({ type: "state", state: last.state });
  port.postMessage({ type: "chat-history", msgs: last.chat });
  port.postMessage({ type: "presence", online: last.online });
  if (!socket) connect();
  port.onMessage.addListener(async (msg) => {
    if (msg && msg.event === "fetch-media") return fetchMedia(port, msg.data);
    if (!socket || !msg || !msg.event) return;
    const allowed = ["intent", "chat", "typing", "load-ext", "ext-title", "countdown", "panic"];
    if (allowed.includes(msg.event)) socket.emit(msg.event, msg.data);
  });
  port.onDisconnect.addListener(() => ports.delete(port));
});

// Chat photos/GIFs need the room login; fetch them here and hand the tab a data: URL.
const mediaCache = new Map();
async function fetchMedia(port, { src, reqId } = {}) {
  if (typeof src !== "string" || !/^\/(chat-media|gif)\/[A-Za-z0-9]+$/.test(src)) return;
  try {
    if (!mediaCache.has(src)) {
      const { server, token } = await chrome.storage.local.get(["server", "token"]);
      const r = await fetch(server + src, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error(String(r.status));
      const type = r.headers.get("content-type") || "image/gif";
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      mediaCache.set(src, `data:${type};base64,${btoa(bin)}`);
      if (mediaCache.size > 40) mediaCache.delete(mediaCache.keys().next().value);
    }
    port.postMessage({ type: "media", reqId, dataUrl: mediaCache.get(src) });
  } catch {
    port.postMessage({ type: "media", reqId, dataUrl: null });
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.token || changes.server) connect();
});

// Keep the service worker alive while a synced tab is open.
setInterval(() => {
  if (ports.size && socket && socket.connected) socket.emit("time-sync", () => {});
}, 20000);
