const test = require("node:test");
const assert = require("node:assert");
const { createHistory } = require("../src/history");

test("records items when switching, newest first, without URLs in the list", () => {
  const h = createHistory();
  const a = { id: "1", kind: "hls", title: "Trailer", duration: 600 };
  const b = { id: "2", kind: "file", title: "movie.mkv", duration: 7200 };
  h.attach(a, { type: "link", url: "https://www.youtube.com/watch?v=x" });
  h.attach(b, { type: "file", path: "movie.mkv" });
  h.record(a, 125);
  const l = h.list(b, 30);
  assert.equal(l[0].current, true);
  assert.equal(l[0].title, "movie.mkv");
  assert.equal(l[1].title, "Trailer");
  assert.equal(l[1].position, 125);
  assert.equal(l[1].site, "youtube.com");
  assert.ok(!JSON.stringify(l).includes("watch?v="), "no URL leaks to clients");
  assert.equal(h.get(l[1].key).source.url, "https://www.youtube.com/watch?v=x");
});

test("re-watching moves an item to the top and updates its position; finished resets", () => {
  const h = createHistory();
  const a = { id: "1", title: "A", duration: 100 };
  const a2 = { id: "3", title: "A", duration: 100 };
  h.attach(a, { type: "file", path: "a.mp4" });
  h.attach(a2, { type: "file", path: "a.mp4" });
  h.record(a, 40);
  h.record({ id: "x" }, 5); // unknown source ignored
  h.record(a2, 98);
  const l = h.list(null, 0);
  assert.equal(l.length, 1);
  assert.equal(l[0].position, 0);
});

test("shares and unknown media are not recorded; clear empties", () => {
  const h = createHistory();
  h.record({ id: "s", kind: "share" }, 10);
  assert.equal(h.list(null, 0).length, 0);
  const m = { id: "e", title: "Panchayat" };
  h.attach(m, { type: "external", title: "Panchayat" });
  h.record(m, 750);
  assert.equal(h.list(null, 0)[0].position, 750);
  h.clear();
  assert.equal(h.list(null, 0).length, 0);
});
