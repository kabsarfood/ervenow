const { createServiceClient } = require("../shared/config/supabase");
const { notifyNearestDrivers } = require("../apps/driver/notify");
const { perfLog } = require("../shared/utils/perfLog");
const { logger } = require("../shared/utils/logger");
const { runCheckoutDispatch } = require("../shared/jobs/checkoutDispatch");
const {
  refineDeliveryOrderPricingFromOsrm,
} = require("../apps/delivery/service");

async function processDeliveryJob(name, data) {
  const sb = createServiceClient();
  if (!sb) throw new Error("database not configured");

  const t0 = Date.now();

  if (name === "new-order") {
    const orderId = String(data.orderId || "").trim();
    if (!orderId) return;

    await refineDeliveryOrderPricingFromOsrm(sb, orderId);

    const { data: order } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    const ds = String(order?.delivery_status || order?.status || "").toLowerCase();
    if (
      order &&
      order.pickup_lat != null &&
      order.pickup_lng != null &&
      ["pending", "new"].includes(ds) &&
      ds !== "draft" &&
      !order.driver_id
    ) {
      await notifyNearestDrivers(sb, order);
    }

    perfLog("delivery.new-order", {
      orderId,
      routeTime: Date.now() - t0,
      osrmStatus: "worker_done",
    });
    return;
  }

  if (name === "checkout-dispatch") {
    await runCheckoutDispatch(sb, data);
    return;
  }

  logger.warn({ jobName: name }, "[deliveryProcessor] unknown job");
}

module.exports = { processDeliveryJob };
