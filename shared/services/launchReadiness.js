const { createServiceClient } = require("../config/supabase");
const { getLaunchTargets, LAUNCH_WEIGHTS } = require("../config/launchTargets");
const { otpBackendMode } = require("./otpChallengeService");
const { pingRedis } = require("../../queues/deliveryQueue");
const { getTwilioRuntimeStatus } = require("../utils/twilioRuntime");
const { getSocketRuntimeStatus } = require("../utils/socketRuntime");
const { getPublicOrderingState } = require("../utils/publicOrdering");

const GAS_TYPES = ["gas_cylinder_swap", "gas_central_refill"];
const TOW_TYPES = ["pickup_truck", "vehicle_transfer", "car_transport"];

function capRatio(current, target) {
  const t = Number(target) || 0;
  const c = Number(current) || 0;
  if (t <= 0) return 0;
  return Math.min(1, c / t);
}

function launchBand(percent) {
  if (percent >= 100) return "TARGET_ACHIEVED";
  if (percent >= 80) return "READY_FOR_LIMITED_LAUNCH";
  if (percent >= 60) return "BUILDING_SUPPLY";
  return "NOT_READY";
}

async function countEq(sb, table, filters) {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters || {})) {
    if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  }
  const { count, error } = await q;
  if (error) return { n: 0, error: error.message };
  return { n: Number(count) || 0 };
}

async function countCustomers(sb) {
  const verified = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "customer")
    .not("phone_verified_at", "is", null);
  if (!verified.error) return { registered: null, verified: Number(verified.count) || 0, verified_error: null };

  const all = await sb.from("users").select("id", { count: "exact", head: true }).eq("role", "customer");
  return {
    registered: Number(all.count) || 0,
    verified: Number(all.count) || 0,
    verified_error: verified.error && verified.error.message,
  };
}

async function countSince(sb, role, sinceIso) {
  const { count, error } = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", role)
    .gte("created_at", sinceIso);
  if (error) return 0;
  return Number(count) || 0;
}

async function computeTechnicalScore() {
  const otp = otpBackendMode() === "supabase" ? 1 : 0;
  const tw = getTwilioRuntimeStatus();
  const twilio = tw.configured ? (tw.sandbox ? 0.4 : 1) : 0;
  const redisPing = await pingRedis();
  let redis = 0.5;
  if (redisPing.skipped) redis = 0.5;
  else redis = redisPing.ok ? 1 : 0.2;
  const sock = getSocketRuntimeStatus();
  const socket = sock.single_instance_required ? 1 : 0.4;
  return Math.min(1, otp * 0.4 + twilio * 0.35 + redis * 0.15 + socket * 0.1);
}

