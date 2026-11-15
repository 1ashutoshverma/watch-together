// What you've watched this session, with where you stopped. Memory only: gone when the server stops.
const crypto = require("crypto");

const MAX = 30;
const SALT = crypto.randomBytes(16);

// Opaque key per source, so clients never see URLs or file paths.
function keyOf(source) {
  if (!source) return null;
  let raw;
  if (source.type === "link") raw = "link:" + source.url;
  else if (source.type === "file") raw = "file:" + source.path;
  else if (source.type === "external") raw = "external:" + source.title;
  else if (source.type === "ext") raw = "ext:" + source.site + ":" + source.title;
  else return null;
  return crypto.createHmac("sha256", SALT).update(raw).digest("base64url").slice(0, 16);
}

function siteOf(source) {
  if (source.type === "link") {
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  return source.site || "";
}

function createHistory({ now = Date.now } = {}) {
  const entries = []; // newest first: {key, source, title, kind, site, position, duration, at}
  const sources = new Map(); // media id -> source

  function attach(media, source) {
    if (media && source) sources.set(media.id, source);
  }

  // Remember (or update) the item that is being left, with its position.
  function record(media, position) {
    if (!media) return;
    const source = sources.get(media.id);
    const key = keyOf(source);
    if (!key) return;
    const i = entries.findIndex((e) => e.key === key);
    if (i >= 0) entries.splice(i, 1);
    let pos = Math.max(0, Number(position) || 0);
    if (media.duration && pos > media.duration - 5) pos = 0; // finished: start over next time
    entries.unshift({ key, source, title: media.title || source.title || "Video", kind: source.type, site: siteOf(source), position: pos, duration: media.duration || null, at: now() });
    if (entries.length > MAX) entries.length = MAX;
  }

  function get(key) {
    return entries.find((e) => e.key === key) || null;
  }

  // What clients see: no URLs, plus the current item on top.
  function list(currentMedia, currentPosition) {
    const curKey = currentMedia ? keyOf(sources.get(currentMedia.id)) : null;
    const out = [];
    if (curKey) {
      const s = sources.get(currentMedia.id);
      out.push({ key: curKey, title: currentMedia.title || s.title || "Video", kind: s.type, site: siteOf(s), position: currentPosition, duration: currentMedia.duration || null, current: true });
    }
    for (const e of entries) if (e.key !== curKey) out.push({ key: e.key, title: e.title, kind: e.kind, site: e.site, position: e.position, duration: e.duration, current: false });
    return out;
  }

  function clear() {
    entries.length = 0;
  }

  return { attach, record, get, list, clear, keyOf };
}

module.exports = { createHistory, keyOf };
