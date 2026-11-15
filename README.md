# Watch Together

A self-hosted, private watch room. One Mac acts as the host, and participants join from a phone
or laptop through a secure link. Playback stays in sync across the room, with chat alongside
the video.

Videos can come from a pasted link (YouTube and most video sites), the host's own movie folder,
or a shared browser tab. Subscription services such as Netflix, Hotstar, Prime Video and
JioCinema are kept in sync on each participant's own account through a companion Chrome extension.

---

## Features

**Playback**
- **Paste a link**: plays videos from YouTube and most video sites, without site ads.
- **Library**: streams files from a folder on the host. MKV, HEVC and other formats are converted
  as they play.
- **YouTube**: in-app search, *Up next* suggestions from YouTube's own autoplay mix, and an
  autoplay countdown when a video ends.
- **Share a tab** (laptop): live picture and sound from any non-DRM browser tab, sent
  peer-to-peer.
- **Subscription services**: a Chrome extension keeps Netflix, Hotstar, Prime Video and JioCinema
  in sync on laptops. Phones use a shared 3-2-1 countdown.
- **Sync**: play, pause and seek apply to everyone. Late joiners and page refreshes land at the
  current position.
- **Session history**: everything played is listed with its last position and can be resumed,
  including a one-tap *Back to previous*.

**Chat**
- Messages, emoji, GIF search (optional) and photo sharing in a single panel.
- Floating chat over the video in full-screen and landscape modes.
- Stays pinned to the newest message, with a *New messages* indicator when reading back.

**Interface**
- Responsive layouts for phone and laptop. On phones the video stays in place when the keyboard
  opens.
- Two full-screen modes: video full screen with floating chat, and app full screen that hides
  the browser UI. On iPhone, this is available by adding the app to the Home Screen.
- A single menu for all actions, including a control that pauses and blanks every screen.

**Privacy & security**
- Password-protected room with rate-limited sign-in and a cap of two participants.
- The server listens only on `127.0.0.1`. Remote access is through an HTTPS Cloudflare tunnel
  with a new random URL each session.
- No logging. Chat, history and uploads live in memory or temporary storage and are deleted when
  the server stops.
- Link resolution, GIF search and YouTube thumbnails are fetched by the host, so participants'
  devices never contact those services directly.

---

## Requirements

- macOS with [Homebrew](https://brew.sh)
- Node.js 18+, `ffmpeg`, `yt-dlp`, `cloudflared`
- Google Chrome, for the optional companion extension

## Installation

```bash
brew install node ffmpeg yt-dlp cloudflared
git clone https://github.com/1ashutoshverma/watch-together.git
cd watch-together
npm install
cp .env.example .env
```

Edit `.env` and set at least `ROOM_PASSWORD`.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ROOM_PASSWORD` | random, printed at start | Password required to join the room. |
| `MEDIA_DIR` | `~/Movies` | Folder shown in **Library**. |
| `PORT` | `3000` | Local port the tunnel points to. |
| `GIPHY_API_KEY` | none | Enables GIF search. Free key from [developers.giphy.com](https://developers.giphy.com). |
| `YTDLP_COOKIES_BROWSER` | none | Browser to read cookies from (for example `chrome`) for videos that require sign-in. |
| `NO_TUNNEL` | none | Set to `1` to run locally without a public link. |

## Usage

```bash
npm start        # start the server and a secure tunnel
npm run local    # local only, at http://localhost:3000
```

On start, the terminal prints the room link and a QR code. Share the link with participants;
they sign in with a display name and the room password. The link changes every session.

The host Mac must stay on and online while the room is in use; `npm start` prevents sleep
automatically. Press `Ctrl+C` to stop the server. Temporary files are removed on exit.

### What can be played

| Source | How | Laptop | Phone |
|---|---|---|---|
| YouTube and most video sites | Menu → *Paste a link* / *Search YouTube* | Synced | Synced |
| Files on the host | Menu → *Library* | Synced | Synced |
| Netflix, Hotstar, Prime Video, JioCinema | Companion extension | Exact sync | Countdown sync |
| Any non-DRM browser tab | Menu → *Share a tab* | Shares and watches | Watches |

Subscription services are DRM-protected. They can't be streamed through the room or
screen-shared; each participant plays them on their own account while the room keeps time.

### Companion Chrome extension

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select
   the `extension` folder.
2. Open the extension popup and enter the room link, a display name and the room password.
   Repeat this each session, since the link changes.
3. Open the title on a supported service and choose **Sync this tab** in the sidebar.
   Participants with the extension on the same service follow play, pause and seek.
4. For participants on phones, use **Play together** / **Pause together** to run a synced
   countdown.

### Controls

| Action | Where |
|---|---|
| Video full screen with chat | Corner button, `F`, or rotate the phone |
| Hide browser UI | Menu → *Hide browser bars* (iPhone: Share → *Add to Home Screen*) |
| Up next and YouTube search | Corner list button while YouTube is playing |
| History and resume | Menu → *Back to previous* / *Watched tonight*, or *Continue watching* on the start screen |
| Pause and blank every screen | Menu → *Panic*, or `P` on a laptop. Double-tap to restore. |
| Play/pause, skip 10 s | `Space`, `←` / `→` on a laptop |

Mobile browsers need one tap before they play audio on their own. If a phone shows
**Tap to sync**, tap it once.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "This video needs a login" | Sign in to the site in Chrome on the host, set `YTDLP_COOKIES_BROWSER=chrome`, and restart. |
| A site or YouTube search stops working | Run `brew upgrade yt-dlp`. Sites change often. |
| Seek bar is short at first | Links are fetched in the background, and the bar grows as more arrives. |
| Tab sharing won't connect | Some restrictive networks block peer-to-peer connections. Links and Library still work. |
| GIF search is unavailable | Add `GIPHY_API_KEY` to `.env` and restart. Photo sharing works without it. |

## Development

```bash
npm test         # unit and integration tests (node:test; requires ffmpeg)
```

| Path | Responsibility |
|---|---|
| `server.js` | Startup, tunnel, sleep prevention, cleanup |
| `src/app.js` | HTTP routes and middleware |
| `src/auth.js` | Sign-in, signed session tokens, rate limiting |
| `src/room.js` | Playback state, chat, participant cap |
| `src/sockets.js` | Real-time events, media switching, autoplay |
| `src/history.js` | Session history and resume points |
| `src/media/` | yt-dlp + ffmpeg → HLS pipeline, library, media routes |
| `src/youtube.js` | YouTube search, Up next, thumbnail proxy |
| `src/chatmedia.js` | Photo uploads and GIF search proxy |
| `public/` | Web client |
| `extension/` | Chrome MV3 companion extension |

## License

ISC
