// Wraps the <video> element: HLS (hls.js or native), plain files, and live MediaStreams.
let hls = null;
let hlsLoader = null;

function loadHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoader)
    hlsLoader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/hls.min.js";
      s.onload = () => resolve(window.Hls);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  return hlsLoader;
}

export function createPlayer(video) {
  let currentId = null;

  function reset() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
    currentId = null;
  }

  async function setSource(media) {
    if (!media) return reset();
    if (media.id === currentId) return;
    reset();
    currentId = media.id;
    video.controls = true;
    if (media.kind === "file") {
      video.src = media.src;
      return;
    }
    if (media.kind === "hls") {
      const Hls = await loadHlsJs().catch(() => null);
      if (currentId !== media.id) return;
      if (Hls && Hls.isSupported()) {
        hls = new Hls({
          startPosition: 0,
          liveMaxLatencyDurationCount: Infinity,
          liveSyncDurationCount: 3,
          maxBufferLength: 60,
          backBufferLength: 120,
          fragLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
        });
        hls.loadSource(media.src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = media.src;
      }
    }
  }

  function setStream(id, stream, onBlocked) {
    reset();
    currentId = id;
    video.srcObject = stream;
    video.controls = false;
    video.play().catch((e) => e && e.name === "NotAllowedError" && onBlocked && onBlocked());
  }

  return { setSource, setStream, reset, get id() { return currentId; } };
}
