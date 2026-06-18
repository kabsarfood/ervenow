const fs = require("fs");
const path = require("path");
const {
  pathToPortalKey,
  pathToLegacyKey,
  REDIRECT_ERROR_TYPES,
  PORTAL_DEFINITIONS,
  PREVIEW_PORTAL_KEYS,
  LEGACY_ACCESS_KEYS,
} = require("./adminRoleTaxonomy");

const filePath = path.join(__dirname, "..", "..", "data", "admin-readiness.json");
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const MAX_ERROR_LOG = 80;
const MAX_REDIRECT_EVENTS = 120;
const MAX_BROADCAST_HISTORY = 60;
const MAX_USER_SNAPSHOTS = 2000;

let writeQueue = Promise.resolve();

function defaultPortalStats() {
  const out = {};
  for (const key of Object.keys(PORTAL_DEFINITIONS)) {
    out[key] = { visits: 0, unique_users: {}, last_at: null };
  }
  return out;
}

function defaultPreviewStats() {
  const out = {};
  for (const key of Object.keys(PREVIEW_PORTAL_KEYS)) {
    out[key] = { visits: 0, unique_users: {}, last_at: null, active_users: {} };
  }
  return out;
}

function defaultLegacyStats() {
  const out = {};
  for (const key of Object.keys(LEGACY_ACCESS_KEYS)) {
    out[key] = { visits: 0, unique_users: {}, last_at: null };
  }
  return out;
}

function defaultState() {
  return {
    updated_at: null,
    portal_visits: defaultPortalStats(),
    preview_visits: defaultPreviewStats(),
    legacy_access: defaultLegacyStats(),
    redirect_errors: {
      unknown_role: [],
      failed_redirect: [],
      unauthorized_portal: [],
    },
    user_snapshots: {},
    broadcast_history: [],
    redirect_events: [],
  };
}

