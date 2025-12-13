const socket = io();
const ROOM = "private-room";

const video = document.getElementById("video");
const chatBox = document.getElementById("chat");
const msgInput = document.getElementById("msg");

let suppress = false;

socket.emit("join-room", ROOM);

// --- VIDEO SYNC ---
video.addEventListener("play", () => emit("play"));
video.addEventListener("pause", () => emit("pause"));
video.addEventListener("seeked", () => emit("seek"));

function emit(type) {
  if (suppress) return;
  socket.emit("video-event", {
    type,
    time: video.currentTime,
  });
}

socket.on("video-event", ({ type, time }) => {
  suppress = true;
  video.currentTime = time;
  if (type === "play") video.play();
  if (type === "pause") video.pause();
  setTimeout(() => (suppress = false), 300);
});

// --- CHAT ---
function send() {
  const msg = msgInput.value;
  if (!msg) return;
  addMsg("You", msg);
  socket.emit("chat", msg);
  msgInput.value = "";

  setTimeout(() => {
    msgInput.focus();
  }, 0);
}

socket.on("chat", (msg) => addMsg("Friend", msg));

function addMsg(user, msg) {
  const div = document.createElement("div");
  div.classList.add("msg");

  if (user === "You") {
    div.classList.add("me");
  } else {
    div.classList.add("friend");
  }

  div.textContent = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
