const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const temp = require("./temp");

// Prefer formats phones play without re-encoding: H.264 + AAC, max 1080p.
const formatSelector = [
  "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a][audio_channels<=2]",
  "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]",
  "b[vcodec^=avc1][height<=1080]",
  "bv*[height<=1080]+ba",
  "b[height<=1080]",
  "bv*+ba",
  "b",
].join("/");

// Fallback for sites whose direct URLs refuse ffmpeg: yt-dlp downloads a single muxed file to stdout.
const pipeSelector = "b[vcodec^=avc1][height<=1080]/b[height<=1080]/b";

const COOKIE_ATTRS = /^(domain|path|secure|expires|version|httponly|samesite|max-age)(=|$)/i;

function cookieHeader(cookies) {
  if (!cookies) return "";
  return cookies
    .split("; ")
    .filter((p) => p && !COOKIE_ATTRS.test(p))
    .join("; ");
}

function isH264(c) {
  return /^(avc|h264)/i.test(c || "");
}
function isAac(c) {
  return /^(mp4a|aac)/i.test(c || "");
}
function noCodec(c) {
  return !c || c === "none";
}

function streamOf(fmt) {
  const headers = { ...(fmt.http_headers || {}) };
  const ck = cookieHeader(fmt.cookies);
  if (ck) headers.Cookie = ck;
  return { url: fmt.url, headers };
}

function pickStreams(info) {
  if (Array.isArray(info.requested_formats) && info.requested_formats.length) {
    const fmts = info.requested_formats;
    const v = fmts.find((f) => !noCodec(f.vcodec)) || fmts[0];
    const a = fmts.find((f) => f !== v && !noCodec(f.acodec));
    return {
      inputs: a ? [streamOf(v), streamOf(a)] : [streamOf(v)],
      formatIds: (a ? [v, a] : [v]).map((f) => f.format_id).filter(Boolean),
      vcodec: v.vcodec,
      acodec: a ? a.acodec : v.acodec,
      title: info.title || "",
      duration: info.duration || null,
      isLive: !!info.is_live,
    };
  }
  return {
    inputs: [streamOf(info)],
    formatIds: info.format_id ? [info.format_id] : [],
    vcodec: info.vcodec,
    acodec: info.acodec,
    title: info.title || "",
    duration: info.duration || null,
    isLive: !!info.is_live,
  };
}

function inputArgs(input) {
  const args = [];
  if (input.url.startsWith("pipe:")) return ["-i", input.url];
  if (/^https?:/i.test(input.url)) {
    args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5");
    args.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto,data");
    const h = { ...(input.headers || {}) };
    const ua = h["User-Agent"];
    delete h["User-Agent"];
    if (ua) args.push("-user_agent", ua);
    const lines = Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join("");
    if (lines) args.push("-headers", lines);
  }
  args.push("-i", input.url);
  return args;
}

function videoCodecArgs(vcodec, hw) {
  if (isH264(vcodec)) return ["-c:v", "copy"];
  if (hw) return ["-c:v", "h264_videotoolbox", "-b:v", "6M", "-maxrate", "8M", "-pix_fmt", "yuv420p"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"];
}

function buildFfmpegArgs({ inputs, vcodec, acodec, outDir, hw = true, isLive = false }) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  inputs.forEach((i) => args.push(...inputArgs(i)));
  if (inputs.length > 1) args.push("-map", "0:v:0", "-map", "1:a:0");
  else args.push("-map", "0:v:0", "-map", "0:a:0?");
  args.push(...videoCodecArgs(vcodec, hw));
  if (isAac(acodec)) args.push("-c:a", "copy");
  else args.push("-c:a", "aac", "-b:a", "160k", "-ac", "2");
  args.push("-sn", "-dn", "-max_muxing_queue_size", "4096");
  args.push("-f", "hls", "-hls_time", "4", "-hls_segment_filename", path.join(outDir, "seg%05d.ts"));
  if (isLive) args.push("-hls_list_size", "30", "-hls_flags", "delete_segments+independent_segments");
  else args.push("-hls_list_size", "0", "-hls_playlist_type", "event", "-hls_flags", "independent_segments");
  args.push(path.join(outDir, "index.m3u8"));
  return args;
}

function friendlyError(text) {
  const t = String(text || "");
  if (/drm/i.test(t)) return "This video is DRM-protected (like Netflix/Hotstar). Use the Netflix & other apps mode instead.";
  if (/unsupported url/i.test(t)) return "This site isn't supported for links. Try Share tab from a laptop.";
  if (/sign in|log ?in|login required|--cookies|confirm your age|age[- ]restricted|members only|premium/i.test(t))
    return "This video needs a login. Set YTDLP_COOKIES_BROWSER=chrome in .env and log in to the site in Chrome.";
  if (/http error 404|not found|unavailable|private video|has been removed/i.test(t)) return "Video not found or unavailable.";
  if (/http error 403|forbidden/i.test(t)) return "The site blocked the download. Try again, or use Share tab.";
  if (/timed out|timeout/i.test(t)) return "The site took too long to respond.";
  return "Couldn't play this link. Try another one, or use Share tab.";
}