function ensureDir() {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStateSync() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function writeStateSync(state) {
  ensureDir();
  const payload = { ...state, updated_at: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function queueWrite(mutator) {
  writeQueue = writeQueue.then(() => {
    const state = readStateSync();
    mutator(state);
    writeStateSync(state);
  });
  return writeQueue;
}

function touchUnique(bucket, userId, atIso) {
  if (!bucket) return;
  if (userId) bucket.unique_users[String(userId)] = atIso;
  bucket.visits = Number(bucket.visits || 0) + 1;
  bucket.last_at = atIso;
}

function trimUserSnapshots(state) {
  const keys = Object.keys(state.user_snapshots || {});
  if (keys.length <= MAX_USER_SNAPSHOTS) return;
  keys
    .sort((a, b) => {
      const ta = state.user_snapshots[a]?.last_at || "";
      const tb = state.user_snapshots[b]?.last_at || "";
      return ta.localeCompare(tb);
    })
    .slice(0, keys.length - MAX_USER_SNAPSHOTS)
    .forEach((k) => delete state.user_snapshots[k]);
}

async function recordPageVisit(input) {
  const at = new Date().toISOString();
  const pathname = input?.path || input?.pathname || "";
  const portalKey = input?.portalKey || pathToPortalKey(pathname);
  const legacyKey = input?.legacyKey || pathToLegacyKey(pathname);
  const userId = input?.userId ? String(input.userId) : null;

  await queueWrite((state) => {
    if (portalKey && state.portal_visits[portalKey]) {
      touchUnique(state.portal_visits[portalKey], userId, at);
    }
    if (legacyKey && state.legacy_access[legacyKey]) {
      touchUnique(state.legacy_access[legacyKey], userId, at);
    }
    const previewKey = input?.previewKey || previewKeyFromPath(pathname);
    if (previewKey && state.preview_visits[previewKey]) {
      const pv = state.preview_visits[previewKey];
      touchUnique(pv, userId, at);
      if (userId) {
        pv.active_users[userId] = at;
        const cutoff = Date.now() - ACTIVE_WINDOW_MS;
        Object.keys(pv.active_users).forEach((uid) => {
          const t = new Date(pv.active_users[uid]).getTime();
          if (!t || t < cutoff) delete pv.active_users[uid];
        });
      }
    }
    if (userId) {
      state.user_snapshots[userId] = {
        user_id: userId,
        portal: portalKey || legacyKey || null,
        path: pathname,
        last_at: at,
        role: input?.role || state.user_snapshots[userId]?.role || null,
        name: input?.name || state.user_snapshots[userId]?.name || null,
        phone: input?.phone || state.user_snapshots[userId]?.phone || null,
      };
      trimUserSnapshots(state);
    }
  });
}

function previewKeyFromPath(pathname) {
  const p = String(pathname || "")
    .split("?")[0]
    .replace(/\.html$/i, "");
  for (const [key, base] of Object.entries(PREVIEW_PORTAL_KEYS)) {
    if (p === base) return key;
  }
  return null;
}

async function recordRedirectError(errorType, detail) {
  const type = String(errorType || "").toLowerCase();
  if (!REDIRECT_ERROR_TYPES.has(type)) return;
  const at = new Date().toISOString();
  await queueWrite((state) => {
    const row = {
      at,
      ...detail,
    };
    const list = state.redirect_errors[type] || [];
    list.unshift(row);
    state.redirect_errors[type] = list.slice(0, MAX_ERROR_LOG);
  });
}

async function recordRedirectEvent(input) {
  const at = new Date().toISOString();
  const success = input?.success !== false;
  await queueWrite((state) => {
    const row = {
      at,
      portal: input?.portal || null,
      role: input?.role || null,
      path: input?.path || null,
      success,
      raw_role: input?.raw_role || null,
      service_type: input?.service_type || null,
      user_id: input?.user_id ? String(input.user_id) : null,
    };
    state.redirect_events = [row, ...(state.redirect_events || [])].slice(0, MAX_REDIRECT_EVENTS);
    if (!success) {
      const list = state.redirect_errors.failed_redirect || [];
      list.unshift({
        at,
        path: row.path,
        portal: row.portal,
        role: row.role,
        raw_role: row.raw_role,
        service_type: row.service_type,
        user_id: row.user_id,
      });
      state.redirect_errors.failed_redirect = list.slice(0, MAX_ERROR_LOG);
    }
    if (row.portal && state.portal_visits?.[row.portal]) {
      touchUnique(state.portal_visits[row.portal], row.user_id, at);
    }
    const previewKey = row.portal && PREVIEW_PORTAL_KEYS[row.portal] ? row.portal : null;
    if (previewKey && state.preview_visits?.[previewKey]) {
      const pv = state.preview_visits[previewKey];
      touchUnique(pv, row.user_id, at);
      if (row.user_id) pv.active_users[String(row.user_id)] = at;
    }
  });
}

async function appendBroadcastHistory(entry) {
  await queueWrite((state) => {
    const row = {
      at: new Date().toISOString(),
      ...entry,
    };
    state.broadcast_history = [row, ...(state.broadcast_history || [])].slice(0, MAX_BROADCAST_HISTORY);
  });
}

async function readStateAsync() {
  await writeQueue;
  return readStateSync();
}

function summarizeBucket(bucket) {
  const unique = bucket?.unique_users || {};
  const active = bucket?.active_users || {};
  const now = Date.now();
  let activeCount = 0;
  Object.values(active).forEach((at) => {
    const t = new Date(at).getTime();
    if (t && now - t < ACTIVE_WINDOW_MS) activeCount += 1;
  });
  return {
    visits: Number(bucket?.visits || 0),
    unique_users: Object.keys(unique).length,
    last_at: bucket?.last_at || null,
    active_users: activeCount,
  };
}

function summarizeRedirectStats(state, sinceIso) {
  const since = sinceIso ? new Date(sinceIso).getTime() : 0;
  const events = (state.redirect_events || []).filter((e) => {
    if (!since) return true;
    const t = new Date(e.at || 0).getTime();
    return t && t >= since;
  });
  let success = 0;
  let failed = 0;
  const byPortal = {};
  events.forEach((e) => {
    if (e.success) success += 1;
    else failed += 1;
    const key = e.portal || "unknown";
    if (!byPortal[key]) byPortal[key] = { success: 0, failed: 0, total: 0 };
    byPortal[key].total += 1;
    if (e.success) byPortal[key].success += 1;
    else byPortal[key].failed += 1;
  });
  return {
    total: events.length,
    success,
    failed,
    success_rate: events.length ? Math.round((success / events.length) * 1000) / 10 : 100,
    by_portal: byPortal,
    recent: events.slice(0, 25),
  };
}

function filterBucketsSince(buckets, sinceIso) {
  if (!sinceIso) return buckets;
  const since = new Date(sinceIso).getTime();
  const out = {};
  for (const [key, bucket] of Object.entries(buckets || {})) {
    const last = bucket?.last_at ? new Date(bucket.last_at).getTime() : 0;
    out[key] = last && last >= since ? summarizeBucket(bucket) : { visits: 0, unique_users: 0, last_at: null, active_users: 0 };
  }
  return out;
}

function summarizeForAdmin(state) {
  const portalVisits = {};
  for (const key of Object.keys(PORTAL_DEFINITIONS)) {
    portalVisits[key] = summarizeBucket(state.portal_visits?.[key]);
  }
  const previewVisits = {};
  for (const key of Object.keys(PREVIEW_PORTAL_KEYS)) {
    previewVisits[key] = summarizeBucket(state.preview_visits?.[key]);
  }
  const legacyAccess = {};
  for (const key of Object.keys(LEGACY_ACCESS_KEYS)) {
    legacyAccess[key] = summarizeBucket(state.legacy_access?.[key]);
  }
  const redirectErrors = {};
  for (const key of REDIRECT_ERROR_TYPES) {
    const list = state.redirect_errors?.[key] || [];
    redirectErrors[key] = { count: list.length, recent: list.slice(0, 15) };
  }
  return {
    updated_at: state.updated_at,
    portal_visits: portalVisits,
    preview_visits: previewVisits,
    legacy_access: legacyAccess,
    redirect_errors: redirectErrors,
    broadcast_history: (state.broadcast_history || []).slice(0, 30),
    redirect_events: (state.redirect_events || []).slice(0, 25),
    redirect_statistics: summarizeRedirectStats(state),
    user_snapshots_count: Object.keys(state.user_snapshots || {}).length,
  };
}

module.exports = {
  readStateAsync,
  readStateSync,
  recordPageVisit,
  recordRedirectError,
  recordRedirectEvent,
  appendBroadcastHistory,
  summarizeForAdmin,
  summarizeRedirectStats,
  filterBucketsSince,
  ACTIVE_WINDOW_MS,
};
