const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "data", "site-maintenance.json");

let memLoaded = false;
let memEnabled = false;

function readState() {
  if (!memLoaded) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      memEnabled = !!JSON.parse(raw).enabled;
    } catch {
      memEnabled = false;
    }
    memLoaded = true;
  }
  return memEnabled;
}

function writeState(enabled) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    enabled: !!enabled,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
  memEnabled = !!enabled;
  memLoaded = true;
}

module.exports = { readState, writeState, filePath };
