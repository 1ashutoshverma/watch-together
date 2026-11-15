// Panic: pauses and blanks both screens. Double tap (or Escape twice) brings it back.
export function createPanic({ socket, video }) {
  const cover = document.getElementById("panicCover");
  let lastTap = 0;

  function blank() {
    try {
      video.pause();
    } catch {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.body.classList.remove("theatre");
    cover.hidden = false;
    document.title = "Notes";
  }
  function restore() {
    cover.hidden = true;
    document.title = "Just us";
  }

  document.getElementById("panicBtn").addEventListener("click", () => socket.emit("panic"));
  socket.on("panic", blank);
  cover.addEventListener("click", () => {
    const t = Date.now();
    if (t - lastTap < 400) restore();
    lastTap = t;
  });
  document.addEventListener("keydown", (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName || "");
    if (!typing && (e.key === "p" || e.key === "P") && cover.hidden) socket.emit("panic");
    else if (e.key === "Escape" && !cover.hidden) {
      const t = Date.now();
      if (t - lastTap < 600) restore();
      lastTap = t;
    }
  });
}
