// Keeps the local <video> matched to the room state and turns local actions into intents.
import { serverNow } from "./clock.js";

const MATCH_TOLERANCE = 1.0;
const DRIFT_LIMIT = 1.5;

export function createSync({ video, socket, onNeedTap }) {
  let state = null;
  let applying = 0;
  let enabled = false;

  function expectedPosition() {
    if (!state) return 0;
    if (!state.playing) return state.position;
    return state.position + Math.max(0, serverNow() - state.updatedAt) / 1000;
  }

  function matches() {
    if (!state) return true;
    return video.paused === !state.playing && Math.abs(video.currentTime - expectedPosition()) < MATCH_TOLERANCE;
  }

  function guard(fn) {
    applying++;
    try {
      fn();
    } finally {
      setTimeout(() => applying--, 250);
    }
  }

  async function apply() {
    if (!enabled || !state || video.readyState < 1) return;
    const want = expectedPosition();
    if (Math.abs(video.currentTime - want) > MATCH_TOLERANCE) guard(() => (video.currentTime = want));
    if (state.playing && video.paused) {
      applying++;
      try {
        await video.play();
        onNeedTap(false);
      } catch {
        onNeedTap(true);
      } finally {
        setTimeout(() => applying--, 250);
      }
    } else if (!state.playing && !video.paused) {
      guard(() => video.pause());
    }
  }

  function emit(type) {
    if (!enabled || applying > 0 || matches()) return;
    socket.emit("intent", { type, position: video.currentTime });
  }

  video.addEventListener("play", () => emit("play"));
  video.addEventListener("pause", () => {
    // Ignore the pause browsers fire when a video ends or the source is swapped.
    if (video.ended || video.readyState < 2) return;
    emit("pause");
  });
  video.addEventListener("seeked", () => emit("seek"));
  video.addEventListener("loadedmetadata", apply);
  video.addEventListener("canplay", apply);

  setInterval(() => {
    if (!enabled || !state || !state.playing || video.paused || video.seeking || video.readyState < 3) return;
    if (Math.abs(video.currentTime - expectedPosition()) > DRIFT_LIMIT) guard(() => (video.currentTime = expectedPosition()));
  }, 2000);

  return {
    setState(s, { videoMode }) {
      state = s;
      enabled = videoMode;
      apply();
    },
    tapToSync() {
      onNeedTap(false);
      apply();
    },
    expectedPosition,
  };
}
