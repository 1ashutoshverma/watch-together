const test = require("node:test");
const assert = require("node:assert");
const { createChatMedia, sniffImage } = require("../src/chatmedia");

const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);

test("sniffImage recognises images and rejects others", () => {
  assert.equal(sniffImage(GIF), "image/gif");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>      ")), null);
});

test("uploads become image messages only with a real upload id", () => {
  const cm = createChatMedia();
  const { id } = cm.saveUpload(GIF, 320, 240);
  assert.deepEqual(cm.messagePayload({ kind: "image", id }), { kind: "image", src: `/chat-media/${id}`, w: 320, h: 240 });
  assert.equal(cm.messagePayload({ kind: "image", id: "f".repeat(24) }), null);
  assert.equal(cm.saveUpload(Buffer.from("not an image at all"), 1, 1).error.includes("Only photos"), true);
});

test("gif search without key reports no-key; with key maps results through proxy", async () => {
  assert.deepEqual(await createChatMedia().searchGifs("hi"), { error: "no-key" });
  let calledUrl = "";
  const fake = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ data: [{ id: "abc123XY", images: { fixed_height: { webp: "https://media2.giphy.com/media/abc123XY/200.webp", width: "267", height: "200" } } }, { id: "bad", images: { fixed_height: { url: "https://evil.example/x.gif" } } }] }) };
  };
  const cm = createChatMedia({ giphyKey: "k", fetchImpl: fake });
  const r = await cm.searchGifs("cat");
  assert.match(calledUrl, /api\.giphy\.com\/v1\/gifs\/search\?.*q=cat/);
  assert.deepEqual(r.items, [{ id: "abc123XY", w: 267, h: 200, src: "/gif/abc123XY" }]);
  assert.deepEqual(cm.messagePayload({ kind: "gif", id: "abc123XY" }), { kind: "gif", src: "/gif/abc123XY", w: 267, h: 200 });
  assert.equal(cm.messagePayload({ kind: "gif", id: "notSearched" }), null);
});
