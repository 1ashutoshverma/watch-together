// Emoji picker data. Kept small and local (no external requests).
export const EMOJI = [
  { key: "smileys", label: "😀", name: "Smileys", list: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 😌 😔 😪 🤤 😴 😷 🤒 🤢 🤮 🥵 🥶 🥴 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖" },
  { key: "love", label: "❤️", name: "Love", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 ❤️‍🔥 ❤️‍🩹 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💋 💌 😻 😽 🫶 🥰 😘 💑 💏 👩‍❤️‍👨 👨‍❤️‍👨 👩‍❤️‍👩 🌹 🌷 💐 🌸 🥂 🍷 🕯️ 🔥 ✨ 💫 ⭐ 🌙 🧸 🎀" },
  { key: "hands", label: "👍", name: "Hands", list: "👍 👎 👏 🙌 👐 🤲 🤝 🙏 ✌️ 🤞 🫰 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🫵 🫣 🫠 🙈 🙉 🙊 💅 👀 👁️ 👅 👄" },
  { key: "movie", label: "🍿", name: "Movie night", list: "🍿 🎬 🎥 📺 🎞️ 🎟️ 🛋️ 🛏️ 🌃 🌧️ ☔ ☕ 🍵 🧋 🥤 🍺 🍻 🍾 🍕 🍔 🍟 🌮 🌯 🍣 🍜 🍝 🍛 🍩 🍪 🎂 🍰 🍫 🍦 🍓 🍉 🥭 🎉 🎊 🎈 🎁 🎮 🎧 🎵 🎶" },
  { key: "animals", label: "🐶", name: "Animals", list: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🦈 🐘 🦒 🐈 🐕 🐾" },
  { key: "symbols", label: "💯", name: "Symbols", list: "💯 ✅ ❌ ❓ ❗ ‼️ ⁉️ 💤 💢 💥 💦 💨 🕳️ 💬 💭 🗯️ 🔔 🔕 📌 ⏰ ⏳ 🔞 🆗 🆒 🆕 🆙 ➕ ➖ ✖️ ♾️ 💲 ©️ ®️ ™️" },
].map((c) => ({ ...c, items: c.list.split(" ") }));

const RECENT_KEY = "wt-recent-emoji";
export function recentEmoji() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 24);
  } catch {
    return [];
  }
}
export function rememberEmoji(e) {
  try {
    const list = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

// True when a message is just 1–3 emoji (shown large, without a bubble).
const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
export function isJumbo(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40 || !/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️⃣\s]+$/u.test(t) || /^[\d#*\s]+$/.test(t)) return false;
  const n = seg ? [...seg.segment(t.replace(/\s/g, ""))].length : t.replace(/\s/g, "").length / 2;
  return n >= 1 && n <= 3;
}
