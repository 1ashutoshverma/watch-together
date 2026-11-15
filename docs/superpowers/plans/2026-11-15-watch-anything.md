# Watch Anything Together Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file watch-together app into a private two-person room that plays any
pasted link or local file in sync on phone and laptop, with chat, tab share, countdown sync for
OTT phone apps, and a Chrome extension that syncs Netflix/Hotstar/Prime/JioCinema players.

**Architecture:** Express + socket.io server on the Mac bound to 127.0.0.1, exposed through a
Cloudflare quick tunnel. The server keeps the authoritative room state. Links are resolved with
`yt-dlp -J` and their direct stream URLs are fed to `ffmpeg`, which writes HLS into a temp dir.
Clients use native HLS on iOS and hls.js elsewhere. Tab share is WebRTC peer-to-peer with
socket.io signalling. The extension uses socket.io with token auth over the websocket
transport, plus a MAIN-world page script for per-site player control.

**Tech Stack:** Node 26, Express 5, socket.io 4, hls.js, qrcode-terminal, ffmpeg/ffprobe,
yt-dlp, cloudflared, Chrome MV3, node:test.

**Spec:** `docs/superpowers/specs/2026-11-15-watch-anything-design.md`

## Global Constraints

- Server listens on `127.0.0.1` only; every route except `/login.html`, `/login.js`, `/app.css`, `POST /api/login` requires auth.
- No request/URL/title logging. Console prints only the startup URL, password hint, and URL-free errors.
- All temp media lives under `os.tmpdir()/wt-media`, wiped at startup, on new media, and on exit.
- Max 2 distinct names online; a third distinct name is rejected (`room-full`).
- Format preference: H.264 + AAC, height ≤ 1080; anything else is re-encoded with `h264_videotoolbox` (fallback `libx264 -preset veryfast`) / `aac`.
- Config via `.env` (git-ignored): `ROOM_PASSWORD`, `MEDIA_DIR` (default `~/Movies`), `PORT` (default 3000), `YTDLP_COOKIES_BROWSER` (optional), `NO_TUNNEL=1` (optional).

## Review Focus

- Mobile autoplay: a remote "play" on iOS/Android must not silently fail; show a "Tap to sync" button when `play()` rejects. Covered in Task 4's manual check.
- Refresh mid-movie lands within ~1 s of the other side. Test in Task 2 (`stateForJoin` time math).
- Same person on phone and laptop and extension at once must not count as 3 people. Test in Task 2 (cap counts distinct names).
- Path traversal in library (`../../etc/passwd`) must 404. Test in Task 3.
- Pasting a DRM or unsupported URL gives a readable error, not a hang. Task 3 (yt-dlp non-zero exit, error mapped to `media-error`).

---

### Task 1: Config, auth, login

**Files:** Create `src/config.js`, `src/auth.js`, `public/login.html`, `public/login.js`, `test/auth.test.js`. Modify `.gitignore` (add `.env`).

**Interfaces — Produces:**
- `loadConfig() -> {password, mediaDir, port, cookiesBrowser, noTunnel, generatedPassword:boolean}`
- `createAuth({password, secret?}) -> {login(password, name, ip) -> {ok, token?, error?}, verify(token) -> {name}|null, httpMiddleware, socketMiddleware}`
- Token = `base64url(name).exp.hmac`; cookie `wt` (HttpOnly, SameSite=Lax, Secure when `x-forwarded-proto` is https); socket accepts cookie or `handshake.auth.token`.
- Rate limit: 5 failures / IP / 15 min, IP from `cf-connecting-ip` else socket address.

- [ ] Tests: `verify(login(pw,'A').token).name === 'A'`; wrong password returns `{ok:false}`; 6th failure in window returns `error:'rate-limited'` even with right password; tampered token returns null; expired token returns null.
- [ ] Implement, run `node --test`, commit.

### Task 2: Room state, sync, chat, presence

**Files:** Create `src/room.js`, `src/sockets.js`, `test/room.test.js`.

**Interfaces — Produces:**
- `createRoom({now?}) -> room` with `join(name, socketId) -> {ok}|{ok:false,error:'room-full'}`, `leave(socketId)`, `online() -> string[]`, `applyIntent({type:'play'|'pause'|'seek', position}) -> state`, `setMedia(media|null) -> state`, `stateForJoin() -> state` (position advanced by elapsed time if playing), `addChat(name, text) -> msg` (keeps last 200, text trimmed to 1000 chars), `chat() -> msg[]`.
- `state = {media, playing, position, updatedAt, version}`. `media = {id, kind:'hls'|'file'|'share'|'external'|'ext', src?, title?, from?, startAt?}`.
- Socket events, client → server: `intent`, `chat`, `typing`, `panic`, `countdown {action}`, `time-sync` (ack with server now), `rtc {to, data}`, `share-start`, `share-stop`, `load-link {url}`, `load-file {path}`, `load-external {title, startAt}`, `load-ext {title, site}`.
  Server → client: `state`, `chat`, `chat-history`, `presence {online}`, `typing {name}`, `panic`, `countdown {action, at}`, `rtc {from, data}`, `media-status {status, message?}`, `media-error {message}`, `room-full`.

