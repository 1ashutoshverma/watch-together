// 3-2-1 countdown shared by both devices, for apps that can't be controlled (Netflix/Hotstar on phones).
import { serverNow } from "./clock.js";

export function createCountdown({ socket }) {
  const box = document.getElementById("countdown");
  let timer = null;

  function buzz(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {}
  }

  function show(text, word = false) {
    box.hidden = false;
    box.textContent = text;
    box.classList.toggle("word", word);
  }

  function run({ action, at }) {
    clearInterval(timer);
    if (action === "pause") {
      show("Pause", true);
      buzz([200, 80, 200]);
      setTimeout(() => (box.hidden = true), 1500);
      return;
    }
    let last = null;
    timer = setInterval(() => {
      const left = at - serverNow();
      if (left <= 0) {
        clearInterval(timer);
        show("Play", true);
        buzz(300);
        setTimeout(() => (box.hidden = true), 1200);
        return;
      }
      const n = Math.ceil(left / 1000);
      if (n !== last && n <= 3) {
        last = n;
        show(String(n));
        buzz(60);
      } else if (n > 3 && last === null) show("Get ready", true);
    }, 50);
  }

  socket.on("countdown", run);
  document.getElementById("cdPlay").addEventListener("click", () => socket.emit("countdown", { action: "play" }));
  document.getElementById("cdPause").addEventListener("click", () => socket.emit("countdown", { action: "pause" }));
  document.getElementById("extStop").addEventListener("click", () => socket.emit("stop-media"));
}
