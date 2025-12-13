Perfect 👍
Below is a **clean, copy-paste friendly README.md** you can keep in your repo to **remember everything** — setup, run, conversion, Cloudflare tunnel, and common fixes.

You can save this exactly as **`README.md`**.

---

# 🎬 Watch Together (Local → Online)

A lightweight **Watch Together** app to stream a **local movie file**, sync play/pause/seek, and chat in real-time — **no DB, no cloud storage**, just local + tunnel.

Supports:

- 2 users
- Real-time sync
- Real-time chat
- Mobile & desktop
- Cloudflare Tunnel for internet access

---

## 📦 Prerequisites

- **Node.js** ≥ 18
- **npm**
- **Ubuntu / Linux / macOS / Windows**
- **FFmpeg** (for video/audio compatibility)
- Internet connection (for Cloudflare Tunnel)

---

## 📁 Project Structure

```
watch-together/
├── server.js
├── movie_hindi.mp4        # final playable video
├── public/
│   ├── index.html
│   └── client.js
└── README.md
```

---

## 🚀 1. Install Dependencies

### Node dependencies

```bash
npm install express socket.io
```

---

## ▶️ 2. Run the App Locally

```bash
node server.js
```

Open in browser:

```
http://localhost:3000
```

At this stage:

- Video plays locally
- Chat works
- Sync works

---

## 🌍 3. Make It Online (Cloudflare Tunnel)

### ✅ Install Cloudflared (Ubuntu)

```bash
sudo apt update
sudo apt install -y curl
```

Add Cloudflare repo:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
```

Install:

```bash
sudo apt update
sudo apt install cloudflared
```

Verify:

```bash
cloudflared --version
```

---

### ▶️ Start Cloudflare Tunnel

**In a new terminal (keep server running):**

```bash
cloudflared tunnel --url http://localhost:3000
```

You will get a URL like:

```
https://random-name.trycloudflare.com
```

👉 Share this URL with your friend.

📌 Stop tunnel = app goes offline
📌 Stop Node server = stream stops

---

## 🎥 4. Video Format (IMPORTANT)

### ❌ MKV with AC3/DTS audio will NOT play audio in browser

Browsers **do not support AC3 / DTS audio**.

You **must convert audio to AAC**.

---

## 🔍 Check Video Audio Codec

```bash
ffprobe movie.mkv
```

If you see:

```
Audio: ac3
Audio: dts
```

➡️ Conversion required ✅

---

## 🔄 Convert Video (FAST & SAFE)

### ✅ Convert MKV → MP4 (Hindi only, browser-safe)

```bash
ffmpeg -threads 2 -i movie.mkv \
-map 0:v:0 \
-map 0:a:m:language:hin \
-c:v copy \
-c:a aac \
-ac 2 \
-b:a 160k \
-movflags faststart \
movie_hindi.mp4
```

### ⏱ Time taken

- 2–4 hour movie → **~1–3 minutes**
- Video is NOT re-encoded
- Only audio is converted

---

## 🧪 Test Converted Video

```bash
google-chrome movie_hindi.mp4
```

If audio plays here → app will work 100%.

---

## ⚙️ Update Server Video Path

In `server.js`:

```js
const videoPath = path.join(__dirname, "movie_hindi.mp4");
```

Restart server:

```bash
node server.js
```

---

## 📱 Mobile UX Notes (Expected Behavior)

- Video stays fixed
- Chat scrolls independently
- Keyboard opens → chat moves, video does NOT
- Enter key sends message
- Keyboard closes naturally after send (no force focus)

This matches WhatsApp / Discord behavior.

---

## 🎛️ Common Commands (Quick Reference)

### Start app

```bash
node server.js
```

### Start tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

### Stop tunnel

```
Ctrl + C
```

### Convert video

```bash
ffmpeg -i movie.mkv -map 0:v -map 0:a -c:v copy -c:a aac movie.mp4
```

---

## ⚠️ Cloudflare Tunnel Limits (Quick Tunnel)

- No hard time limit
- Usually stable for **hours**
- Not guaranteed for days
- Perfect for **temporary watch sessions**

For long-running usage → use **named tunnel** (optional).

---

## ✅ Best Practices

- Do NOT keep tunnel running 24/7
- Do NOT share URL publicly
- Limit users to 2
- Stop tunnel after movie
- Use MP4 + AAC only

---

## 🏁 Summary

✔ Local video
✔ Online streaming via Cloudflare
✔ No cloud storage
✔ No DB
✔ No cost
✔ Private & temporary

---

## 🧠 Built for

- Learning
- Personal use
- Movie night with a friend
- Engineering experimentation

---

If you want, next we can add:

- Room codes
- Password protection
- Auto shutdown
- Electron desktop build
- PWA install support

Just tell me 👌
