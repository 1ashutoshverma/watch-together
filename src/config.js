const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function loadConfig(root = path.join(__dirname, "..")) {
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;
  let password = env.ROOM_PASSWORD;
  let generatedPassword = false;
  if (!password) {
    password = crypto.randomBytes(4).toString("hex");
    generatedPassword = true;
  }
  const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);
  return {
    password,
    generatedPassword,
    mediaDir: path.resolve(expand(env.MEDIA_DIR || "~/Movies")),
    port: Number(env.PORT || 3000),
    cookiesBrowser: env.YTDLP_COOKIES_BROWSER || "",
    noTunnel: env.NO_TUNNEL === "1",
  };
}

module.exports = { loadConfig };
