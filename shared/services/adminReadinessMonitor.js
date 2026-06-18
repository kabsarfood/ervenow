const {
  classifyUserRoleBucket,
  defaultPortalForBucket,
  PORTAL_DEFINITIONS,
  PREVIEW_PORTAL_KEYS,
  LEGACY_ACCESS_KEYS,
} = require("../utils/adminRoleTaxonomy");
const { labelForType: serviceLabelForType } = require("../utils/serviceProviderTypes");
const { readStateAsync, summarizeForAdmin } = require("../utils/adminReadinessStore");
const { getSoftLaunchStatus } = require("../utils/roleSeparationSoftLaunch");

const ROLE_BUCKET_LABELS = {
  customer: "العملاء",
  merchant: "التجار",
  driver: "المندوبون",
  service: "الخدمات",
  transport: "النقل",
  admin: "الإدارة",
};

function parsePhoneList(envValue) {
  return String(envValue || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function countAdminSlots() {
  const full = parsePhoneList(process.env.ERVENOW_ADMIN_FULL_PHONES || "0505745650");
  const l1 = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES);
  const l2 = parsePhoneList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES);
  const phones = new Set([...full, ...l1, ...l2].map((p) => p.replace(/\D/g, "")));
  return phones.size;
}

async function countUsersByRoleBucket(sb) {
  const buckets = {
    customer: 0,
    merchant: 0,
    driver: 0,
    service: 0,
    transport: 0,
    admin: 0,
  };

  const { data: users, error } = await sb
    .from("users")
    .select("id, role, service_type, status")
    .limit(5000);
  if (error) throw error;

  for (const u of users || []) {
    const st = String(u.status || "").toLowerCase();
    if (st === "blocked") continue;
    const role = String(u.role || "").toLowerCase();
    if (role === "driver") continue;
    const bucket = classifyUserRoleBucket(u);
    if (buckets[bucket] != null) buckets[bucket] += 1;
  }

  const { data: drivers } = await sb.from("drivers").select("id, status").limit(2000);
  for (const d of drivers || []) {
    if (String(d.status || "").toLowerCase() === "rejected") continue;
    buckets.driver += 1;
  }

  buckets.admin = Math.max(buckets.admin, countAdminSlots());

  return buckets;
}

async function buildRoleSeparationMonitor(sb) {
  const [roleCounts, storeState] = await Promise.all([countUsersByRoleBucket(sb), readStateAsync()]);
  const tracking = summarizeForAdmin(storeState);
  const softLaunch = getSoftLaunchStatus();

  return {
    soft_launch: softLaunch,
    role_counts: roleCounts,
    role_labels: ROLE_BUCKET_LABELS,
    portal_visits: tracking.portal_visits,
    preview_visits: tracking.preview_visits,
    portal_labels: Object.fromEntries(
      Object.entries(PORTAL_DEFINITIONS).map(([k, v]) => [k, v.labelAr])
    ),
    redirect_statistics: tracking.redirect_statistics,
    redirect_events: tracking.redirect_events,
    redirect_errors: tracking.redirect_errors,
    legacy_access: tracking.legacy_access,
    legacy_labels: Object.fromEntries(
      Object.entries(LEGACY_ACCESS_KEYS).map(([k, v]) => [k, v.labelAr])
    ),
    updated_at: tracking.updated_at,
  };
}

async function buildPreviewMonitor(sb) {
  const storeState = await readStateAsync();
  const tracking = summarizeForAdmin(storeState);
  const previews = {};
  for (const [key, path] of Object.entries(PREVIEW_PORTAL_KEYS)) {
    const row = tracking.preview_visits[key] || {};
    previews[key] = {
      path,
      label: PORTAL_DEFINITIONS[key]?.labelAr || key,
      visits: row.visits || 0,
      unique_users: row.unique_users || 0,
      active_users: row.active_users || 0,
      last_at: row.last_at || null,
    };
  }
  return { previews, updated_at: tracking.updated_at };
}

