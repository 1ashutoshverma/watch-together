const crypto = require("crypto");

const MAX_PEOPLE = 2;
const CHAT_LIMIT = 200;

function createRoom({ now = Date.now } = {}) {
  const sockets = new Map(); // socketId -> name
  const messages = [];
  let state = { media: null, playing: false, position: 0, updatedAt: now(), version: 0 };

  function online() {
    return [...new Set(sockets.values())];
  }

  function join(name, socketId) {
    const people = online();
    if (!people.includes(name) && people.length >= MAX_PEOPLE) return { ok: false, error: "room-full" };
    sockets.set(socketId, name);
    return { ok: true };
  }

  function leave(socketId) {
    sockets.delete(socketId);
  }

  function currentPosition() {
    if (!state.playing) return state.position;
    return state.position + (now() - state.updatedAt) / 1000;
  }

  function commit(patch) {
    state = { ...state, ...patch, updatedAt: now(), version: state.version + 1 };
    return snapshot();
  }

  function snapshot() {
    return { ...state };
  }

  function applyIntent({ type, position }) {
    if (!state.media) return snapshot();
    let pos = Number(position);
    if (!Number.isFinite(pos) || pos < 0) pos = 0;
    if (type === "play") return commit({ playing: true, position: pos });
    if (type === "pause") return commit({ playing: false, position: pos });
    if (type === "seek") return commit({ position: pos });
    return snapshot();
  }

  function setMedia(media) {
    return commit({ media: media ? { ...media } : null, playing: false, position: 0 });
  }

  function stateForJoin() {
    return { ...state, position: currentPosition(), updatedAt: now() };
  }

  // payload: a string (text) or {text} or {kind: "image"|"gif", src, w, h}
  function addChat(name, payload) {
    const p = typeof payload === "string" ? { text: payload } : payload || {};
    let msg;
    if (p.kind === "image" || p.kind === "gif") {
      if (typeof p.src !== "string") return null;
      msg = { id: crypto.randomUUID(), name, kind: p.kind, src: p.src, w: p.w || null, h: p.h || null, at: now() };
    } else {
      const t = String(p.text || "").trim().slice(0, 1000);
      if (!t) return null;
      msg = { id: crypto.randomUUID(), name, text: t, at: now() };
    }
    messages.push(msg);
    if (messages.length > CHAT_LIMIT) messages.splice(0, messages.length - CHAT_LIMIT);
    return msg;
  }

  return { join, leave, online, applyIntent, setMedia, stateForJoin, addChat, chat: () => [...messages], get media() { return state.media; } };
}

module.exports = { createRoom, MAX_PEOPLE };
