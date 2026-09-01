/**
 * ERVENOW DELIVERY ENGINE 1.0 — دمج snapshot السلة في checkout (بدون Ledger).
 */

const { buildDeliveryQuote } = require("../services/deliveryQuoteService");
const { deliveryProviderFromFulfillment, normalizeFulfillment } = require("../services/deliveryPolicyEngine");
const { roundMoney } = require("./platformCommission");

function firstStoreItemData(groupItems) {
  const it = groupItems && groupItems[0];
  return it && typeof it.data === "object" && it.data ? it.data : {};
}

function useCartDeliverySnapshot(groupItems) {
  const d = firstStoreItemData(groupItems);
  if (!d || !d.store_id) return false;
  if (d.delivery_snapshot_version === 1) return true;
  if (d.fulfillment_mode) return true;
  const lat = Number(d.drop_lat);
  const lng = Number(d.drop_lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * @returns {Promise<{ ok: true, patch: object, storeRow, fulfillment, shouldDispatch } | { ok: false, message, status }>}
 */
async function resolveStoreCheckoutFromCartSnapshot(sb, groupItems, storeRowFromDb, total) {
  const d = firstStoreItemData(groupItems);
  const fulfillment = normalizeFulfillment(d.fulfillment_mode, storeRowFromDb.delivery_policy);
  const provider = deliveryProviderFromFulfillment(fulfillment);

  if (fulfillment === "pickup") {
    return {
      ok: true,
      fulfillment,
      provider,
      shouldDispatch: false,
      patch: {
        order_total: total,
        total_amount: total,
        delivery_fee: 0,
        distance_km: 0,
        breakdown: {
          fulfillment,
          delivery_provider: provider,
          delivery_policy: d.delivery_policy || "pickup",
          delivery_free: true,
          eta_minutes: 0,
        },
      },
    };
  }

  const lat = Number(d.drop_lat);
  const lng = Number(d.drop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "بيانات موقع التوصيل ناقصة — أعد الإضافة من المتجر", status: 400 };
  }

  const quote = await buildDeliveryQuote({
    storeRow: storeRowFromDb,
    drop_lat: lat,
    drop_lng: lng,
    fulfillment,
    subtotal: total,
    product_includes_delivery: !!d.includes_delivery,
  });
  if (!quote.ok) {
    return {
      ok: false,
      message: quote.message,
      status: quote.status || 400,
      distance_km: quote.distance_km,
      radius_km: quote.radius_km,
      store_lat: quote.store_lat,
      store_lng: quote.store_lng,
      drop_lat: quote.drop_lat,
      drop_lng: quote.drop_lng,
    };
  }

  const clientFee = Number(d.delivery_fee);
  if (Number.isFinite(clientFee) && Math.abs(clientFee - quote.delivery_fee) > 0.05) {
    const { logger } = require("../utils/logger");
    logger.warn(
      {
        storeId: storeRowFromDb.id,
        clientFee,
        serverFee: quote.delivery_fee,
      },
      "[checkoutDeliveryEngine] delivery_fee drift — using server quote"
    );
  }

  const deliveryFee = roundMoney(quote.delivery_fee);
  const dropAddress = String(d.drop_address || d.location || "").trim() || "عنوان التوصيل";
  const slat = Number(storeRowFromDb.lat);
  const slng = Number(storeRowFromDb.lng);

  return {
    ok: true,
    fulfillment,
    provider,
    shouldDispatch: fulfillment === "ervenow_delivery",
    patch: {
      pickup_address: String(storeRowFromDb.address || storeRowFromDb.name || "").trim() || String(storeRowFromDb.name || ""),
      pickup_lat: slat,
      pickup_lng: slng,
      pickup_maps_url: storeRowFromDb.maps_url ? String(storeRowFromDb.maps_url).trim() : null,
      drop_address: dropAddress,
      drop_lat: lat,
      drop_lng: lng,
      drop_maps_url: d.drop_maps_url || null,
      delivery_fee: deliveryFee,
      distance_km: quote.distance_km,
      order_total: total,
      total_amount: roundMoney(total + deliveryFee),
      driver_earning: fulfillment === "ervenow_delivery" ? deliveryFee : 0,
      breakdown: {
        fulfillment,
        delivery_provider: provider,
        delivery_policy: quote.delivery_policy,
        delivery_free: quote.delivery_free,
        eta_minutes: quote.eta_minutes,
        distance_km: quote.distance_km,
        delivery_free_reason: quote.delivery_free_reason || d.delivery_free_reason || null,
      },
    },
  };
}

module.exports = {
  useCartDeliverySnapshot,
  resolveStoreCheckoutFromCartSnapshot,
  firstStoreItemData,
};