async function buildRoleRegistry(sb, options = {}) {
  const q = String(options.q || "")
    .trim()
    .toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);
  const storeState = await readStateAsync();
  const snapshots = storeState.user_snapshots || {};

  let select = "id, phone, role, service_type, status, name, updated_at, created_at";
  let query = sb.from("users").select(select).order("updated_at", { ascending: false }).limit(800);
  const { data: users, error } = await query;
  if (error && /name|column/i.test(String(error.message || ""))) {
    const fallback = await sb
      .from("users")
      .select("id, phone, role, service_type, status, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(800);
    if (fallback.error) throw fallback.error;
    return filterRegistryRows(mapRegistryRows(fallback.data || [], snapshots), q, limit);
  }
  if (error) throw error;
  return filterRegistryRows(mapRegistryRows(users || [], snapshots), q, limit);
}

function mapRegistryRows(users, snapshots) {
  return users.map((u) => {
    const bucket = classifyUserRoleBucket(u);
    const snap = snapshots[String(u.id)] || null;
    const portal = snap?.path || defaultPortalForBucket(bucket);
    const serviceLabel = u.service_type ? serviceLabelForType(u.service_type) : null;
    return {
      user_id: u.id,
      name: u.name || snap?.name || "—",
      phone: u.phone || snap?.phone || "—",
      role: u.role,
      role_bucket: bucket,
      role_bucket_label: ROLE_BUCKET_LABELS[bucket] || bucket,
      service_type: u.service_type || null,
      service_type_label: serviceLabel,
      portal,
      last_login: snap?.last_at || u.updated_at || u.created_at || null,
      status: u.status || "active",
    };
  });
}

function filterRegistryRows(rows, q, limit) {
  let out = rows;
  if (q) {
    out = out.filter((r) => {
      const hay = [r.name, r.phone, r.role, r.role_bucket, r.service_type_label, r.portal]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return { items: out.slice(0, limit), total: out.length };
}

async function getBroadcastAnalytics(sb) {
  const { data, error } = await sb
    .from("notifications")
    .select("id, is_read, read_at, created_at, payload, title")
    .eq("type", "broadcast")
    .order("created_at", { ascending: false })
    .limit(3000);
  if (error) {
    if (/notifications|does not exist|schema cache/i.test(String(error.message || ""))) {
      return { totals: { sent: 0, read: 0, unread: 0, read_rate: 0 }, broadcasts: [] };
    }
    throw error;
  }

  const byBroadcast = new Map();
  for (const row of data || []) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const bid = String(payload.broadcast_id || row.id);
    if (!byBroadcast.has(bid)) {
      byBroadcast.set(bid, {
        broadcast_id: bid,
        title: row.title || "—",
        target: payload.target || "—",
        category: payload.category || "—",
        created_at: row.created_at,
        sent: 0,
        read: 0,
        unread: 0,
      });
    }
    const agg = byBroadcast.get(bid);
    agg.sent += 1;
    if (row.is_read) agg.read += 1;
    else agg.unread += 1;
    if (row.created_at && (!agg.created_at || row.created_at > agg.created_at)) {
      agg.created_at = row.created_at;
    }
  }

  const broadcasts = [...byBroadcast.values()]
    .map((b) => ({
      ...b,
      read_rate: b.sent ? Math.round((b.read / b.sent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  const totals = broadcasts.reduce(
    (acc, b) => {
      acc.sent += b.sent;
      acc.read += b.read;
      acc.unread += b.unread;
      return acc;
    },
    { sent: 0, read: 0, unread: 0 }
  );
  totals.read_rate = totals.sent ? Math.round((totals.read / totals.sent) * 1000) / 10 : 0;

  const storeState = await readStateAsync();
  const history = (storeState.broadcast_history || []).slice(0, 30);

  return { totals, broadcasts: broadcasts.slice(0, 40), history };
}

module.exports = {
  buildRoleSeparationMonitor,
  buildPreviewMonitor,
  buildRoleRegistry,
  getBroadcastAnalytics,
  ROLE_BUCKET_LABELS,
};