- [ ] Tests: third distinct name gets room-full; same name on 3 sockets is ok; leaving frees the slot; `applyIntent` bumps version; `stateForJoin` after 10 s playing at position 5 returns 15; paused returns the same position; chat is capped at 200.
- [ ] Implement `sockets.js` wiring (countdown `at = now + 4000`), run tests, commit.

### Task 3: Media — library, link fetcher, HLS routes

**Files:** Create `src/media/temp.js`, `src/media/library.js`, `src/media/fetcher.js`, `src/media/routes.js`, `test/media.test.js`.

**Interfaces — Produces:**
- `temp.js`: `TEMP_ROOT`, `wipeAll()`, `newJobDir(id) -> path`, `removeJobDir(id)`.
- `library.js`: `listLibrary(mediaDir) -> [{path(relative), name, size}]` (recursive, depth 3, video extensions), `resolveSafe(mediaDir, rel) -> abs|null`.
- `fetcher.js`: `formatSelector` (const string), `pickStreams(info) -> {inputs:[{url, headers}], vcodec, acodec, title, isLive}`, `buildFfmpegArgs({inputs, vcodec, acodec, outDir, hw}) -> string[]`, `probeFile(abs) -> {vcodec, acodec}`, `createMediaManager({cookiesBrowser}) -> {loadLink(url) -> Promise<media>, loadFile(abs, rel) -> Promise<media>, stop(), on(event)}`. Only one job alive; a new load kills the old one and deletes its dir. Resolves once `index.m3u8` has at least 2 segments, or rejects with a message.
- `routes.js`: `GET /media/:id/:file` (only `index.m3u8` / `seg*.ts` / `file`), with range support for `file`. `GET /api/library`.

- [ ] Tests: `resolveSafe(dir,'../x')` returns null; `pickStreams` on a fixture with `requested_formats` returns 2 inputs with headers; `buildFfmpegArgs` with h264/aac contains `-c:v copy -c:a copy`; with vp9 contains `h264_videotoolbox`; integration: an ffmpeg-generated 5 s mkv in a temp MEDIA_DIR loads to an HLS dir with `index.m3u8`.
- [ ] Implement, `brew install yt-dlp`, run tests, commit.

### Task 4: Web client (responsive laptop + phone)

**Files:** Rewrite `public/index.html`; create `public/app.css`, `public/app.js`, `public/js/{socket,player,sync,chat,sources,countdown,share,panic}.js` (ES modules).

- Laptop (>900px): video left, collapsible chat right, source bar top (Link, Library, Share tab, Other app, Panic). Phone portrait: source bar, video, chat. Landscape/fullscreen: custom fullscreen on a wrapper with a translucent chat overlay.
- Player: HLS with native support if `canPlayType('application/vnd.apple.mpegurl')`, else hls.js served from `/vendor/hls.min.js`. Echo suppression: ignore a local event when the video already matches room state (paused flag and |Δt| < 1 s). Drift check every 2 s, reseek when > 1.5 s off.
- "Tap to sync" overlay when `play()` rejects.
- [ ] Manual check with Playwright (desktop + iPhone viewport, two contexts): login, paste link or pick a library file, play in A starts B, seek syncs, chat both ways, refresh B rejoins at the right time, 3rd name rejected.
- [ ] Commit.

### Task 5: Countdown (OTT on phone) + tab share

- Other app: form with title + start time, then the external media card. Start/Pause buttons send `countdown`. Clients render a 3-2-1 against server time (offset from `time-sync`) and vibrate where supported.
- Share tab (laptop only, hidden when no `getDisplayMedia`): `getDisplayMedia({video:true,audio:true})`, one RTCPeerConnection per viewer with STUN `stun:stun.l.google.com:19302`; viewers set `srcObject`. Stop ends tracks and clears media.
- [ ] Manual check with two Playwright contexts (fake media flags), commit.

### Task 6: Tunnel, start script, README

**Files:** Create `src/tunnel.js`, `test/tunnel.test.js`; rewrite `server.js`, `README.md`.
- `parseTunnelUrl(line) -> string|null` matching `https://[a-z0-9-]+\.trycloudflare\.com`.
- `server.js` wires everything, starts `caffeinate -i -w <pid>`, spawns cloudflared unless `NO_TUNNEL`, and prints the URL + QR + password hint. SIGINT/SIGTERM kill children and wipe temp.
- [ ] Test the parser, run `npm start` for real, confirm the URL loads the login page, commit.

### Task 7: Chrome extension

**Files:** `extension/manifest.json`, `extension/popup.html`, `extension/popup.js`, `extension/content.js` (isolated: socket, sidebar UI, bridge), `extension/page.js` (MAIN world: adapters), `extension/socket.io.min.js` (copied from `node_modules/socket.io/client-dist`), `extension/sidebar.css`.
- Popup: server URL + name + password, then `POST /api/login` returns a token saved in `chrome.storage.local`.
- Adapters: netflix (`netflix.appContext.state.playerApp.getAPI().videoPlayer`, seek in ms), generic (largest visible `<video>`) used for hotstar, primevideo, jiocinema and others.
- "Sync this tab" sends `load-ext`. Then player events send intents, room state applies to the player, countdown auto-plays/pauses at `at`, and a chat sidebar is injected.
- [ ] Load unpacked in Chrome, test on a generic `<video>` page against the local server, commit.
