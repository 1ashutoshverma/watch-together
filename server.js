const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const ROOM_ID = "private-room"; // simple guard

app.use(express.static("public"));

// Stream local movie with range support (IMPORTANT)
app.get("/video", (req, res) => {
  const videoPath = path.join(__dirname, "movie_hindi.mp4");
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const mimeType = "video/mp4";

  if (!range) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mimeType,
    });
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  const chunkSize = end - start + 1;
  const file = fs.createReadStream(videoPath, { start, end });

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": mimeType,
  });

  file.pipe(res);
});

// WebSocket logic
io.on("connection", (socket) => {
  socket.on("join-room", (room) => {
    if (room !== ROOM_ID) return;
    socket.join(room);
  });

  socket.on("video-event", (data) => {
    socket.to(ROOM_ID).emit("video-event", data);
  });

  socket.on("chat", (msg) => {
    socket.to(ROOM_ID).emit("chat", msg);
  });
});

server.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});
