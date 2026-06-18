const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "data", "role-separation-soft-launch.json");

function defaultConfig() {
  return {
    enabled: true,
    started_at: new Date().toISOString(),
    phase: "soft_launch",
    notes: "Role Separation Soft Launch — preview portals are default post-OTP destinations.",
  };
}

function ensureDir() {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readConfigSync() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    const cfg = defaultConfig();
    writeConfigSync(cfg);
    return cfg;
  }
}

function writeConfigSync(cfg) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

function getSoftLaunchStatus() {
  const cfg = readConfigSync();
  const startedAt = cfg.started_at ? new Date(cfg.started_at).getTime() : null;
  const hoursSince =
    startedAt && !Number.isNaN(startedAt) ? Math.round(((Date.now() - startedAt) / 3600000) * 10) / 10 : 0;
  return {
    enabled: cfg.enabled !== false,
    phase: cfg.phase || "soft_launch",
    started_at: cfg.started_at || null,
    hours_since_start: hoursSince,
    report_ready: hoursSince >= 48,
    notes: cfg.notes || null,
  };
}

module.exports = {
  readConfigSync,
  getSoftLaunchStatus,
  defaultConfig,
};
