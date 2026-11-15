const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { resolveSafe, listLibrary } = require("../src/media/library");
const { pickStreams, buildFfmpegArgs, cookieHeader, friendlyError, createMediaManager } = require("../src/media/fetcher");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-lib-"));
fs.mkdirSync(path.join(dir, "sub"));

test("resolveSafe blocks traversal and non-video", () => {
  fs.writeFileSync(path.join(dir, "sub", "a.mp4"), "x");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  assert.equal(resolveSafe(dir, "../x.mp4"), null);
  assert.equal(resolveSafe(dir, "../../etc/passwd"), null);
  assert.equal(resolveSafe(dir, "notes.txt"), null);
  assert.equal(resolveSafe(dir, "/etc/hosts"), null);
  assert.ok(resolveSafe(dir, "sub/a.mp4").endsWith(path.join("sub", "a.mp4")));
  assert.deepEqual(listLibrary(dir).map((i) => i.path), [path.join("sub", "a.mp4")]);
});

test("pickStreams with requested_formats returns video+audio with headers and cookies", () => {
  const info = {
    title: "T",
    duration: 60,
    requested_formats: [
      { url: "https://v", vcodec: "avc1.640028", acodec: "none", http_headers: { "User-Agent": "UA", Referer: "https://r" }, cookies: "sid=abc; Domain=.x.com; Path=/; Secure; Expires=1" },
      { url: "https://a", vcodec: "none", acodec: "mp4a.40.2", http_headers: { "User-Agent": "UA" } },
    ],
  };
  const p = pickStreams(info);
  assert.equal(p.inputs.length, 2);
  assert.equal(p.inputs[0].headers.Referer, "https://r");
  assert.equal(p.inputs[0].headers.Cookie, "sid=abc");
  assert.equal(p.vcodec, "avc1.640028");
  assert.equal(p.acodec, "mp4a.40.2");
});

test("pickStreams single format", () => {
  const p = pickStreams({ url: "https://s", vcodec: "vp9", acodec: "opus", http_headers: {} });
  assert.equal(p.inputs.length, 1);
  assert.equal(p.vcodec, "vp9");
});

test("buildFfmpegArgs copies h264/aac, transcodes others", () => {
  const copy = buildFfmpegArgs({ inputs: [{ url: "https://v", headers: { "User-Agent": "UA", Referer: "r" } }, { url: "https://a", headers: {} }], vcodec: "avc1", acodec: "mp4a", outDir: "/o" }).join(" ");
  assert.match(copy, /-c:v copy/);
  assert.match(copy, /-c:a copy/);
  assert.match(copy, /-map 0:v:0 -map 1:a:0/);
  assert.match(copy, /-user_agent UA/);
  assert.match(copy, /-hls_playlist_type event/);
  const tx = buildFfmpegArgs({ inputs: [{ url: "https://v" }], vcodec: "vp9", acodec: "opus", outDir: "/o", hw: true }).join(" ");
  assert.match(tx, /h264_videotoolbox/);
  assert.match(tx, /-c:a aac/);
  const sw = buildFfmpegArgs({ inputs: [{ url: "/f.mkv" }], vcodec: "hevc", acodec: "aac", outDir: "/o", hw: false }).join(" ");
  assert.match(sw, /libx264/);
  const live = buildFfmpegArgs({ inputs: [{ url: "https://v" }], vcodec: "avc1", acodec: "mp4a", outDir: "/o", isLive: true }).join(" ");
  assert.match(live, /delete_segments/);
});

test("cookieHeader and friendlyError", () => {
  assert.equal(cookieHeader("a=1; Domain=.x; Path=/; b=2; Secure"), "a=1; b=2");
  assert.equal(cookieHeader(undefined), "");
  assert.match(friendlyError("ERROR: [generic] Unsupported URL: x"), /isn't supported/);
  assert.match(friendlyError("This video is DRM protected"), /DRM/);
  assert.match(friendlyError("ERROR: [generic] x: Unable to download webpage: HTTP Error 404: Not Found"), /not found/);
  assert.match(friendlyError("Sign in to confirm you're not a bot. Use --cookies-from-browser"), /login/);
});

test("loadFile: mkv becomes HLS, h264 mp4 served direct, bad link errors", async () => {
  const mkv = path.join(dir, "clip.mkv");
  const mp4 = path.join(dir, "clip.mp4");
  const src = ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=10", "-f", "lavfi", "-i", "sine=duration=10"];
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...src, "-c:v", "mpeg4", "-c:a", "mp3", mkv]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...src, "-c:v", "libx264", "-c:a", "aac", "-shortest", mp4]);
  const m = createMediaManager();
  const a = await m.loadFile(mkv, "clip.mkv");
  assert.equal(a.kind, "hls");
  assert.ok(fs.existsSync(path.join(m.lookup(a.id).dir, "index.m3u8")));
  const b = await m.loadFile(mp4, "clip.mp4");
  assert.equal(b.kind, "file");
  assert.equal(m.lookup(a.id), null, "old job cleared");
  await assert.rejects(m.loadLink("not a url"), /full link/);
  m.stop();
});
