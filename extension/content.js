// Sidebar + sync logic. Talks to the background socket over a port and to page.js over postMessage.
(() => {
  if (window.__justUsContent) return;
  window.__justUsContent = true;
  const TAG = "just-us";
  const MATCH = 1.0;
  const DRIFT = 1.5;

  let port = null;
  let offset = 0;
  let room = null;
  let me = "";
  let online = [];
  let status = { connected: false, error: "" };
  let player = null; // {t, paused, title}
  let site = "";
  let applyingUntil = 0;
  let partnerTitle = null;
  let lastTitleSent = "";

  const serverNow = () => Date.now() + offset;

  // ---------- page bridge ----------
  const toPage = (type, data) => window.postMessage({ source: TAG, dir: "toPage", type, data }, "*");
  let reqId = 0;
  const pending = new Map();
  function getPlayer() {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      window.postMessage({ source: TAG, dir: "toPage", type: "get", id }, "*");
      setTimeout(() => pending.delete(id) && resolve(player), 400);
    });
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== TAG || m.dir !== "toContent") return;
    if (m.type === "reply") {
      player = m.data.state;
      site = m.data.site || site;
      const r = pending.get(m.data.id);
      if (r) {
        pending.delete(m.data.id);
        r(player);
      }
    } else if (m.type === "player-ready") {
      site = m.data.site;
      player = m.data.state;
      render();
      apply();
    } else if (m.type === "player-event") {
      player = m.data.state;
      onLocalEvent(m.data.event);
    }
  });

  // ---------- sync ----------
  function synced() {
    return !!(room && room.media && room.media.kind === "ext" && room.media.site === site && player);
  }
  function expected() {
    if (!room) return 0;
    return room.playing ? room.position + Math.max(0, serverNow() - room.updatedAt) / 1000 : room.position;
  }
  function matches(p) {
    return p && p.paused === !room.playing && Math.abs(p.t - expected()) < MATCH;
  }

  async function apply() {
    if (!synced()) return;
    const p = await getPlayer();
    if (!p) return;
    const want = expected();
    if (Math.abs(p.t - want) > DRIFT || (!room.playing && Math.abs(p.t - want) > MATCH)) {
      applyingUntil = Date.now() + 1500;
      toPage("seek", want);
    }
    if (room.playing && p.paused) {
      applyingUntil = Date.now() + 1500;
      toPage("play");
    } else if (!room.playing && !p.paused) {
      applyingUntil = Date.now() + 1500;
      toPage("pause");
    }
  }

  function onLocalEvent(event) {
    if (!synced() || Date.now() < applyingUntil || !player || matches(player)) return;
    const type = event === "seeked" ? "seek" : event;
    send("intent", { type, position: player.t });
  }

  setInterval(async () => {
    if (!synced()) return;
    const p = await getPlayer();
    if (!p) return;
    if (p.title && p.title !== lastTitleSent) {
      lastTitleSent = p.title;
      send("ext-title", { title: p.title, site });
      render();
    }
    if (Date.now() >= applyingUntil && !matches(p)) apply();
  }, 2000);

  // ---------- port ----------
  function send(event, data) {
    try {
      port && port.postMessage({ event, data });
    } catch {}
  }
  function connect() {
    port = chrome.runtime.connect({ name: "just-us" });
    port.onMessage.addListener((m) => {
      if (m.type === "status") {
        status = m;
        me = m.me || me;
      } else if (m.type === "offset") offset = m.offset;
      else if (m.type === "state") {
        room = m.state;
        apply();
      } else if (m.type === "chat-history") renderChat(m.msgs, true);
      else if (m.type === "chat") renderChat([m.msg]);
      else if (m.type === "presence") online = m.online;
      else if (m.type === "countdown") countdown(m.data);
      else if (m.type === "ext-title") {
        partnerTitle = m.data;
      } else if (m.type === "typing") showTyping(m.data.name);
      else if (m.type === "panic") toPage("pause");
      else if (m.type === "media") {
        const w = mediaWaiters.get(m.reqId);
        mediaWaiters.delete(m.reqId);
        if (w) w(m.dataUrl);
        return;
      }
      render();
    });
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  }

  // ---------- UI ----------
  const hostEl = document.createElement("div");
  hostEl.id = "just-us-host";
  const shadow = hostEl.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
      .panel { position: fixed; top: 16px; right: 16px; bottom: 16px; width: 300px; z-index: 2147483646;
        background: rgba(26,18,32,.94); color: #f4ebf2; border: 1px solid #3d2f49; border-radius: 18px;
        display: flex; flex-direction: column; overflow: hidden; backdrop-filter: blur(10px); font-size: 14px; }
      .panel.min { bottom: auto; width: auto; }
      .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
      .title { font: 600 16px/1 ui-rounded, system-ui, sans-serif; }
      .dots { display: flex; gap: 4px; flex: 1; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #3d2f49; }
      .dot.on { background: #f2a65a; } .dot.on + .dot.on { background: #b58ad8; }
      button { font: inherit; color: inherit; cursor: pointer; }
      .icon { border: 0; background: transparent; color: #ab9bb3; font-size: 16px; padding: 2px 6px; }
      .body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .min .body { display: none; }
      .info { padding: 0 12px 10px; color: #ab9bb3; font-size: 13px; }
      .info strong { color: #f4ebf2; font-weight: 600; }
      .warn { color: #ffcf99; }
      .err { color: #ff9a9a; }
      .row { display: flex; gap: 6px; padding: 0 12px 10px; flex-wrap: wrap; }
      .btn { border: 0; border-radius: 999px; padding: 8px 12px; background: #f2a65a; color: #2a1708; font-weight: 600; }
      .btn.ghost { background: #2f2339; color: #f4ebf2; }
      .msgs { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #3d2f49; }
      .m { max-width: 85%; padding: 6px 10px; border-radius: 16px; white-space: pre-wrap; word-wrap: break-word; }
      .m.me { align-self: flex-end; background: #f2a65a; color: #2a1708; border-bottom-right-radius: 5px; }
      .m.them { align-self: flex-start; background: #5d3f79; border-bottom-left-radius: 5px; }
      .m.media { padding: 3px; background: transparent !important; max-width: 70%; }
      .m.media img { display: block; width: 100%; height: auto; max-height: 200px; object-fit: cover; border-radius: 12px; background: #2f2339; }
      .typing { font-size: 12px; color: #ab9bb3; padding: 0 12px; min-height: 16px; }
      form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #3d2f49; }
      input { flex: 1; min-width: 0; background: #1a1220; border: 1px solid #3d2f49; border-radius: 999px; padding: 8px 12px; color: #f4ebf2; font-size: 14px; outline: none; }
      input:focus { border-color: #f2a65a; }
      .cd { position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center;
        background: rgba(10,6,14,.7); color: #f2a65a; font: 700 200px/1 ui-rounded, system-ui, sans-serif; pointer-events: none; }
      .cd.word { font-size: 96px; }
    </style>
    <div class="panel" id="panel">
      <div class="head">
        <span class="title">Just us</span><span class="dots" id="dots"></span>
        <button class="icon" id="min" title="Minimise">–</button>
      </div>
      <div class="body">
        <div class="info" id="info"></div>
        <div class="row" id="actions"></div>
        <div class="msgs" id="msgs"></div>
        <div class="typing" id="typing"></div>
        <form id="form" autocomplete="off"><input id="input" placeholder="Message" /><button class="btn">Send</button></form>
      </div>
    </div>
    <div class="cd" id="cd"></div>`;
  const $ = (id) => shadow.getElementById(id);

  // Keep site keyboard shortcuts (space, f, arrows) from firing while typing in chat.
  for (const ev of ["keydown", "keyup", "keypress"]) $("panel").addEventListener(ev, (e) => e.stopPropagation(), true);

  $("min").addEventListener("click", () => {
    const min = $("panel").classList.toggle("min");
    $("min").textContent = min ? "+" : "–";
  });
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("input").value.trim();
    if (!t) return;
    send("chat", t);
    $("input").value = "";
  });
  let lastTyping = 0;
  $("input").addEventListener("input", () => {
    if (Date.now() - lastTyping > 1500) {
      lastTyping = Date.now();
      send("typing");
    }
  });
  $("actions").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "sync") {
      const p = await getPlayer();
      // Start the room from where this tab is.
      send("load-ext", { title: (p && p.title) || document.title, site, position: p ? p.t : 0, playing: p ? !p.paused : false });
    } else if (act === "play" || act === "pause") send("countdown", { action: act });
  });

  let typingTimer;
  function showTyping(name) {
    $("typing").textContent = `${name} is typing…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => ($("typing").textContent = ""), 3000);
  }

  const mediaWaiters = new Map();
  let mediaReq = 0;
  function renderChat(msgs, replace = false) {
    const box = $("msgs");
    if (replace) box.innerHTML = "";
    for (const m of msgs) {
      const d = document.createElement("div");
      const media = m.kind === "image" || m.kind === "gif";
      d.className = `m ${m.name === me ? "me" : "them"} ${media ? "media" : ""}`;
      if (media) {
        const img = document.createElement("img");
        img.alt = m.kind === "gif" ? "GIF" : "Photo";
        if (m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
        const id = ++mediaReq;
        mediaWaiters.set(id, (url) => {
          if (url) img.src = url;
          else d.textContent = m.kind === "gif" ? "[GIF]" : "[Photo]";
          box.scrollTop = box.scrollHeight;
        });
        send("fetch-media", { src: m.src, reqId: id });
        d.appendChild(img);
      } else d.textContent = m.text;
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  }

  const SITE_NAMES = { netflix: "Netflix", hotstar: "Hotstar", prime: "Prime Video", jiocinema: "JioCinema", sonyliv: "SonyLIV", zee5: "ZEE5", youtube: "YouTube" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function render() {
    $("dots").innerHTML = [0, 1].map((i) => `<span class="dot ${online[i] ? "on" : ""}"></span>`).join("");
    const info = $("info");
    const actions = $("actions");
    if (!status.connected) {
      info.innerHTML = `<span class="err">${esc(status.error || "Connecting…")}</span>`;
      actions.innerHTML = "";
      return;
    }
    if (!player) {
      info.textContent = "Start playing something and it will show up here.";
      actions.innerHTML = "";
      return;
    }
    const other = online.find((n) => n !== me);
    if (synced()) {
      let html = `<strong>In sync</strong> on ${SITE_NAMES[site] || site}. Play, pause or skip and ${other ? esc(other) : "the other side"} follows.`;
      if (partnerTitle && player.title && partnerTitle.title !== player.title) html += `<br><span class="warn">${esc(partnerTitle.name)} is on: ${esc(partnerTitle.title)}</span>`;
      info.innerHTML = html;
      actions.innerHTML = `<button class="btn ghost" data-act="play" title="3-2-1 countdown for someone on a phone">Play together</button><button class="btn ghost" data-act="pause">Pause together</button>`;
    } else {
      const busy = room && room.media && room.media.kind !== "ext";
      info.innerHTML = busy ? "The room is playing something else. Sync this tab to switch to it." : `Open the same title on ${other ? esc(other) + "'s" : "the other"} side, then sync.`;
      actions.innerHTML = `<button class="btn" data-act="sync">Sync this tab</button>`;
    }
  }

  let cdTimer;
  function countdown({ action, at }) {
    const cd = $("cd");
    clearInterval(cdTimer);
    const show = (t, word) => {
      cd.style.display = "flex";
      cd.textContent = t;
      cd.classList.toggle("word", !!word);
    };
    if (action === "pause") {
      show("Pause", true);
      return setTimeout(() => (cd.style.display = "none"), 1200);
    }
    cdTimer = setInterval(() => {
      const left = at - serverNow();
      if (left <= 0) {
        clearInterval(cdTimer);
        show("Play", true);
        setTimeout(() => (cd.style.display = "none"), 1000);
      } else if (left <= 3000) show(String(Math.ceil(left / 1000)));
      else show("Get ready", true);
    }, 50);
  }

  // Follow the player into fullscreen so chat stays visible.
  document.addEventListener("fullscreenchange", () => {
    const target = document.fullscreenElement || document.documentElement;
    if (hostEl.parentNode !== target) target.appendChild(hostEl);
  });

  document.documentElement.appendChild(hostEl);
  connect();
  render();
  setInterval(render, 3000);
})();
