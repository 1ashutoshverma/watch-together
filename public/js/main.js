import { syncClock, serverNow } from "./clock.js";
import { createPlayer } from "./player.js";
import { createSync } from "./sync.js";
import { createChat } from "./chat.js";
import { createSources } from "./sources.js";
import { createCountdown } from "./countdown.js";
import { createPanic } from "./panic.js";
import { createShare, canShare } from "./share.js";
import { trackViewport } from "./viewport.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const stage = $("stage");
const statusEl = $("status");
const tap = $("tap");

let me = "";
let socketId = "";
let room = null;
let statusTimer = null;

const socket = io({ transports: ["websocket", "polling"] });
const player = createPlayer(video);
const sync = createSync({ video, socket, onNeedTap: (show) => (tap.hidden = !show) });
const share = createShare({ socket, player, onError: (m) => setStatus(m, "error"), onBlocked: () => (tap.hidden = false) });

trackViewport();
const chat = createChat({ socket, me: () => me });
createCountdown({ socket });
createPanic({ socket, video });
syncClock(socket);

const isWide = () => window.matchMedia("(min-width: 901px)").matches;
let watchHistory = [];
socket.on("history", (items) => {
  watchHistory = items || [];
  renderContinue();
});
// Start screen: offer to continue the last thing watched tonight.
function renderContinue() {
  const btn = $("continueBtn");
  const last = watchHistory.find((i) => !i.current);
  btn.hidden = !last;
  if (!last) return;
  btn.innerHTML = `<small>Continue watching</small><strong></strong><small class="c-meta"></small>`;
  btn.querySelector("strong").textContent = last.title;
  const more = watchHistory.filter((i) => !i.current).length - 1;
  btn.querySelector(".c-meta").textContent = [last.position > 1 ? `Stopped at ${fmtTime(last.position)}` : "", more > 0 ? `${more} more in Menu → Watched tonight` : ""].filter(Boolean).join(" · ");
  btn.onclick = () => socket.emit("resume", { key: last.key });
}
const sources = createSources({
  socket,
  history: { items: () => watchHistory, currentPosition: () => sync.expectedPosition() },
  current: () => (room && room.media) || null,
  onShare: () => share.start(),
  canShare,
  actions: {
    status: () => ({
      full: document.body.classList.contains("full"),
      appFull: !!document.fullscreenElement && !document.body.classList.contains("full"),
      appFullMode: standalone ? "installed" : isIPhone || !document.documentElement.requestFullscreen ? "install" : "api",
      wide: isWide(),
      chatHidden: $("page").classList.contains("chat-hidden"),
      hasMedia: !!(room && room.media),
      ytNow: !!(room && room.media && room.media.ytId),
    }),
    run(action) {
      if (action === "full") toggleFull();
      else if (action === "appfull") toggleAppFull();
      else if (action === "chat") chat.toggleHidden();
      else if (action === "stop") socket.emit("stop-media");
      else if (action === "panic") socket.emit("panic");
      else if (action === "out") fetch("/api/logout", { method: "POST" }).finally(() => location.replace("/login.html"));
    },
  },
});

