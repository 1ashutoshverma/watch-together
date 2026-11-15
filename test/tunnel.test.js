const test = require("node:test");
const assert = require("node:assert");
const { parseTunnelUrl } = require("../src/tunnel");

test("parseTunnelUrl finds trycloudflare URL", () => {
  assert.equal(parseTunnelUrl("2026 INF |  https://quiet-river-12ab.trycloudflare.com  |"), "https://quiet-river-12ab.trycloudflare.com");
  assert.equal(parseTunnelUrl("INF Starting tunnel https://api.cloudflare.com"), null);
});
