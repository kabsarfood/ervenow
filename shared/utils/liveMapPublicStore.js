const fs = require("fs");
const path = require("path");
const { createServiceClient } = require("../config/supabase");

const filePath = path.join(__dirname, "..", "..", "data", "live-map-public.json");
const PUBLIC_KEY = "live_map_public_enabled";
const DB_REFRESH_MS = 4000;

let memLoaded = false;
let memEnabled = true;
let memLoadedAt = 0;
let dbRefreshBusy = false;

function parseEnabledValue(raw) {
  if (raw === false || raw === 0) return false;
  if (raw === true || raw === 1) return true;
  const s = String(raw == null ? "" : raw)
    .trim()
    .toLowerCase();
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "";
}

function loadFromFileSync() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    memEnabled = parseEnabledValue(JSON.parse(raw).enabled);
    memLoaded = true;
    memLoadedAt = Date.now();
    return memEnabled;
  } catch {
    return null;
  }
}

function writeFileSync(enabled) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    enabled: !!enabled,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
}

async function upsertDatabase(enabled) {
  const sb = createServiceClient();
  if (!sb) return false;
  const { error } = await sb.from("platform_settings").upsert(
    {
      key: PUBLIC_KEY,
      value: enabled ? "1" : "0",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) {
    if (/platform_settings|42P01|schema cache|PGRST205/i.test(String(error.message || ""))) {
      return false;
    }
    throw error;
  }
  return true;
}

async function refreshFromDatabase() {
  if (dbRefreshBusy) return;
  dbRefreshBusy = true;
  try {
    const sb = createServiceClient();
    if (!sb) return;
    const { data, error } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", PUBLIC_KEY)
      .maybeSingle();
    if (error) {
      if (/platform_settings|42P01|schema cache|PGRST205/i.test(String(error.message || ""))) return;
      throw error;
    }
    if (data && data.value != null) {
      memEnabled = parseEnabledValue(data.value);
      memLoaded = true;
      memLoadedAt = Date.now();
      writeFileSync(memEnabled);
    }
  } catch (e) {
    console.warn("[liveMapPublic] db refresh:", e && (e.message || e));
  } finally {
    dbRefreshBusy = false;
  }
}

function readState() {
  if (!memLoaded) {
    const fromFile = loadFromFileSync();
    if (fromFile == null) {
      memEnabled = true;
      memLoaded = true;
      memLoadedAt = Date.now();
    }
    void refreshFromDatabase();
  } else if (Date.now() - memLoadedAt > DB_REFRESH_MS) {
    void refreshFromDatabase();
  }
  return memEnabled;
}

async function readStateAsync() {
  await refreshFromDatabase();
  if (!memLoaded) {
    const fromFile = loadFromFileSync();
    if (fromFile == null) {
      memEnabled = true;
      memLoaded = true;
      memLoadedAt = Date.now();
    }
  }
  return memEnabled;
}

async function writeState(enabled) {
  const next = !!enabled;
  memEnabled = next;
  memLoaded = true;
  memLoadedAt = Date.now();
  writeFileSync(next);
  try {
    await upsertDatabase(next);
  } catch (e) {
    console.warn("[liveMapPublic] db write:", e && (e.message || e));
  }
  return next;
}

setInterval(() => {
  void refreshFromDatabase();
}, DB_REFRESH_MS);

void refreshFromDatabase();

module.exports = {
  readState,
  readStateAsync,
  writeState,
  filePath,
  PUBLIC_KEY,
};
