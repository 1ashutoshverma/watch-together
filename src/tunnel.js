const { spawn } = require("child_process");

function parseTunnelUrl(line) {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(String(line || ""));
  return m ? m[0] : null;
}

function startTunnel(port, onUrl) {
  const p = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let found = false;
  const scan = (d) => {
    if (found) return;
    const url = parseTunnelUrl(d.toString());
    if (url) {
      found = true;
      onUrl(url);
    }
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  p.on("error", () => onUrl(null));
  return p;
}

module.exports = { parseTunnelUrl, startTunnel };
