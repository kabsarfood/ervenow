/**
 * إتمام طلب خدمة — orders.order_type IN (service, gas_delivery)
 */

const { isHomeServiceType } = require("../utils/homeServicePricing");
const { settleCompletedServiceLedgerOnly } = require("./ledgerOnlySettlement");
const { creditProviderOnDelivered } = require("./providerLedgerCredit");
const { getOrderDeliveryStatus, buildOrderStatusPatch } = require("../domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../domain/orders/constants");
const { updateOrdersResilient } = require("../utils/idempotency");
const { applyProviderIdToPatch } = require("../utils/orderProviderId");

function isMissingOptionalColumnError(err) {
  const msg = String((err && err.message) || err || "");
  return /column|does not exist|schema cache/i.test(msg);
}

function isServiceOrderRow(row) {
  if (!row) return false;
  const ot = String(row.order_type || "").toLowerCase();
  return ot === "service";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {string|null} providerId
 * @param {{ actor?: string }} [options]
 */
async function completeServiceOrder(sb, orderId, providerId, options = {}) {
  const id = String(orderId || "").trim();
  if (!id) return { data: null, error: new Error("id required") };

  const actor = String(options.actor || "legacy").toLowerCase();

  const { data: existing, error: gErr } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (gErr) return { data: null, error: gErr };
  if (!existing) return { data: null, error: new Error("Not found") };
  if (!isServiceOrderRow(existing)) return { data: null, error: new Error("not a service order") };

  const serviceType = String(existing.service_type || "").toLowerCase();
  if (!isHomeServiceType(serviceType) && serviceType !== "gas_delivery") {
    return { data: null, error: new Error("not a service order") };
  }

  const statusNow = getOrderDeliveryStatus(existing);
  if (
    statusNow === DELIVERY_STATUS.DELIVERED ||
    statusNow === DELIVERY_STATUS.CANCELLED ||
    statusNow === "completed"
  ) {
    return { data: existing, error: null, already_done: true };
  }

  const now = new Date().toISOString();
  let providerDone =
    !!existing.provider_completed_at ||
    statusNow === DELIVERY_STATUS.DELIVERING ||
    statusNow === DELIVERY_STATUS.DELIVERED;
  let customerDone = !!existing.customer_confirmed_at || statusNow === DELIVERY_STATUS.DELIVERED;

  if (actor === "provider") providerDone = true;
  else if (actor === "customer") customerDone = true;
  else if (actor === "both" || actor === "legacy") {
    providerDone = true;
    customerDone = true;
  }

  if (actor === "customer" && !providerDone && actor !== "legacy" && actor !== "both") {
    return { data: null, error: new Error("يجب على مزود الخدمة تأكيد التنفيذ أولاً") };
  }

  const bothDone = providerDone && customerDone;
  const patch = { updated_at: now };
  if (providerDone) patch.provider_completed_at = now;
  if (customerDone) patch.customer_confirmed_at = now;
  if (providerId) {
    Object.assign(patch, applyProviderIdToPatch({}, providerId));
  }

  if (bothDone || actor === "legacy") {
    Object.assign(patch, buildOrderStatusPatch(DELIVERY_STATUS.DELIVERED));
    patch.commission_settled = false;
  } else if (providerDone) {
    Object.assign(patch, buildOrderStatusPatch(DELIVERY_STATUS.DELIVERING));
  }

  let upd = await updateOrdersResilient(sb, patch, { id });
  if (upd.error && isMissingOptionalColumnError(upd.error)) {
    const fallback = { updated_at: now, delivery_status: patch.delivery_status };
    if (providerId) fallback.provider_id = providerId;
    upd = await updateOrdersResilient(sb, fallback, { id });
  }
  if (upd.error) return { data: null, error: upd.error };
  if (!upd.data) return { data: null, error: new Error("Not found") };

  const data = upd.data;
  const finalized = getOrderDeliveryStatus(data) === DELIVERY_STATUS.DELIVERED;

  let providerCreditRow = null;
  if (finalized) {
    void settleCompletedServiceLedgerOnly(sb, id, "service:completed");
    providerCreditRow = await creditProviderOnDelivered(sb, data, "service:delivered");
  }

  return {
    data,
    error: null,
    finalized,
    provider_completed: providerDone,
    customer_confirmed: customerDone,
    provider_credit: providerCreditRow,
  };
}

/** @deprecated alias */
const completeServiceBooking = completeServiceOrder;

module.exports = { completeServiceOrder, completeServiceBooking, isServiceOrderRow };