async function computeLaunchReadiness() {
  const sb = createServiceClient();
  const targets = getLaunchTargets();
  const empty = {
    ok: false,
    error: "database_unavailable",
    targets,
    counts: {},
    percent: 0,
    band: "NOT_READY",
    public_ordering: getPublicOrderingState(),
  };
  if (!sb) return empty;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const cust = await countCustomers(sb);
  const customersRegistered = await countEq(sb, "users", { role: "customer" });
  const driversRegUsers = await countEq(sb, "users", { role: "driver" });
  const driversRegTable = await countEq(sb, "drivers", {});
  const driversReady = await sb
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .eq("active", true);
  const restaurants = await sb
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("type", "restaurant")
    .eq("status", "approved");
  const restaurantsReg = await sb
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("type", "restaurant");
  const smReady = await sb
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("type", "supermarket")
    .eq("status", "approved");
  const smReg = await sb.from("stores").select("id", { count: "exact", head: true }).eq("type", "supermarket");
  const phReady = await sb
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("type", "pharmacy")
    .eq("status", "approved");
  const phReg = await sb.from("stores").select("id", { count: "exact", head: true }).eq("type", "pharmacy");

  const towReady = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "service")
    .in("service_type", TOW_TYPES)
    .eq("status", "active");
  const towReg = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "service")
    .in("service_type", TOW_TYPES);
  const gasReady = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "service")
    .in("service_type", GAS_TYPES)
    .eq("status", "active");
  const gasReg = await sb
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "service")
    .in("service_type", GAS_TYPES);

  const customersToday = await countSince(sb, "customer", startOfToday.toISOString());
  const customers7d = await countSince(sb, "customer", since7);
  const driversToday = await countSince(sb, "driver", startOfToday.toISOString());
  const drivers7d = await countSince(sb, "driver", since7);

  const counts = {
    customers_registered: customersRegistered.n,
    customers_verified: cust.verified,
    customers_today: customersToday,
    customers_last_7_days: customers7d,
    drivers_registered: Math.max(driversRegUsers.n, driversRegTable.n),
    drivers_verified: Number(driversReady.count) || 0,
    drivers_ready: Number(driversReady.count) || 0,
    drivers_today: driversToday,
    drivers_last_7_days: drivers7d,
    restaurants_registered: Number(restaurantsReg.count) || 0,
    restaurants_ready: Number(restaurants.count) || 0,
    supermarkets_registered: Number(smReg.count) || 0,
    supermarkets_ready: Number(smReady.count) || 0,
    pharmacies_registered: Number(phReg.count) || 0,
    pharmacies_ready: Number(phReady.count) || 0,
    tow_trucks_registered: Number(towReg.count) || 0,
    tow_trucks_ready: Number(towReady.count) || 0,
    gas_registered: Number(gasReg.count) || 0,
    gas_ready: Number(gasReady.count) || 0,
  };

  const technical = await computeTechnicalScore();
  const parts = {
    customers_verified: capRatio(counts.customers_verified, targets.customers_verified),
    drivers_registered: capRatio(counts.drivers_registered, targets.drivers_registered),
    drivers_ready: capRatio(counts.drivers_ready, targets.drivers_ready),
    restaurants_ready: capRatio(counts.restaurants_ready, targets.restaurants_ready),
    supermarkets_ready: capRatio(counts.supermarkets_ready, targets.supermarkets_ready),
    pharmacies_ready: capRatio(counts.pharmacies_ready, targets.pharmacies_ready),
    tow_trucks_ready: capRatio(counts.tow_trucks_ready, targets.tow_trucks_ready),
    gas_ready: capRatio(counts.gas_ready, targets.gas_ready),
    technical,
  };

  let weighted = 0;
  for (const [k, w] of Object.entries(LAUNCH_WEIGHTS)) {
    weighted += w * (parts[k] || 0);
  }
  const percent = Math.round(weighted * 1000) / 10;
  const band = launchBand(percent);

  return {
    ok: true,
    percent,
    band,
    auto_launch: false,
    public_ordering: getPublicOrderingState(),
    targets,
    weights: LAUNCH_WEIGHTS,
    category_fill: parts,
    counts,
    technical: {
      score: technical,
      otp_backend: otpBackendMode(),
      twilio: getTwilioRuntimeStatus(),
      socket: getSocketRuntimeStatus(),
    },
  };
}

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function registrationTrend7d() {
  const sb = createServiceClient();
  if (!sb) return { ok: false, days: [] };
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("users")
    .select("role, created_at, service_type")
    .gte("created_at", since)
    .limit(5000);
  if (error) return { ok: false, error: error.message, days: [] };
  const map = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const k = d.toISOString().slice(0, 10);
    map[k] = { date: k, customers: 0, drivers: 0, merchants_providers: 0 };
  }
  for (const row of data || []) {
    const k = dayKey(row.created_at);
    if (!k || !map[k]) continue;
    const role = String(row.role || "").toLowerCase();
    if (role === "customer") map[k].customers += 1;
    else if (role === "driver") map[k].drivers += 1;
    else if (role === "store" || role === "merchant" || role === "restaurant" || role === "service") {
      map[k].merchants_providers += 1;
    }
  }
  return { ok: true, days: Object.values(map) };
}

module.exports = {
  computeLaunchReadiness,
  registrationTrend7d,
  launchBand,
  capRatio,
  GAS_TYPES,
  TOW_TYPES,
};
