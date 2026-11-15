import { syncClock, serverNow } from "./clock.js";
import { createPlayer } from "./player.js";
import { createSync } from "./sync.js";
import { createChat } from "./chat.js";
import { createSources } from "./sources.js";
import { createCountdown } from "./countdown.js";
import { createPanic } from "./panic.js";
import { createShare, canShare } from "./share.js";

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
const share = createShare({ socket, player, onError: (m) => setStatus(m, "error") });

createChat({ socket, me: () => me });
createSources({ socket, onShare: () => share.start() });
createCountdown({ socket });
createPanic({ socket, video });
syncClock(socket);
$("shareBtn").hidden = !canShare();

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
  $("stopBtn").hidden = !m;
  video.hidden = !(videoMode || (kind === "share" && !sharingSelf));
  if (!videoMode) tap.hidden = true;

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

socket.on("media-status", ({ status, message, by }) => {
  if (status === "loading") setStatus(by && by !== me ? `${by} picked something. Loading…` : "Loading…");
  else if (status === "resolving" || status === "starting") setStatus(message);
  else if (status === "ready") setStatus("", "");
});
socket.on("media-error", ({ message }) => setStatus(message, "error", 9000));

tap.addEventListener("click", () => sync.tapToSync());
$("stopShare").addEventListener("click", () => share.stop());
$("stopBtn").addEventListener("click", () => socket.emit("stop-media"));

// Big screen with chat overlay: real fullscreen where supported, CSS theatre on iPhone.
function toggleTheatre() {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (document.body.classList.contains("theatre")) return document.body.classList.remove("theatre");
  if (stage.requestFullscreen && !/iPhone/.test(navigator.userAgent)) {
    stage.requestFullscreen().catch(() => document.body.classList.add("theatre"));
  } else document.body.classList.add("theatre");
}
$("theatreBtn").addEventListener("click", toggleTheatre);
document.addEventListener("keydown", (e) => {
  if (/input|textarea/i.test(document.activeElement?.tagName || "")) return;
  if (e.key === "f" || e.key === "F") toggleTheatre();
  else if (e.key === "Escape" && document.body.classList.contains("theatre")) document.body.classList.remove("theatre");
  else if (e.key === " " && !video.hidden) {
    e.preventDefault();
    video.paused ? video.play().catch(() => {}) : video.pause();
  } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !video.hidden && document.activeElement !== video) {
    video.currentTime = Math.max(0, video.currentTime + (e.key === "ArrowRight" ? 10 : -10));
  }
});

window.__wt = { socket, serverNow, get state() { return room; } };
