// Photos/GIFs in chat. Uploads live in the temp folder (wiped on stop). GIPHY search and GIF files are
// fetched by this Mac and passed through, so phones never talk to GIPHY directly.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { TEMP_ROOT } = require("./media/temp");

const UPLOAD_LIMIT = 15 * 1024 * 1024;
const UPLOADS_TOTAL = 300 * 1024 * 1024;
const GIF_CACHE_TOTAL = 80 * 1024 * 1024;
const GIF_ID = /^[A-Za-z0-9]{4,40}$/;
const UPLOAD_ID = /^[a-f0-9]{24}$/;

function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buf[0] === 0x89 && buf.slice(1, 4).toString("ascii") === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function dim(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 20000 ? n : null;
}

function createChatMedia({ giphyKey = "", fetchImpl = globalThis.fetch } = {}) {
  const dir = path.join(TEMP_ROOT, "chat");
  const uploads = new Map(); // id -> {file, mime, size, w, h}
  const gifs = new Map(); // giphy id -> {url, w, h}
  const gifCache = new Map(); // giphy id -> {buf, type}
  let gifCacheSize = 0;

  function totalUploads() {
    let t = 0;
    for (const u of uploads.values()) t += u.size;
    return t;
  }

  function saveUpload(buf, w, h) {
    const mime = sniffImage(buf);
    if (!mime) return { error: "Only photos and GIFs (JPG, PNG, GIF, WebP) can be sent." };
    fs.mkdirSync(dir, { recursive: true });
    while (uploads.size && totalUploads() + buf.length > UPLOADS_TOTAL) {
      const [oldId, old] = uploads.entries().next().value;
      fs.rmSync(old.file, { force: true });
      uploads.delete(oldId);
    }
    const id = crypto.randomBytes(12).toString("hex");
    const file = path.join(dir, id);
    fs.writeFileSync(file, buf);
    uploads.set(id, { file, mime, size: buf.length, w: dim(w), h: dim(h) });
    return { id };
  }

  async function searchGifs(q, kind = "gifs") {
    if (!giphyKey) return { error: "no-key" };
    const endpoint = kind === "stickers" ? "stickers" : "gifs";
    const params = new URLSearchParams({ api_key: giphyKey, limit: "30", rating: "r" });
    let url;
    if (q) {
      params.set("q", q.slice(0, 80));
      url = `https://api.giphy.com/v1/${endpoint}/search?${params}`;
    } else url = `https://api.giphy.com/v1/${endpoint}/trending?${params}`;
    const r = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return { error: r.status === 401 || r.status === 403 ? "bad-key" : "giphy-down" };
    const j = await r.json();
    const items = [];
    for (const g of j.data || []) {
      const img = g.images && (g.images.fixed_height || g.images.downsized || g.images.original);
      if (!img || !GIF_ID.test(g.id)) continue;
      const src = img.webp || img.url;
      if (!src || !/^https:\/\/[a-z0-9.-]*giphy\.com\//i.test(src)) continue;
      gifs.set(g.id, { url: src, w: dim(img.width), h: dim(img.height) });
      items.push({ id: g.id, w: dim(img.width), h: dim(img.height), src: `/gif/${g.id}` });
    }
    return { items };
  }

  async function gifBytes(id) {
    if (gifCache.has(id)) return gifCache.get(id);
    const meta = gifs.get(id);
    if (!meta) return null;
    const r = await fetchImpl(meta.url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get("content-type") || "image/webp";
    const entry = { buf, type };
    gifCache.set(id, entry);
    gifCacheSize += buf.length;
    while (gifCacheSize > GIF_CACHE_TOTAL && gifCache.size > 1) {
      const [k, v] = gifCache.entries().next().value;
      gifCache.delete(k);
      gifCacheSize -= v.buf.length;
    }
    return entry;
  }

  // Turns what a client sent into a stored chat payload, or null if it isn't valid.
  function messagePayload(input) {
    if (typeof input === "string") return { text: input };
    if (!input || typeof input !== "object") return null;
    if (input.kind === "image" && UPLOAD_ID.test(input.id || "") && uploads.has(input.id)) {
      const u = uploads.get(input.id);
      return { kind: "image", src: `/chat-media/${input.id}`, w: u.w, h: u.h };
    }
    if (input.kind === "gif" && GIF_ID.test(input.id || "") && gifs.has(input.id)) {
      const g = gifs.get(input.id);
      return { kind: "gif", src: `/gif/${input.id}`, w: g.w, h: g.h };
    }
    if (typeof input.text === "string") return { text: input.text };
    return null;
  }

  const router = express.Router();
  router.post("/api/upload", express.raw({ type: () => true, limit: UPLOAD_LIMIT }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Empty file." });
    const r = saveUpload(req.body, req.query.w, req.query.h);
    if (r.error) return res.status(415).json(r);
    res.json(r);
  });
  router.get("/chat-media/:id", (req, res) => {
    const u = UPLOAD_ID.test(req.params.id) && uploads.get(req.params.id);
    if (!u || !fs.existsSync(u.file)) return res.status(404).end();
    res.set({ "Content-Type": u.mime, "Cache-Control": "private, max-age=86400", "Content-Security-Policy": "default-src 'none'" });
    fs.createReadStream(u.file).pipe(res);
  });
  router.get("/api/gifs", async (req, res) => {
    try {
      const r = await searchGifs(String(req.query.q || "").trim(), req.query.kind);
      if (r.error) return res.status(r.error === "no-key" ? 501 : 502).json(r);
      res.json(r);
    } catch {
      res.status(502).json({ error: "giphy-down" });
    }
  });
  router.get("/gif/:id", async (req, res) => {
    if (!GIF_ID.test(req.params.id)) return res.status(404).end();
    try {
      const g = await gifBytes(req.params.id);
      if (!g) return res.status(404).end();
      res.set({ "Content-Type": g.type, "Cache-Control": "private, max-age=86400" });
      res.end(g.buf);
    } catch {
      res.status(502).end();
    }
  });
  router.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "That file is too big (max 15 MB)." });
    next(err);
  });

  return { router, messagePayload, saveUpload, searchGifs, hasGiphy: !!giphyKey };
}

module.exports = { createChatMedia, sniffImage };
