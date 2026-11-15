# Watch Anything Together — Design

Date: 2026-11-15
Status: draft, awaiting approval

## Intent

Two people want to watch videos together from two places, both usually on
their phones, with chat on the same screen. The video can come from almost any website
(YouTube and other streaming pages) or from a file on the Mac. It should play
clean (no site ads, no site player restrictions), stay in sync for both, and be completely
private: only the two of them can ever get in, and nothing is left behind afterwards.

They also want Netflix, Hotstar and other subscription apps in the same experience. Those
apps are DRM-protected, so their video can never pass through this app. For them the app
syncs each person's own player (each uses their own subscription) and provides the chat.

The Mac is the server. It is on at home while they watch. Each of them uses either a phone
or a laptop, and the UI must work well on both.

## Goals

- Paste a video-page URL on either phone, and both phones start playing that video in sync.
- Pick a file from a folder on the Mac, and both phones play it in sync.
- Play / pause / seek on either side stay in sync, including after a refresh or a late join.
- Netflix, Hotstar, Prime Video, JioCinema and similar apps: on a laptop, a Chrome
  extension syncs play / pause / seek of each person's own player and shows the chat beside
  it. On a phone, a "watch party" countdown helps both press play together, with chat in
  this app.
- Share a browser tab from a laptop for any non-DRM site that paste-link can't handle.
- Chat next to the video, usable on a phone (portrait and landscape) and on a laptop.
- Responsive UI that suits both laptop and phone.
- Only two people can access it. Anyone else who finds the URL gets nothing.
- No history, logs, or leftover files after a session.
- One command on the Mac starts everything and prints the link to open on the phones.

## Non-goals (v1)

- Streaming DRM content (Netflix, Hotstar, etc.) through the app or a screen share:
  impossible (black screen) and against their terms. Only sync of each person's own player.
- Exact sync with the Netflix / Hotstar **mobile apps**: those apps can't be controlled from
  outside, so mobile gets countdown sync only.
