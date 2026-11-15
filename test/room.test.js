const test = require("node:test");
const assert = require("node:assert");
const { createRoom } = require("../src/room");

test("third distinct name rejected, same name multi-socket ok", () => {
  const room = createRoom();
  assert.equal(room.join("A", "s1").ok, true);
  assert.equal(room.join("A", "s2").ok, true);
  assert.equal(room.join("A", "s3").ok, true);
  assert.equal(room.join("B", "s4").ok, true);
  const r = room.join("C", "s5");
  assert.equal(r.ok, false);
  assert.equal(r.error, "room-full");
  assert.deepEqual(room.online().sort(), ["A", "B"]);
});

test("leaving frees slot only when last socket of a name leaves", () => {
  const room = createRoom();
  room.join("A", "s1");
  room.join("A", "s2");
  room.join("B", "s3");
  room.leave("s1");
  assert.equal(room.join("C", "s4").ok, false);
  room.leave("s2");
  assert.equal(room.join("C", "s4").ok, true);
});

test("applyIntent bumps version and sets fields", () => {
  let t = 0;
  const room = createRoom({ now: () => t });
  room.setMedia({ id: "m1", kind: "hls" });
  const v0 = room.stateForJoin().version;
  const s = room.applyIntent({ type: "play", position: 5 });
  assert.equal(s.playing, true);
  assert.equal(s.position, 5);
  assert.ok(s.version > v0);
  const p = room.applyIntent({ type: "pause", position: 7 });
  assert.equal(p.playing, false);
  const k = room.applyIntent({ type: "seek", position: 30 });
  assert.equal(k.position, 30);
  assert.equal(k.playing, false);
});

test("stateForJoin advances position while playing", () => {
  let t = 1000;
  const room = createRoom({ now: () => t });
  room.setMedia({ id: "m1", kind: "hls" });
  room.applyIntent({ type: "play", position: 5 });
  t = 11000;
  assert.equal(room.stateForJoin().position, 15);
  room.applyIntent({ type: "pause", position: 15 });
  t = 50000;
  assert.equal(room.stateForJoin().position, 15);
});

test("intent ignored without media; setMedia resets", () => {
  const room = createRoom();
  const s = room.applyIntent({ type: "play", position: 3 });
  assert.equal(s.playing, false);
  room.setMedia({ id: "x", kind: "file" });
  room.applyIntent({ type: "play", position: 9 });
  const r = room.setMedia({ id: "y", kind: "file" });
  assert.equal(r.playing, false);
  assert.equal(r.position, 0);
});

test("chat capped at 200 and text trimmed", () => {
  const room = createRoom();
  for (let i = 0; i < 250; i++) room.addChat("A", "m" + i);
  assert.equal(room.chat().length, 200);
  assert.equal(room.chat()[0].text, "m50");
  assert.equal(room.addChat("A", "x".repeat(5000)).text.length, 1000);
  assert.equal(room.addChat("A", "   "), null);
});

test("bad positions are sanitized", () => {
  const room = createRoom();
  room.setMedia({ id: "m", kind: "hls" });
  assert.equal(room.applyIntent({ type: "seek", position: -4 }).position, 0);
  assert.equal(room.applyIntent({ type: "seek", position: "abc" }).position, 0);
});

test("chat accepts image/gif payloads and rejects empty", () => {
  const room = createRoom();
  const m = room.addChat("A", { kind: "gif", src: "/gif/abc", w: 200, h: 150 });
  assert.equal(m.kind, "gif");
  assert.equal(m.src, "/gif/abc");
  assert.equal(room.addChat("A", { kind: "image" }), null);
  assert.equal(room.addChat("A", { text: "hi" }).text, "hi");
});
