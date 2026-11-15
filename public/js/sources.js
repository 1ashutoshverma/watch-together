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

export function createSources({ socket, onShare }) {
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

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const k = b.dataset.open;
    if (k === "link") linkSheet();
    else if (k === "library") librarySheet();
    else if (k === "other") otherSheet();
    else if (k === "share") onShare();
  });

  return { close };
}