function setStatus(text, kind = "", ms = 0) {
  clearTimeout(statusTimer);
  if (!text) return (statusEl.hidden = true);
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  if (ms) statusTimer = setTimeout(() => (statusEl.hidden = true), ms);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function siteName(site) {
  return { netflix: "Netflix", hotstar: "Hotstar", prime: "Prime Video", jiocinema: "JioCinema" }[site] || site || "another app";
}

function renderSeats(online) {
  const others = online.filter((n) => n !== me);
  const seats = [`<span class="seat on">${escapeHtml(me)}</span>`];
  seats.push(others.length ? `<span class="seat her on">${escapeHtml(others[0])}</span>` : `<span class="seat her">Waiting…</span>`);
  $("seats").innerHTML = seats.join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let extTicker = null;
function render(state) {
  room = state;
  const m = state.media;
  const kind = m ? m.kind : null;
  const videoMode = kind === "hls" || kind === "file";
  const external = kind === "external" || kind === "ext";
  const sharingSelf = kind === "share" && m.from === socketId;

  $("empty").hidden = !!m;
  $("extCard").hidden = !external;
  $("shareCard").hidden = !sharingSelf;
  video.hidden = !(videoMode || (kind === "share" && !sharingSelf));
  if (!videoMode) tap.hidden = true;
  document.body.classList.toggle("video-on", !video.hidden);
  $("upNextBtn").hidden = !(m && m.ytId);
  if (!m || m.id !== autoNextFor) hideAutoNext();

  if (videoMode) {
    share.leaveView();
    player.setSource(m);
  } else if (kind === "share" && !sharingSelf) {
    share.view(m);
  } else {
    share.leaveView();
    if (player.id) player.reset();
  }
  if (kind !== "share" && share.isSharing()) share.stop();

  sync.setState(state, { videoMode });

  clearInterval(extTicker);
  if (external) {
    $("extTitle").textContent = m.title || "Watching together";
    $("extHint").textContent =
      kind === "ext"
        ? `${m.by === me ? "You're" : `${m.by} is`} watching on ${siteName(m.site)} with the Chrome extension, so laptops stay in sync on their own. On a phone, open the same title, match the time below, and use "Play together".`
        : "Open this in your own app and pause at the time below. Then either of you taps Play together.";
    const tick = () => ($("extTime").textContent = fmtTime(sync.expectedPosition()));
    tick();
    extTicker = setInterval(tick, 500);
  }
}

socket.on("connect", () => {
  share.leaveView();
  socketId = socket.id;
});
socket.on("hello", ({ name }) => {
  me = name;
  document.title = "Just us";
});
socket.on("state", render);
socket.on("presence", ({ online }) => renderSeats(online));
socket.on("room-full", () => {
  document.body.innerHTML = `<main class="login"><form><h1>Room is full</h1><p>Two people are already in. If one of them is you on another device, sign in with the same name.</p><a class="btn" href="/login.html" style="display:block;text-align:center;text-decoration:none">Sign in again</a></form></main>`;
});
socket.on("connect_error", (e) => {
  if (e.message === "unauthorized") location.replace("/login.html");
  else setStatus("Reconnecting to the Mac…");
});
socket.io.on("reconnect", () => setStatus("Back online", "", 1500));
socket.on("disconnect", () => setStatus("Reconnecting to the Mac…"));

socket.on("media-status", ({ status, message, by, title }) => {
  if (status === "loading") setStatus(title ? `${by && by !== me ? by + " picked" : "Loading"} “${title.length > 50 ? title.slice(0, 50) + "…" : title}”${by && by !== me ? ". Loading…" : "…"}` : by && by !== me ? `${by} picked something. Loading…` : "Loading…");
  else if (status === "resolving" || status === "starting") setStatus(message);
  else if (status === "ready") setStatus("", "");
});
socket.on("media-error", ({ message }) => setStatus(message, "error", 9000));

// ---------- YouTube: Up next + autoplay when a video ends ----------
$("upNextBtn").addEventListener("click", () => sources.youtube(true));
video.addEventListener("ended", () => {
  if (room && room.media && room.media.ytId) socket.emit("ended", { id: room.media.id });
});
let autoNextFor = null;
let autoNextTimer = null;
function hideAutoNext() {
  clearInterval(autoNextTimer);
  $("autoNext").hidden = true;
  autoNextFor = null;
}
socket.on("autonext", (data) => {
  if (!data) return hideAutoNext();
  autoNextFor = room && room.media ? room.media.id : null;
  const box = $("autoNext");
  box.querySelector("img").src = data.item.thumb;
  box.querySelector(".an-title").textContent = data.item.title;
  box.hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.ceil((data.at - serverNow()) / 1000));
    box.querySelector(".an-count").textContent = left ? `Playing in ${left}` : "Starting…";
  };
  tick();
  clearInterval(autoNextTimer);
  autoNextTimer = setInterval(tick, 250);
});
$("anNow").addEventListener("click", () => socket.emit("autonext-now"));
$("anCancel").addEventListener("click", () => socket.emit("autonext-cancel"));

tap.addEventListener("click", () => {
  tap.hidden = true;
  if (video.srcObject) video.play().catch(() => {});
  else sync.tapToSync();
});
$("stopShare").addEventListener("click", () => share.stop());

// Two kinds of full screen:
//  - video full screen (body.full): picture fills the screen, chat floats on it.
//  - app full screen: browser bars hidden, normal layout (video + chat) with more room.
// iPhone Safari can't hide its bars from a web page; there, app full screen = "Add to Home Screen".
const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || navigator.standalone === true;
let fsReason = null; // why the browser is in real fullscreen: "video" | "app"

function enterBrowserFullscreen(reason) {
  const el = document.documentElement;
  if (!el.requestFullscreen || isIPhone) return false;
  fsReason = reason;
  el.requestFullscreen({ navigationUI: "hide" }).catch(() => (fsReason = null));
  return true;
}
function exitBrowserFullscreen() {
  fsReason = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function toggleFull() {
  if (document.body.classList.contains("full")) {
    document.body.classList.remove("full");
    if (fsReason === "video") exitBrowserFullscreen();
    return;
  }
  document.body.classList.add("full");
  if (!document.fullscreenElement) enterBrowserFullscreen("video");
}

function toggleAppFull() {
  if (document.fullscreenElement) {
    document.body.classList.remove("full");
    return exitBrowserFullscreen();
  }
  if (!enterBrowserFullscreen("app")) return "unsupported";
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    fsReason = null;
    document.body.classList.remove("full");
  }
});
$("fullBtn").addEventListener("click", toggleFull);

document.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(document.activeElement?.tagName || "")) return;
  if (!$("sheet").hidden) return;
  if (e.key === "f" || e.key === "F") toggleFull();
  else if (e.key === "Escape" && document.body.classList.contains("full")) toggleFull();
  else if (e.key === " " && !video.hidden) {
    e.preventDefault();
    video.paused ? video.play().catch(() => {}) : video.pause();
  } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !video.hidden && document.activeElement !== video) {
    video.currentTime = Math.max(0, video.currentTime + (e.key === "ArrowRight" ? 10 : -10));
  }
});

window.__wt = { socket, serverNow, get state() { return room; } };