function run(cmd, args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

let hwCache = null;
async function hasVideoToolbox() {
  if (hwCache !== null) return hwCache;
  try {
    const out = await run("ffmpeg", ["-hide_banner", "-encoders"]);
    hwCache = out.includes("h264_videotoolbox");
  } catch {
    hwCache = false;
  }
  return hwCache;
}

async function probeFile(abs) {
  const out = await run("ffprobe", ["-v", "error", "-of", "json", "-show_streams", "-show_format", abs], { timeoutMs: 20000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  return {
    vcodec: v ? v.codec_name : null,
    acodec: a ? a.codec_name : null,
    duration: j.format && j.format.duration ? Number(j.format.duration) : null,
  };
}

function countSegments(playlist) {
  try {
    return (fs.readFileSync(playlist, "utf8").match(/#EXTINF/g) || []).length;
  } catch {
    return 0;
  }
}

function createMediaManager({ cookiesBrowser = "", readyTimeoutMs = 90000 } = {}) {
  const ev = new EventEmitter();
  let current = null; // {id, dir, procs, filePath, gen}
  let gen = 0;

  function stop() {
    if (!current) return;
    for (const p of current.procs) {
      try {
        p.kill("SIGKILL");
      } catch {}
    }
    temp.removeJobDir(current.id);
    current = null;
  }

  function startJob() {
    stop();
    const id = crypto.randomBytes(8).toString("hex");
    current = { id, dir: temp.newJobDir(id), procs: [], filePath: null, gen: ++gen };
    return current;
  }

  function status(s, message) {
    ev.emit("status", { status: s, message });
  }

  function waitReady(job, procs) {
    const playlist = path.join(job.dir, "index.m3u8");
    return new Promise((resolve, reject) => {
      let stderr = "";
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(to);
        fn(v);
      };
      for (const p of procs) {
        p.stderr && p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
        p.on("exit", (code) => {
          if (code && code !== 0 && countSegments(playlist) < 1) finish(reject, Object.assign(new Error("ffmpeg failed"), { stderr }));
        });
      }
      const last = procs[procs.length - 1];
      last.on("exit", () => {
        if (countSegments(playlist) >= 1) finish(resolve);
      });
      const timer = setInterval(() => {
        if (job !== current) return finish(reject, Object.assign(new Error("superseded"), { superseded: true }));
        if (countSegments(playlist) >= 2) finish(resolve);
      }, 400);
      const to = setTimeout(() => finish(reject, Object.assign(new Error("timeout"), { stderr: "timed out" })), readyTimeoutMs);
    });
  }

  function spawnTracked(job, cmd, args, opts) {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], ...opts });
    p.on("error", () => {});
    job.procs.push(p);
    return p;
  }

  const superseded = () => Object.assign(new Error("superseded"), { superseded: true });
  function clearDir(job) {
    for (const f of fs.readdirSync(job.dir)) if (f !== "info.json") fs.rmSync(path.join(job.dir, f), { force: true });
  }
  function killProcs(job) {
    for (const p of job.procs.splice(0)) {
      try {
        p.kill("SIGKILL");
      } catch {}
    }
  }

  async function resolve(job, url) {
    const ytArgs = ["-J", "--no-playlist", "--no-warnings", "-f", formatSelector];
    if (cookiesBrowser) ytArgs.push("--cookies-from-browser", cookiesBrowser);
    ytArgs.push("--", url);
    status("resolving", "Finding the video…");
    let raw;
    try {
      raw = await run("yt-dlp", ytArgs, { timeoutMs: 90000 });
    } catch (e) {
      throw Object.assign(new Error("yt-dlp failed"), { stderr: e.stderr || e.message, fatal: true });
    }
    if (job !== current) throw superseded();
    fs.writeFileSync(path.join(job.dir, "info.json"), raw);
    return pickStreams(JSON.parse(raw));
  }

  // 1) yt-dlp's own downloader (fast, chunked, handles cookies/headers) streams each format into ffmpeg.
  async function ytPipeAttempt(job, picked, hw) {
    const ids = picked.formatIds;
    if (!ids.length) throw new Error("no format ids");
    const inputs = ids.map((_, i) => ({ url: `pipe:${3 + i}` }));
    const ff = spawnTracked(job, "ffmpeg", buildFfmpegArgs({ ...picked, inputs, outDir: job.dir, hw }), {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    });
    const yts = ids.map((id, i) => {
      const args = ["--load-info-json", path.join(job.dir, "info.json"), "-f", id, "--no-part", "--no-warnings", "-o", "-"];
      if (cookiesBrowser) args.push("--cookies-from-browser", cookiesBrowser);
      const yt = spawnTracked(job, "yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
      const sink = ff.stdio[3 + i];
      sink.on("error", () => {});
      yt.stdout.on("error", () => {});
      yt.stdout.pipe(sink);
      return yt;
    });
    await waitReady(job, [...yts, ff]);
  }

  // 2) ffmpeg reads the direct URLs itself (supports range requests, slower on some sites).
  async function directAttempt(job, picked, hw) {
    const ff = spawnTracked(job, "ffmpeg", buildFfmpegArgs({ ...picked, outDir: job.dir, hw }));
    await waitReady(job, [ff]);
  }

  // 3) Single muxed file from yt-dlp, always re-encoded (codec unknown up front).
  async function singlePipeAttempt(job, url, hw, picked) {
    const ytArgs = ["-f", pipeSelector, "--no-playlist", "--no-warnings", "--no-part", "-o", "-"];
    if (cookiesBrowser) ytArgs.push("--cookies-from-browser", cookiesBrowser);
    ytArgs.push("--", url);
    const yt = spawnTracked(job, "yt-dlp", ytArgs);
    const ff = spawnTracked(job, "ffmpeg", buildFfmpegArgs({ inputs: [{ url: "pipe:0" }], vcodec: null, acodec: null, outDir: job.dir, hw, isLive: picked.isLive }));
    ff.stdin.on("error", () => {});
    yt.stdout.on("error", () => {});
    yt.stdout.pipe(ff.stdin);
    await waitReady(job, [yt, ff]);
  }

  async function loadLink(url) {
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("Paste a full link starting with http:// or https://");
    const job = startJob();
    const hw = await hasVideoToolbox();
    let picked;
    try {
      picked = await resolve(job, url);
    } catch (e) {
      if (e.superseded) throw e;
      if (job === current) stop();
      throw new Error(friendlyError(e.stderr));
    }
    status("starting", "Starting stream…");
    const attempts = [() => ytPipeAttempt(job, picked, hw), () => directAttempt(job, picked, hw), () => singlePipeAttempt(job, url, hw, picked)];
    let errText = "";
    for (const attempt of attempts) {
      if (job !== current) throw superseded();
      try {
        await attempt();
        fs.rmSync(path.join(job.dir, "info.json"), { force: true });
        return { id: job.id, kind: "hls", src: `/media/${job.id}/index.m3u8`, title: picked.title || "Video", duration: picked.duration, isLive: picked.isLive };
      } catch (e) {
        if (e.superseded || job !== current) throw superseded();
        errText += (e.stderr || "") + "\n";
        killProcs(job);
        clearDir(job);
      }
    }
    if (job === current) stop();
    throw new Error(friendlyError(errText));
  }

  async function loadFile(abs, rel) {
    const job = startJob();
    status("starting", "Opening file…");
    const meta = await probeFile(abs);
    if (job !== current) throw Object.assign(new Error("superseded"), { superseded: true });
    const ext = path.extname(abs).toLowerCase();
    const title = path.basename(rel || abs);
    if ([".mp4", ".m4v", ".mov"].includes(ext) && isH264(meta.vcodec) && (noCodec(meta.acodec) || isAac(meta.acodec))) {
      job.filePath = abs;
      return { id: job.id, kind: "file", src: `/media/${job.id}/file`, title, duration: meta.duration };
    }
    const hw = await hasVideoToolbox();
    const ff = spawnTracked(job, "ffmpeg", buildFfmpegArgs({ inputs: [{ url: abs }], vcodec: meta.vcodec, acodec: meta.acodec, outDir: job.dir, hw }));
    try {
      await waitReady(job, [ff]);
    } catch (e) {
      if (e.superseded) throw e;
      if (job === current) stop();
      throw new Error("Couldn't open this file.");
    }
    return { id: job.id, kind: "hls", src: `/media/${job.id}/index.m3u8`, title, duration: meta.duration };
  }

  function lookup(id) {
    if (!current || current.id !== id) return null;
    return { dir: current.dir, filePath: current.filePath };
  }

  return { loadLink, loadFile, stop, lookup, on: ev.on.bind(ev) };
}

module.exports = { formatSelector, pickStreams, buildFfmpegArgs, cookieHeader, friendlyError, probeFile, createMediaManager };
