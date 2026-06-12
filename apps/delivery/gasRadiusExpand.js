const { createServiceClient } = require("../../shared/config/supabase");
const { logger } = require("../../shared/utils/logger");
const { notifyGasDeliveryProviders } = require("../../shared/services/gasDeliveryNotify");
const {
  GAS_RADIUS_EXPANDED_KM,
  shouldExpandGasRadius,
  notifiedGasPhones,
} = require("../../shared/utils/gasDeliveryRadius");

const POLL_INTERVAL_MS = 60 * 1000;
const BATCH_LIMIT = 40;
let workerTimer = null;
let running = false;

async function expandGasRadiusForOrder(sb, order) {
  if (!sb || !order || !order.id) return false;
  if (!shouldExpandGasRadius(order, Date.now())) return false;

  const data = order.data && typeof order.data === "object" ? { ...order.data } : {};
  if (data.gas_radius_expanded) return false;

  const now = new Date().toISOString();
  const nextData = {
    ...data,
    gas_radius_km: GAS_RADIUS_EXPANDED_KM,
    gas_radius_expanded: true,
    gas_radius_expanded_at: now,
  };

  const { error } = await sb
    .from("orders")
    .update({ data: nextData, updated_at: now })
    .eq("id", order.id)
    .is("provider_id", null)
    .in("delivery_status", ["new", "pending"]);
  if (error) {
    logger.error({ err: error.message, orderId: order.id }, "[gasRadiusExpand] update failed");
    return false;
  }

  const enriched = { ...order, data: nextData };
  try {
    const result = await notifyGasDeliveryProviders(sb, enriched, {
      radiusKm: GAS_RADIUS_EXPANDED_KM,
      skipPhones: notifiedGasPhones(enriched),
      onlyNew: true,
    });
    logger.info(
      { orderId: order.id, sent: result.sent, providers: result.providers },
      "[gasRadiusExpand] expanded to 20km"
    );
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr.message || String(notifyErr), orderId: order.id },
      "[gasRadiusExpand] notify after expand"
    );
  }
  return true;
}

async function runGasRadiusExpansionTick(sb) {
  const { data: orders, error } = await sb
    .from("orders")
    .select("*")
    .eq("service_type", "gas_delivery")
    .in("delivery_status", ["new", "pending"])
    .is("provider_id", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    logger.error({ err: error.message }, "[gasRadiusExpand] fetch orders");
    return;
  }
  for (const order of orders || []) {
    try {
      await expandGasRadiusForOrder(sb, order);
    } catch (e) {
      logger.error({ err: e.message || String(e), orderId: order.id }, "[gasRadiusExpand] order tick");
    }
  }
}

function startGasRadiusExpandWorker() {
  if (workerTimer) return;
  const sb = createServiceClient();
  if (!sb) {
    console.warn("[gasRadiusExpand] skipped: service supabase is not configured");
    return;
  }
  workerTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runGasRadiusExpansionTick(sb);
    } catch (e) {
      logger.error({ err: e && (e.message || String(e)) }, "[gasRadiusExpand] worker tick failed");
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);
}

module.exports = {
  expandGasRadiusForOrder,
  runGasRadiusExpansionTick,
  startGasRadiusExpandWorker,
};
