// Runs in the page's own JS world so it can reach site player APIs (Netflix needs this for seeking).
(() => {
  if (window.__justUsPage) return;
  window.__justUsPage = true;
  const TAG = "just-us";
  const host = location.hostname;
  const site = /netflix/.test(host) ? "netflix" : /hotstar/.test(host) ? "hotstar" : /primevideo|amazon\./.test(host) ? "prime" : /jiocinema/.test(host) ? "jiocinema" : /sonyliv/.test(host) ? "sonyliv" : /zee5/.test(host) ? "zee5" : /youtube/.test(host) ? "youtube" : host;

  function bestVideo() {
    const vids = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 || v.currentSrc);
    if (!vids.length) return null;
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight || (b.duration || 0) - (a.duration || 0))[0];
  }

  function netflixPlayer() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const id = vp.getAllPlayerSessionIds().find((s) => s.startsWith("watch")) || vp.getAllPlayerSessionIds()[0];
      return id ? vp.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }

  function title() {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      return el && el.textContent.trim();
    };
    if (site === "netflix") {
      const t = pick("[data-uia='video-title']");
      if (t) return t.replace(/\s+/g, " ");
      const m = location.pathname.match(/watch\/(\d+)/);
      return m ? `Netflix ${m[1]}` : document.title;
    }
    if (site === "prime") return pick(".atvwebplayersdk-title-text") || document.title;
    return document.title.replace(/\s*[-|]\s*(Disney\+ ?Hotstar|JioHotstar|Hotstar|JioCinema|YouTube|Prime Video|SonyLIV|ZEE5).*$/i, "").trim() || document.title;
  }

  const adapter = {
    ready() {
      return site === "netflix" ? !!netflixPlayer() || !!bestVideo() : !!bestVideo();
    },
    get() {
      const v = bestVideo();
      if (site === "netflix") {
        const p = netflixPlayer();
        if (p) return { t: p.getCurrentTime() / 1000, paused: p.isPaused(), title: title() };
      }
      return v ? { t: v.currentTime, paused: v.paused, title: title() } : null;
    },
    play() {
      if (site === "netflix" && netflixPlayer()) return netflixPlayer().play();
      const v = bestVideo();
      if (v) v.play().catch(() => {});
    },
    pause() {
      if (site === "netflix" && netflixPlayer()) return netflixPlayer().pause();
      const v = bestVideo();
      if (v) v.pause();
    },
    seek(sec) {
      if (site === "netflix" && netflixPlayer()) return netflixPlayer().seek(Math.round(sec * 1000));
      const v = bestVideo();
      if (v) v.currentTime = sec;
    },
  };

  function send(type, data) {
    window.postMessage({ source: TAG, dir: "toContent", type, data }, "*");
  }

  // Report player events. Re-attach when sites swap the <video> element between episodes.
  let attached = null;
  const onEvent = (e) => send("player-event", { event: e.type, state: adapter.get() });
  setInterval(() => {
    const v = bestVideo();
    if (v !== attached) {
      if (attached) ["play", "pause", "seeked"].forEach((ev) => attached.removeEventListener(ev, onEvent));
      attached = v;
      if (v) ["play", "pause", "seeked"].forEach((ev) => v.addEventListener(ev, onEvent));
      send("player-ready", { ready: !!v, site, state: adapter.get() });
    }
  }, 1000);

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== TAG || m.dir !== "toPage") return;
    try {
      if (m.type === "get") send("reply", { id: m.id, state: adapter.get(), site });
      else if (m.type === "play") adapter.play();
      else if (m.type === "pause") adapter.pause();
      else if (m.type === "seek") adapter.seek(m.data);
    } catch (err) {
      send("error", String(err && err.message));
    }
  });
})();
