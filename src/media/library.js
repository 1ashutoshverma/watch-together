const fs = require("fs");
const path = require("path");

const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".ts", ".flv", ".wmv", ".mpg", ".mpeg"]);
const MAX_DEPTH = 3;

function listLibrary(mediaDir) {
  const out = [];
  function walk(dir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory() && depth < MAX_DEPTH) walk(abs, depth + 1);
      else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {}
        out.push({ path: path.relative(mediaDir, abs), name: e.name, size });
      }
    }
  }
  walk(mediaDir, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveSafe(mediaDir, rel) {
  if (typeof rel !== "string" || !rel) return null;
  const root = path.resolve(mediaDir);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!VIDEO_EXT.has(path.extname(abs).toLowerCase())) return null;
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    if (!real.startsWith(realRoot + path.sep)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

module.exports = { listLibrary, resolveSafe, VIDEO_EXT };
