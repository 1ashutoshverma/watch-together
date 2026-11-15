const test = require("node:test");
const assert = require("node:assert");
const { youtubeId, toItems, createYouTube } = require("../src/youtube");

test("youtubeId handles common link shapes and rejects others", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30"), "aqz-KE-bpKQ");
  assert.equal(youtubeId("https://youtu.be/aqz-KE-bpKQ?si=x"), "aqz-KE-bpKQ");
  assert.equal(youtubeId("https://m.youtube.com/shorts/aqz-KE-bpKQ"), "aqz-KE-bpKQ");
  assert.equal(youtubeId("https://music.youtube.com/watch?v=aqz-KE-bpKQ"), "aqz-KE-bpKQ");
  assert.equal(youtubeId("https://vimeo.com/1084537"), null);
  assert.equal(youtubeId("https://www.youtube.com/watch?v=bad"), null);
  assert.equal(youtubeId("not a url"), null);
});

test("toItems keeps valid entries, drops current/duplicates/upcoming", () => {
  const items = toItems(
    {
      entries: [
        { id: "AAAAAAAAAAA", title: "Current" },
        { id: "BBBBBBBBBBB", title: "Next", channel: "Ch", duration: 245.4 },
        { id: "BBBBBBBBBBB", title: "Dup" },
        { id: "CCCCCCCCCCC", title: "Soon", live_status: "is_upcoming" },
        { id: "bad", title: "Bad id" },
        { id: "DDDDDDDDDDD", title: "Live now", live_status: "is_live" },
      ],
    },
    "AAAAAAAAAAA"
  );
  assert.deepEqual(items.map((i) => i.id), ["BBBBBBBBBBB", "DDDDDDDDDDD"]);
  assert.deepEqual(items[0], { id: "BBBBBBBBBBB", title: "Next", channel: "Ch", duration: 245, live: false, thumb: "/yt-thumb/BBBBBBBBBBB" });
  assert.equal(items[1].live, true);
});

test("upNext uses the Mix, falls back to title search, and caches", async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args[args.length - 1]);
    if (args.some((a) => a.includes("list=RD"))) return { entries: [{ id: "AAAAAAAAAAA" }] }; // mix only has current
    return { entries: [{ id: "EEEEEEEEEEE", title: "Similar" }, { id: "FFFFFFFFFFF", title: "Also" }] };
  };
  const yt = createYouTube({ run });
  const items = await yt.upNext("AAAAAAAAAAA", "Some song");
  assert.deepEqual(items.map((i) => i.id), ["EEEEEEEEEEE", "FFFFFFFFFFF"]);
  assert.match(calls[0], /list=RDAAAAAAAAAAA/);
  assert.match(calls[1], /^ytsearch15:Some song/);
  await yt.upNext("AAAAAAAAAAA", "Some song");
  assert.equal(calls.length, 2, "second call served from cache");
  assert.deepEqual(await yt.upNext("nope"), []);
});

test("search ignores empty queries", async () => {
  let called = false;
  const yt = createYouTube({ run: async () => ((called = true), { entries: [] }) });
  assert.deepEqual(await yt.search("   "), []);
  assert.equal(called, false);
});
