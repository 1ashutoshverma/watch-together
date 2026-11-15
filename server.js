const { spawn } = require("child_process");
const qrcode = require("qrcode-terminal");
const { loadConfig } = require("./src/config");
const { createServer } = require("./src/app");
const { startTunnel } = require("./src/tunnel");
const temp = require("./src/media/temp");

const config = loadConfig();
temp.wipeAll();
const { server, manager } = createServer(config);
const children = [];

function shutdown() {
  manager.stop();
  temp.wipeAll();
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (e) => console.error("Error:", e.message));

server.listen(config.port, "127.0.0.1", () => {
  console.log(`\n  Watch Together running on http://localhost:${config.port}`);
  console.log(`  Library folder: ${config.mediaDir}`);
  console.log(config.generatedPassword ? `  Room password (random, set ROOM_PASSWORD in .env to fix it): ${config.password}` : "  Room password: from ROOM_PASSWORD");

  if (process.platform === "darwin") {
    const c = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    c.on("error", () => {});
    children.push(c);
  }

  if (config.noTunnel) return console.log("  Tunnel off (NO_TUNNEL=1)\n");
  console.log("  Starting secure tunnel…");
  children.push(
    startTunnel(config.port, (url) => {
      if (!url) return console.log("  Couldn't start cloudflared. Install it: brew install cloudflared");
      console.log(`\n  Open on both phones:  ${url}\n`);
      qrcode.generate(url, { small: true });
      console.log("  Press Ctrl+C to stop. Temp files are deleted on exit.\n");
    })
  );
});
