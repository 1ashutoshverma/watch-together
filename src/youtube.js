// YouTube search and "Up next", via yt-dlp (no API key). Thumbnails are passed through this Mac,
// so phones don't contact YouTube while browsing.
const { execFile } = require("child_process");
const express = require("express");

const ID = /^[A-Za-z0-9_-]{11}$/;
const THUMB_CACHE_TOTAL = 25 * 1024 * 1024;

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.slice(1, 12);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) id = m[2];
      }
    }
    return id && ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function toItems(json, excludeId) {
  const out = [];
  const seen = new Set();
  for (const e of (json && json.entries) || []) {
    if (!e || !ID.test(e.id || "") || e.id === excludeId || seen.has(e.id)) continue;
    if (e.live_status === "is_upcoming") continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      title: String(e.title || "Video").slice(0, 200),
      channel: String(e.channel || e.uploader || "").slice(0, 80),
      duration: Number.isFinite(e.duration) ? Math.round(e.duration) : null,
      live: e.live_status === "is_live",
      thumb: `/yt-thumb/${e.id}`,
    });
  }
  return out;
}

function runJson(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", args, { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function createYouTube({ run = runJson, fetchImpl = globalThis.fetch } = {}) {
  const upNextCache = new Map(); // id -> items
  const thumbs = new Map(); // id -> Buffer
  let thumbsSize = 0;

  async function search(q, limit = 20) {
    const query = String(q || "").trim().slice(0, 120);
    if (!query) return [];
    return toItems(await run(["-J", "--flat-playlist", "--no-warnings", "--", `ytsearch${limit}:${query}`]));
  }

  // YouTube's own autoplay "Mix" for a video; falls back to a search on the title.
  async function upNext(id, title = "") {
    if (!ID.test(id || "")) return [];
    if (upNextCache.has(id)) return upNextCache.get(id);
    let items = [];
    try {
      const mix = `https://www.youtube.com/watch?v=${id}&list=RD${id}&start_radio=1`;
      items = toItems(await run(["-J", "--flat-playlist", "--yes-playlist", "--playlist-end", "26", "--no-warnings", "--", mix]), id);
    } catch {}
    if (items.length < 3 && title) {
      try {
        items = toItems(await run(["-J", "--flat-playlist", "--no-warnings", "--", `ytsearch15:${String(title).slice(0, 100)}`]), id);
      } catch {}
    }
    items = items.slice(0, 25);
    if (items.length) upNextCache.set(id, items);
    if (upNextCache.size > 50) upNextCache.delete(upNextCache.keys().next().value);
    return items;
  }

  async function thumb(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    const r = await fetchImpl(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    thumbs.set(id, buf);
    thumbsSize += buf.length;
    while (thumbsSize > THUMB_CACHE_TOTAL && thumbs.size > 1) {
      const [k, v] = thumbs.entries().next().value;
      thumbs.delete(k);
      thumbsSize -= v.length;
    }
    return buf;
  }

  const router = express.Router();
  router.get("/api/yt/search", async (req, res) => {
    try {
      res.json({ items: await search(req.query.q) });
    } catch {
      res.status(502).json({ error: "YouTube search didn't work. Try again, or run brew upgrade yt-dlp." });
    }
  });
  router.get("/api/yt/upnext/:id", async (req, res) => {
    try {
      res.json({ items: await upNext(req.params.id, String(req.query.title || "")) });
    } catch {
      res.status(502).json({ error: "Couldn't load suggestions." });
    }
  });
  router.get("/yt-thumb/:id", async (req, res) => {
    if (!ID.test(req.params.id)) return res.status(404).end();
    try {
      const buf = await thumb(req.params.id);
      if (!buf) return res.status(404).end();
      res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" });
      res.end(buf);
    } catch {
      res.status(502).end();
    }
  });

  return { router, search, upNext };
}

module.exports = { createYouTube, youtubeId, watchUrl, toItems, YT_ID: ID };