- Screen sharing from a phone (mobile browsers can't do it).
- Voice or video call (they use text chat).
- Cloud hosting, always-on availability when the Mac is off.
- Queues, playlists, multiple rooms, user accounts beyond the two of them.

## Anti-goals

- Anyone other than the two of them able to see the page, the chat, or any video byte.
- Any trace left on disk or in logs: URLs, titles, chat, downloaded media.
- Ads or the source site's player showing up.

## Constraints

- Builds on the existing repo: Node + Express 5 + socket.io, `public/index.html` + `public/client.js`.
- Mac has `ffmpeg`, `cloudflared`, Node 26. `yt-dlp` must be installed (`brew install yt-dlp`).
- Phones: iOS Safari and Android Chrome. iOS plays HLS natively; Android needs `hls.js`.
- Upload bandwidth of the home connection limits quality (two viewers × bitrate).
- No custom domain assumed, so Cloudflare Access (needs a domain) is optional, not required.

## Approaches considered

1. **Mac as server + Cloudflare quick tunnel (picked).** Free, home IP is rarely blocked by
   sites, `yt-dlp` and `ffmpeg` run locally. Needs the Mac on and awake while watching.
   Picked because Ashutosh said running the Mac as server is fine.
2. Cloud VPS, always on. Works with the Mac off, but costs monthly, datacenter IPs get
   blocked by YouTube and some sites, and bandwidth costs extra.
3. Free serverless room (Cloudflare Pages/Worker) + Mac as optional fetcher. More moving
   parts for little gain when the Mac is always the one running it anyway.

### For Netflix / Hotstar / other subscription apps

1. **Chrome extension that controls each person's own player (picked for laptop).** Same
   approach as Teleparty. Exact sync, both legal and within the apps' rules, each needs a
   subscription. Laptop only.
2. Re-streaming or screen sharing the video: rejected. DRM blacks it out and it breaks
   the apps' terms.
3. Countdown sync (picked for phone). The only option on mobile apps. Approximate (±1 s).

## Design

### Running it

- `npm start` starts the server and a Cloudflare **quick tunnel** (random
  `*.trycloudflare.com` URL, new each session), keeps the Mac awake (`caffeinate`) while
  running, and prints the URL (plus a QR code in the terminal for the phone).
- Ctrl+C stops server and tunnel and deletes all temp media.
- Config in a local, git-ignored `.env`: `ROOM_PASSWORD`, `MEDIA_DIR` (local library
  folder), optional `YTDLP_COOKIES_BROWSER` (e.g. `chrome`) for sites that need a login.

### Access control

- Login page asks for the room password. On success the server sets a signed, HttpOnly,
  Secure, SameSite=Strict session cookie.
- Every HTTP route (page, media, playlists, segments) and the socket.io handshake require
  that cookie. No cookie = 401, no content.
- Login is rate-limited (e.g. 5 failed tries per IP per 15 min).
- Room is capped at 2 simultaneous connections. A third is rejected. (A refresh replaces the
  same person's old socket rather than counting as a third.)
- Optional later: Cloudflare Access email allowlist if a domain is added.

### Playing a link ("paste link")

1. Either person pastes a URL. Server runs `yt-dlp` to resolve it, preferring formats phones
   can play without re-encoding: H.264 video + AAC audio, max 1080p (fall back to best
   available, with re-encode only if nothing compatible exists).
2. Server pipes the stream through `ffmpeg` (copy codecs) into an **HLS playlist + segments
   in a per-session temp folder**. Playback can start after the first few segments arrive,
   instead of waiting for a full download.
3. Both phones load the same playlist from the server: native HLS on iOS, `hls.js`
   elsewhere. The source site's player and ads are never loaded.
4. Seeking is instant within the part already fetched. Seeking ahead of it waits until
   that part arrives (fetching is normally faster than real time).
5. If `yt-dlp` can't handle the URL (DRM, unsupported, blocked), both see a clear error.
6. Starting a new video stops the old fetch and deletes its files.

### Playing a local file ("library")

- The server lists video files in `MEDIA_DIR`. Picking one loads it for both.
- MP4 with H.264/AAC is served directly with range requests (like today). Anything else
  (MKV, HEVC, AC3) goes through the same `ffmpeg`-to-HLS path, re-encoding only what phones
  can't play.
- Paths are validated so nothing outside `MEDIA_DIR` can be requested.

### Subscription apps on a laptop (Chrome extension)

- A small Chrome extension (Manifest V3, loaded unpacked, not published) that runs on
  Netflix, Hotstar, Prime Video, JioCinema and a generic "any site with a `<video>`" mode.
- It connects to the same server and room with the same password (stored in the
  extension).
- Per-site adapter controls play / pause / seek. Netflix needs its internal player API for
  seeking (setting `video.currentTime` directly breaks Netflix playback). Others use the
  page's `<video>` element.
- It also sends "which title / episode is open". If the two sides differ, both see a
  "she's on S2E4" prompt.
- A collapsible chat sidebar is injected into the page, sharing the same chat as the web app.
- Each person plays with their own logged-in account. No video passes through the server.

### Subscription apps on a phone (countdown)

- In the web app, choose "Watch on another app" and enter the title plus a time (e.g. 00:42:10).
  Both open that title in their own app, pause at that time, then either one taps **Start**.
  A synced 3-2-1 countdown plays on both, and they press play together.
- Chat stays in the web app. On a phone they switch between apps, or use picture-in-picture
  if the OTT app allows it.
- Mixed case: one on laptop with the extension, one on phone, works with the same
  countdown flow.

### Tab share (laptop only)

- From the web app on a laptop: "Share a tab". Chrome's tab capture with audio goes
  peer-to-peer over WebRTC to the other person (phone or laptop). The server only relays
  signalling. A public STUN server is used, and no TURN server in v1.
- For non-DRM sites where paste-link fails. DRM tabs show black, by design.

### Sync

- The server holds the room state: current media, `playing`, `position`, `updatedAt`,
  `version`.
- Clients send intents (play / pause / seek / load). The server applies them, bumps
  `version`, and broadcasts the new state. Clients apply state and ignore their own echoes
  by version, replacing the current 300 ms `suppress` timer.
- On join or refresh, the client gets the full state and jumps to
  `position + (now - updatedAt)` if playing.
- Small drift correction: if a client is more than ~1.5 s off while playing, it re-seeks.
- If one side is buffering, the other keeps playing. Optional: an auto-pause-while-buffering
  toggle is left to the builder.

### Chat

- Same socket. Messages kept in server memory (last ~200) so a refresh doesn't wipe them.
  Never written to disk; gone when the server stops.
- Shows "You" / "Her" style bubbles like today, plus a small online / typing indicator.

### Laptop UI

- Video large on the left, chat panel on the right (resizable / collapsible), source bar
  (paste link, library, share tab, other app) on top. Keyboard shortcuts: space, arrows, F.
- Fullscreen keeps a translucent chat overlay, the same as phone landscape.

### Phone UI

- Portrait: video on top, chat below (like today), with a bar above the video for paste
  link / library.
- Landscape: video fills the screen with a translucent chat overlay (last few messages plus
  an input that slides up), so chat works without leaving the player. Custom controls,
  because the iOS native fullscreen player hides any overlay.
- A **panic button** stops playback and blanks the screen for both.

### Privacy

- No request logging, no URL or title logging. Server console prints only the start-up URL
  and errors without URLs.
- All temp media in one OS temp folder, wiped on new media, on stop, and at startup
  (in case of a crash).
- HTTPS via Cloudflare tunnel end to end to the phone.
- `.env` and temp folders are git-ignored.

## Left to the builder

- Exact `yt-dlp` format selector and `ffmpeg` flags.
- Session cookie signing library (or a small HMAC helper).
- Rate-limit implementation.
- Visual polish of the UI, as long as the portrait/landscape behaviour above holds.
- How to print the QR code (small npm lib or `qrencode`).

## Calls made without asking (check these)

- Quick tunnel with a new random URL each session rather than a fixed domain.
- Password gate as the main lock; Cloudflare Access only if a domain is added later.
- HLS remux pipeline for links instead of waiting for full downloads.
- Chat kept in memory only; lost when the server stops.
- Tab sharing from a laptop only. No TURN server, so a few strict networks may fail to
  connect for tab share. Paste-link and library aren't affected.
- Netflix / Hotstar on a laptop via an unpublished Chrome extension you load yourself, and
  on a phone via countdown only.
- Extension adapters for Netflix, Hotstar, Prime Video, JioCinema, plus a generic `<video>`
  mode. Other apps can be added later.
