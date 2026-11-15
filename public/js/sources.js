// Sheets for choosing what to watch: paste link, library, other apps.
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + " GB";
  return Math.max(1, Math.round(b / 1e6)) + " MB";
}

export function parseTime(str) {
  const parts = String(str || "").trim().split(":").map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const ICONS = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  library: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>',
  other: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  share: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 14V8M9 10.5 12 8l3 2.5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  app: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 7h16M9 3v0"/><path d="M12 11v6M9 14l3 3 3-3"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  panic: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12a14 14 0 0 1-3 3.6M6.6 6.6A14 14 0 0 0 2 12s4 7 10 7a9 9 0 0 0 4.4-1.2"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

export function createSources({ socket, onShare, canShare, actions }) {
  const root = document.getElementById("sheet");

  function close() {
    root.hidden = true;
    root.innerHTML = "";
  }
  root.addEventListener("click", (e) => e.target === root && close());
  document.addEventListener("keydown", (e) => e.key === "Escape" && !root.hidden && close());

  function show(node) {
    root.innerHTML = "";
    root.appendChild(node);
    root.hidden = false;
    const first = node.querySelector("input");
    if (first) setTimeout(() => first.focus(), 30);
    node.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  }

  function linkSheet() {
    const node = el(`
      <form class="sheet" autocomplete="off">
        <h3>Paste a link</h3>
        <p class="hint">Works with YouTube and most video sites. It plays here without the site's ads. Netflix, Hotstar and other paid apps can't play here, so use "Netflix &amp; other apps" for those.</p>
        <label class="field">Video page link<input name="url" type="url" inputmode="url" placeholder="https://…" required /></label>
        <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Play for both</button></div>
      </form>`);
    node.addEventListener("submit", (e) => {
      e.preventDefault();
      socket.emit("load-link", { url: node.elements.url.value.trim() });
      close();
    });
    show(node);
  }

  async function librarySheet() {
    const node = el(`
      <div class="sheet">
        <h3>Library</h3>
        <p class="hint">Movies from the Mac's folder.</p>
        <label class="field"><input type="search" placeholder="Search" aria-label="Search library" /></label>
        <ul class="lib-list"><li class="hint">Loading…</li></ul>
        <div class="actions"><button class="btn ghost" data-close>Close</button></div>
      </div>`);
    show(node);
    const ul = node.querySelector("ul");
    let items = [];
    try {
      const r = await fetch("/api/library");
      const j = await r.json();
      items = j.items;
      node.querySelector(".hint").textContent = `Movies in the "${j.dir}" folder on the Mac.`;
    } catch {
      ul.innerHTML = `<li class="hint">Couldn't read the library.</li>`;
      return;
    }
    function render(q = "") {
      const f = items.filter((i) => i.path.toLowerCase().includes(q.toLowerCase()));
      ul.innerHTML = f.length
        ? f.map((i, n) => `<li><button data-i="${items.indexOf(i)}"><span>${esc(i.path)}</span><small>${fmtSize(i.size)}</small></button></li>`).join("")
        : `<li class="hint">${items.length ? "No match." : "No videos found. Put movies in the folder set as MEDIA_DIR in .env."}</li>`;
    }
    render();
    node.querySelector("input").addEventListener("input", (e) => render(e.target.value));
    ul.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      socket.emit("load-file", { path: items[Number(b.dataset.i)].path });
      close();
    });
  }

  function otherSheet() {
    const node = el(`
      <form class="sheet" autocomplete="off">
        <h3>Netflix, Hotstar and other apps</h3>
        <p class="hint">Each of you plays it in your own app or account. On laptops, the Chrome extension keeps both players in sync on its own. On phones, open the same title, pause at the start time, then use "Play together" for a 3-2-1 countdown.</p>
        <label class="field">What are you watching?<input name="title" placeholder="e.g. Panchayat S3 E4" maxlength="120" required /></label>
        <label class="field">Start from (h:mm:ss)<input name="start" placeholder="0:00" inputmode="numeric" /></label>
        <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Set it up</button></div>
      </form>`);
    node.addEventListener("submit", (e) => {
      e.preventDefault();
      socket.emit("load-external", { title: node.elements.title.value.trim(), startAt: parseTime(node.elements.start.value) });
      close();
    });
    show(node);
  }

  function installSheet() {
    const node = el(`
      <div class="sheet">
        <h3>Hide the browser bars</h3>
        <p class="hint">Safari on iPhone doesn't let websites hide its bars. Add this page to your Home Screen instead, and it opens like an app, with no browser around it.</p>
        <ol class="steps">
          <li>Tap the <strong>Share</strong> button in Safari (square with an arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>Just us</strong> from your Home Screen. If it asks, sign in once more.</li>
        </ol>
        <p class="hint">The link changes each time the Mac starts, so add it again when it does.</p>
        <div class="actions"><button class="btn" data-close>Got it</button></div>
      </div>`);
    show(node);
  }

  function menuSheet() {
    const s = actions.status();
    const item = (act, ic, label, extra = "", cls = "") => `<button class="menu-item ${cls}" data-act="${act}">${icon(ic)}<span>${label}</span>${extra}</button>`;
    const node = el(`
      <div class="sheet menu" role="menu">
        <div class="menu-group">
          ${item("link", "link", "Paste a link")}
          ${item("library", "library", "Library")}
          ${item("other", "other", "Netflix, Hotstar &amp; other apps")}
          ${canShare() ? item("share", "share", "Share a tab") : ""}
        </div>
        <div class="menu-group">
          ${item("full", "full", s.full ? "Exit video full screen" : "Video full screen", '<small class="kbd">F</small>')}
          ${s.appFullMode === "installed" ? "" : s.appFullMode === "install" ? item("install", "app", "Hide browser bars") : item("appfull", "app", s.appFull ? "Show browser bars" : "Hide browser bars")}
          ${s.wide ? item("chat", "chat", s.chatHidden ? "Show chat" : "Hide chat") : ""}
          ${s.hasMedia ? item("stop", "stop", "Stop video for both") : ""}
          ${item("panic", "panic", "Panic: blank both screens", '<small class="kbd">P</small>', "danger")}
          ${item("out", "out", "Sign out")}
        </div>
      </div>`);
    node.querySelectorAll(".kbd").forEach((k) => s.wide || k.remove());
    node.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      close();
      if (a === "link") linkSheet();
      else if (a === "library") librarySheet();
      else if (a === "other") otherSheet();
      else if (a === "share") onShare();
      else if (a === "install") installSheet();
      else actions.run(a);
    });
    show(node);
    node.querySelector("button")?.focus();
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-menu]")) return menuSheet();
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const k = b.dataset.open;
    if (k === "link") linkSheet();
    else if (k === "library") librarySheet();
    else if (k === "other") otherSheet();
  });

  return { close, menu: menuSheet };
}
