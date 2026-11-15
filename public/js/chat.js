// Chat panel, floating overlay (full screen / landscape), emoji + GIF/photo picker, auto-scroll.
import { EMOJI, recentEmoji, rememberEmoji, isJumbo } from "./emoji.js";

export function createChat({ socket, me }) {
  const $ = (id) => document.getElementById(id);
  const list = $("messages");
  const empty = $("msgEmpty");
  const typingEl = $("typing");
  const overlay = $("overlayMsgs");
  const page = $("page");
  const pill = $("newPill");
  const picker = $("picker");
  const input = $("msg");
  const overlayInput = $("overlayInput");
  const history = [];
  let typingTimer = null;
  let lastTypingSent = 0;

  // ---------- auto-scroll ----------
  // Stay pinned to the newest message unless the person has scrolled well up to read.
  let pinned = true;
  const distanceFromBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight;
  function toBottom(smooth = false) {
    list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinned = true;
    pill.hidden = true;
  }
  list.addEventListener("scroll", () => {
    pinned = distanceFromBottom() < 60;
    if (pinned) pill.hidden = true;
  });
  pill.addEventListener("click", () => toBottom(true));
  // Keyboard opening, picker opening, images loading: all resize things; keep the newest in view.
  new ResizeObserver(() => pinned && toBottom()).observe(list);

  // ---------- rendering ----------
  function content(m, small) {
    if (m.kind === "image" || m.kind === "gif") {
      const img = document.createElement("img");
      img.src = m.src;
      img.alt = m.kind === "gif" ? "GIF" : "Photo";
      img.loading = "lazy";
      img.decoding = "async";
      if (m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
      img.addEventListener("load", () => pinned && toBottom());
      if (!small) img.addEventListener("click", () => openViewer(m));
      return img;
    }
    return document.createTextNode(m.text);
  }

  function bubble(m, cls = "", small = false) {
    const div = document.createElement("div");
    const media = m.kind === "image" || m.kind === "gif";
    const jumbo = !media && isJumbo(m.text);
    div.className = `msg ${m.name === me() ? "me" : "them"} ${media ? "media" : ""} ${jumbo ? "jumbo" : ""} ${cls}`;
    div.appendChild(content(m, small));
    div.title = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return div;
  }

  function add(m, { live = true } = {}) {
    empty.hidden = true;
    history.push(m);
    if (history.length > 50) history.shift();
    const mine = m.name === me();
    // Follow new messages when they arrive or are sent; only hold position if reading far up.
    const follow = mine || pinned || distanceFromBottom() < list.clientHeight * 1.5;
    list.appendChild(bubble(m));
    if (follow) toBottom();
    else if (live) pill.hidden = false;
    if (!live) return;
    const recall = overlay.classList.contains("recall");
    const o = bubble(m, recall ? "keep" : "", true);
    overlay.appendChild(o);
    while (overlay.children.length > (recall ? 6 : 4)) overlay.firstChild.remove();
    if (!recall) setTimeout(() => o.remove(), 9500);
    if (!mine) typingEl.textContent = "";
  }

  function openViewer(m) {
    const sheet = $("sheet");
    sheet.innerHTML = "";
    const img = document.createElement("img");
    img.src = m.src;
    img.alt = "";
    img.className = "viewer";
    sheet.appendChild(img);
    sheet.hidden = false;
    sheet.onclick = () => {
      sheet.hidden = true;
      sheet.innerHTML = "";
      sheet.onclick = null;
    };
  }

  // ---------- sending ----------
  function sendText(el) {
    const text = el.value.trim();
    if (!text) return;
    socket.emit("chat", text);
    el.value = "";
    toBottom();
  }
  function wire(form, el) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendText(el);
    });
    el.addEventListener("input", () => {
      const t = Date.now();
      if (t - lastTypingSent > 1500) {
        lastTypingSent = t;
        socket.emit("typing");
      }
    });
  }
  wire($("compose"), input);
  wire($("overlayForm"), overlayInput);

  overlayInput.addEventListener("focus", () => {
    overlay.innerHTML = "";
    history.slice(-6).forEach((m) => overlay.appendChild(bubble(m, "keep", true)));
    overlay.classList.add("recall");
  });
  overlayInput.addEventListener("blur", () => {
    overlay.classList.remove("recall");
    overlay.querySelectorAll(".keep").forEach((n) => n.remove());
  });

  // ---------- picker (emoji / GIFs) ----------
  let mode = null; // "emoji" | "gif" | null
  let gifSearchOn = null; // unknown until first open
  let gifTimer = null;

  function closePicker() {
    mode = null;
    picker.hidden = true;
    picker.innerHTML = "";
    $("emojiBtn").classList.remove("on");
    $("gifBtn").classList.remove("on");
  }
  function openPicker(next) {
    if (mode === next) {
      closePicker();
      input.focus();
      return;
    }
    mode = next;
    // The picker takes the keyboard's place: close the keyboard so the video stays in view.
    if (matchMedia("(pointer: coarse)").matches) input.blur();
    picker.hidden = false;
    $("emojiBtn").classList.toggle("on", next === "emoji");
    $("gifBtn").classList.toggle("on", next === "gif");
    next === "emoji" ? renderEmoji() : renderGifs();
  }
  $("emojiBtn").addEventListener("click", () => openPicker("emoji"));
  $("gifBtn").addEventListener("click", () => openPicker("gif"));
  input.addEventListener("focus", () => matchMedia("(pointer: coarse)").matches && mode && closePicker());

  function renderEmoji(tab = recentEmoji().length ? "recent" : "smileys") {
    const tabs = [{ key: "recent", label: "🕘", name: "Recent", items: recentEmoji() }, ...EMOJI].filter((t) => t.key !== "recent" || t.items.length);
    const cur = tabs.find((t) => t.key === tab) || tabs[0];
    picker.innerHTML = `
      <div class="p-tabs" role="tablist">${tabs.map((t) => `<button type="button" role="tab" class="p-tab ${t.key === cur.key ? "on" : ""}" data-tab="${t.key}" title="${t.name}" aria-label="${t.name}">${t.label}</button>`).join("")}</div>
      <div class="p-grid emoji-grid">${cur.items.map((e) => `<button type="button" class="e" data-e="${e}">${e}</button>`).join("")}</div>`;
    picker.querySelector(".p-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) renderEmoji(b.dataset.tab);
    });
    picker.querySelector(".p-grid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-e]");
      if (!b) return;
      const em = b.dataset.e;
      rememberEmoji(em);
      // Insert at the cursor so you can mix emoji and text; tap Send when ready.
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + em + input.value.slice(end);
      const pos = start + em.length;
      input.setSelectionRange?.(pos, pos);
    });
  }

  async function renderGifs() {
    picker.innerHTML = `
      <div class="p-search">
        <input type="search" placeholder="Search GIFs" aria-label="Search GIFs" enterkeyhint="search" />
        <button type="button" class="p-gallery" title="Send a photo or GIF from this device">Gallery</button>
      </div>
      <div class="p-grid gif-grid"><p class="p-note">Loading…</p></div>`;
    const search = picker.querySelector("input");
    const grid = picker.querySelector(".gif-grid");
    picker.querySelector(".p-gallery").addEventListener("click", () => $("fileInput").click());
    search.addEventListener("input", () => {
      clearTimeout(gifTimer);
      gifTimer = setTimeout(() => loadGifs(search.value.trim(), grid), 350);
    });
    search.addEventListener("keydown", (e) => e.key === "Enter" && search.blur());
    loadGifs("", grid);
  }

  async function loadGifs(q, grid) {
    if (gifSearchOn === false) return noGifSearch(grid);
    try {
      const r = await fetch(`/api/gifs?q=${encodeURIComponent(q)}`);
      if (r.status === 501) {
        gifSearchOn = false;
        return noGifSearch(grid);
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      gifSearchOn = true;
      if (mode !== "gif") return;
      grid.innerHTML = j.items.length ? "" : `<p class="p-note">No GIFs for "${q.replace(/</g, "&lt;")}".</p>`;
      for (const g of j.items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "g";
        const img = document.createElement("img");
        img.src = g.src;
        img.alt = "";
        img.loading = "lazy";
        if (g.w && g.h) img.style.aspectRatio = `${g.w} / ${g.h}`;
        b.appendChild(img);
        b.addEventListener("click", () => {
          socket.emit("chat", { kind: "gif", id: g.id });
          closePicker();
          toBottom();
        });
        grid.appendChild(b);
      }
    } catch (e) {
      grid.innerHTML = `<p class="p-note">${e.message === "bad-key" ? "The GIPHY key in .env isn't valid." : "Couldn't reach GIPHY. Try again in a moment."}</p>`;
    }
  }

  function noGifSearch(grid) {
    grid.innerHTML = `<p class="p-note">GIF search is off. To turn it on, add a free GIPHY key to <code>.env</code> as <code>GIPHY_API_KEY</code> and restart. You can still send photos and GIFs from your gallery.</p>`;
    picker.querySelector(".p-search input").disabled = true;
  }

  // Photos / GIFs from the device: uploaded to the Mac only.
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return alertInline("That file is too big (max 15 MB).");
    let w = 0,
      h = 0;
    try {
      const bmp = await createImageBitmap(file);
      w = bmp.width;
      h = bmp.height;
      bmp.close?.();
    } catch {}
    closePicker();
    alertInline("Sending…");
    try {
      const r = await fetch(`/api/upload?w=${w}&h=${h}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't send that file.");
      socket.emit("chat", { kind: "image", id: j.id });
      typingEl.textContent = "";
      toBottom();
    } catch (err) {
      alertInline(err.message);
    }
  });
  function alertInline(text) {
    typingEl.textContent = text;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (typingEl.textContent = ""), 4000);
  }

  function toggleHidden() {
    page.classList.toggle("chat-hidden");
  }

  socket.on("chat-history", (msgs) => {
    list.querySelectorAll(".msg").forEach((n) => n.remove());
    history.length = 0;
    empty.hidden = msgs.length > 0;
    msgs.forEach((m) => add(m, { live: false }));
    toBottom();
  });
  socket.on("chat", (m) => add(m));
  socket.on("typing", ({ name }) => {
    typingEl.textContent = `${name} is typing…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (typingEl.textContent = ""), 3000);
  });
  return { toggleHidden };
}
