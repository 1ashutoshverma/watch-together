const fs = require("fs");
const path = require("path");
const express = require("express");
const { listLibrary } = require("./library");

const SEG = /^seg\d{5}\.ts$/;

function sendRange(req, res, abs, type) {
  const size = fs.statSync(abs).size;
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { "Content-Length": size, "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    return fs.createReadStream(abs).pipe(res);
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) {
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  }
  if (start >= size || end < start) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    return res.end();
  }
  end = Math.min(end, size - 1);
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(abs, { start, end }).pipe(res);
}

function mediaRoutes({ manager, mediaDir }) {
  const r = express.Router();

  r.get("/api/library", (req, res) => res.json({ dir: path.basename(mediaDir), items: listLibrary(mediaDir) }));

  r.get("/media/:id/:file", (req, res) => {
    const job = manager.lookup(req.params.id);
    if (!job) return res.status(404).end();
    const f = req.params.file;
    if (f === "file" && job.filePath) return sendRange(req, res, job.filePath, "video/mp4");
    if (f === "index.m3u8" || SEG.test(f)) {
      const abs = path.join(job.dir, f);
      if (!fs.existsSync(abs)) return res.status(404).end();
      if (f.endsWith(".m3u8")) {
        res.set({ "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
        return res.send(fs.readFileSync(abs, "utf8"));
      }
      return sendRange(req, res, abs, "video/mp2t");
    }
    res.status(404).end();
  });

  return r;
}

module.exports = { mediaRoutes };
