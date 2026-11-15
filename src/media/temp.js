const fs = require("fs");
const os = require("os");
const path = require("path");

const TEMP_ROOT = path.join(os.tmpdir(), "wt-media");

function wipeAll() {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
}

function newJobDir(id) {
  const dir = path.join(TEMP_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeJobDir(id) {
  if (!id) return;
  fs.rmSync(path.join(TEMP_ROOT, id), { recursive: true, force: true });
}

module.exports = { TEMP_ROOT, wipeAll, newJobDir, removeJobDir };
