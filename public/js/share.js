// Tab / screen share over WebRTC. The server only relays signalling; video goes device to device.
const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

export function canShare() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

export function createShare({ socket, player, onError }) {
  let stream = null;
  const peers = new Map(); // peerId -> RTCPeerConnection
  let viewing = null; // media id currently being viewed

  function closePeers() {
    for (const pc of peers.values()) pc.close();
    peers.clear();
  }

  function newPeer(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    peers.set(peerId, pc);
    pc.onicecandidate = (e) => e.candidate && socket.emit("rtc", { to: peerId, data: { candidate: e.candidate } });
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        peers.delete(peerId);
        if (pc.connectionState === "failed") onError("Couldn't connect the screen share. One of the networks may be blocking it.");
      }
    };
    return pc;
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      });
    } catch {
      return;
    }
    stream.getVideoTracks()[0].contentHint = "motion";
    stream.getVideoTracks()[0].addEventListener("ended", stop);
    socket.emit("share-start");
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    closePeers();
    socket.emit("share-stop");
  }

  // Sharer: a viewer asked for the stream.
  socket.on("share-want", async ({ from }) => {
    if (!stream) return;
    peers.get(from)?.close();
    const pc = newPeer(from);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) {
      const p = sender.getParameters();
      p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = 4_500_000;
      p.degradationPreference = "maintain-resolution";
      sender.setParameters(p).catch(() => {});
    }
    await pc.setLocalDescription(await pc.createOffer());
    socket.emit("rtc", { to: from, data: { sdp: pc.localDescription } });
  });

  socket.on("rtc", async ({ from, data }) => {
    let pc = peers.get(from);
    if (data.sdp && data.sdp.type === "offer") {
      if (pc) pc.close();
      pc = newPeer(from);
      pc.ontrack = (e) => player.setStream(viewing, e.streams[0]);
      await pc.setRemoteDescription(data.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit("rtc", { to: from, data: { sdp: pc.localDescription } });
    } else if (data.sdp && pc) {
      await pc.setRemoteDescription(data.sdp);
    } else if (data.candidate && pc) {
      await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  });

  return {
    start,
    stop,
    isSharing: () => !!stream,
    // Viewer: called when the room switches to a share from someone else.
    view(media) {
      if (viewing === media.id) return;
      viewing = media.id;
      closePeers();
      socket.emit("share-want");
    },
    leaveView() {
      viewing = null;
      if (!stream) closePeers();
    },
  };
}
