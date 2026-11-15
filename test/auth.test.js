const test = require("node:test");
const assert = require("node:assert");
const { createAuth } = require("../src/auth");

test("valid login yields verifiable token", () => {
  const auth = createAuth({ password: "pw" });
  const r = auth.login("pw", "A", "1.1.1.1");
  assert.equal(r.ok, true);
  assert.equal(auth.verify(r.token).name, "A");
});

test("wrong password rejected", () => {
  const auth = createAuth({ password: "pw" });
  assert.equal(auth.login("nope", "A", "1.1.1.1").ok, false);
});

test("rate limited after 5 failures even with right password", () => {
  const auth = createAuth({ password: "pw" });
  for (let i = 0; i < 5; i++) auth.login("x", "A", "2.2.2.2");
  const r = auth.login("pw", "A", "2.2.2.2");
  assert.equal(r.ok, false);
  assert.equal(r.error, "rate-limited");
  assert.equal(auth.login("pw", "A", "3.3.3.3").ok, true);
});

test("tampered and expired tokens rejected", () => {
  let t = 1000;
  const auth = createAuth({ password: "pw", now: () => t, ttlMs: 5000 });
  const { token } = auth.login("pw", "A", "1");
  assert.equal(auth.verify(token.slice(0, -2) + "xx"), null);
  const parts = token.split(".");
  assert.equal(auth.verify(Buffer.from("B").toString("base64url") + "." + parts[1] + "." + parts[2]), null);
  t = 7000;
  assert.equal(auth.verify(token), null);
});

test("name required and trimmed", () => {
  const auth = createAuth({ password: "pw" });
  assert.equal(auth.login("pw", "   ", "1").ok, false);
  assert.equal(auth.verify(auth.login("pw", "  Ashu  ", "1").token).name, "Ashu");
});

test("allowRequest accepts cookie or query token, rejects otherwise", async () => {
  const auth = createAuth({ password: "pw" });
  const { token } = auth.login("pw", "A", "1");
  const ask = (req) => new Promise((r) => auth.allowRequest(req, (_, ok) => r(ok)));
  assert.equal(await ask({ headers: { cookie: "wt=" + encodeURIComponent(token) }, url: "/socket.io/?EIO=4" }), true);
  assert.equal(await ask({ headers: {}, url: "/socket.io/?EIO=4&token=" + encodeURIComponent(token) }), true);
  assert.equal(await ask({ headers: {}, url: "/socket.io/?EIO=4" }), false);
  assert.equal(await ask({ headers: { cookie: "wt=bad" }, url: "/socket.io/?token=bad" }), false);
});
