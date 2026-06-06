/**
 * Checkout Engine V1 — build order payload from Order Draft (Phase 2)
 * لا يعتمد على cart.js — يقرأ من مسودة ErvenowOrderDraft فقط.
 */

const {
  computePlatformCommission,
  PLATFORM_COMMISSION_RATE,
  roundMoney,
} = require("../utils/platformCommission");

const VAT_RATE = 0.15;
const DELIVERY_SAR_PER_KM = 2.3;

const DELIVERY_ITEM_TYPES = Object.freeze({
  delivery: 1,
  vehicle_transfer: 1,
  car_transport: 1,
  internal_delivery: 1,
  pickup_truck: 1,
  furniture_move: 1,
  gas_delivery: 1,
});

function lineKind(item) {
  const d = item && item.data;
  if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return "product";
  const t = String((item && item.type) || "");
  if (DELIVERY_ITEM_TYPES[t]) return "delivery";
  return "service";
}

function itemsSubtotal(items) {
  return roundMoney(
    (items || []).reduce(function (sum, it) {
      return sum + (Number(it && it.price) || 0);
    }, 0)
  );
}

function itemsGoodsSubtotal(items) {
  return roundMoney(
    (items || []).reduce(function (sum, it) {
      if (lineKind(it) !== "product") return sum;
      return sum + (Number(it && it.price) || 0);
    }, 0)
  );
}

function hasStoreProducts(items) {
  return (items || []).some(function (i) {
    const d = i && i.data;
    return lineKind(i) === "product" && d && d.store_id;
  });
}

function getFirstStoreLineData(items) {
  for (let i = 0; i < (items || []).length; i += 1) {
    const d = items[i] && items[i].data;
    if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return d;
  }
  return null;
}

function hasDeliverySnapshot(items) {
  return (items || []).some(function (i) {
    const d = i && i.data;
    if (!d || !d.store_id) return false;
    if (d.delivery_snapshot_version === 1) return true;
    if (d.fulfillment_mode) return true;
    return d.drop_lat != null && d.drop_lng != null;
  });
}

function getDeliveryContextFromItems(items) {
  const d = getFirstStoreLineData(items);
  if (!d || !hasDeliverySnapshot(items)) return null;
  return {
    store_id: d.store_id,
    fulfillment_mode: d.fulfillment_mode || null,
    drop_lat: d.drop_lat != null ? Number(d.drop_lat) : null,
    drop_lng: d.drop_lng != null ? Number(d.drop_lng) : null,
    drop_address: String(d.drop_address || d.location || "").trim(),
    delivery_fee: Number.isFinite(Number(d.delivery_fee)) ? roundMoney(Number(d.delivery_fee)) : null,
    delivery_free: !!d.delivery_free,
    includes_delivery: !!d.includes_delivery,
  };
}

function getFulfillmentMode(items) {
  const ctx = getDeliveryContextFromItems(items);
  if (ctx && ctx.fulfillment_mode) return String(ctx.fulfillment_mode).toLowerCase();
  for (let i = 0; i < (items || []).length; i += 1) {
    const d = items[i] && items[i].data;
    if (d && d.fulfillment_mode) return String(d.fulfillment_mode).toLowerCase();
  }
  return null;
}

function isPickupOnly(items) {
  return getFulfillmentMode(items) === "pickup";
}

function needsDeliveryCoords(items) {
  if (!hasStoreProducts(items)) return false;
  return !isPickupOnly(items);
}

function locationFromItemData(d) {
  if (!d || !d.store_id) return null;
  if (String(d.fulfillment_mode || "").toLowerCase() === "pickup") return null;
  const lat = Number(d.drop_lat);
  const lng = Number(d.drop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    address: String(d.drop_address || d.location || "").trim(),
    fulfillment_mode: d.fulfillment_mode || null,
    store_id: String(d.store_id),
    maps_url: d.drop_maps_url || null,
  };
}

function extractLocationFromItems(items) {
  for (let i = 0; i < (items || []).length; i += 1) {
    const loc = locationFromItemData(items[i] && items[i].data);
    if (loc) return loc;
  }
  return null;
}

function normalizeDraftLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    address: String(loc.address || loc.drop_address || "").trim(),
    fulfillment_mode: loc.fulfillment_mode || null,
    store_id: loc.store_id != null ? String(loc.store_id) : null,
    maps_url: loc.maps_url || loc.drop_maps_url || null,
  };
}

function resolveEffectiveLocation(draft) {
  const d = draft && typeof draft === "object" ? draft : {};
  const items = Array.isArray(d.items) ? d.items : [];
  const fromItems = extractLocationFromItems(items);
  if (fromItems) return fromItems;
  return normalizeDraftLocation(d.customer_location);
}

function resolveDeliveryFeeFromItems(items) {
  let fee = 0;
  let seen = false;
  (items || []).forEach(function (it) {
    const row = it && it.data;
    if (!row || !row.store_id) return;
    const mode = String(row.fulfillment_mode || "").toLowerCase();
    if (mode === "pickup") {
      seen = true;
      fee = 0;
      return;
    }
    if (row.delivery_free || row.includes_delivery) {
      seen = true;
      fee = 0;
      return;
    }
    if (Number.isFinite(Number(row.delivery_fee))) {
      seen = true;
      fee = Math.max(fee, roundMoney(Number(row.delivery_fee)));
    }
  });
  if (seen) return fee;
  if (!hasStoreProducts(items)) return 0;
  const ctx = getDeliveryContextFromItems(items);
  if (!ctx) return undefined;
  if (String(ctx.fulfillment_mode || "").toLowerCase() === "pickup") return 0;
  if (ctx.delivery_free || ctx.includes_delivery) return 0;
  if (ctx.delivery_fee != null) return ctx.delivery_fee;
  return 0;
}

function resolveDeliveryFeeFromDraft(draft) {
  const d = draft && typeof draft === "object" ? draft : {};
  const totals = d.totals && typeof d.totals === "object" ? d.totals : {};
  if (Number.isFinite(Number(totals.delivery))) return roundMoney(Number(totals.delivery));
  const fromItems = resolveDeliveryFeeFromItems(d.items);
  if (fromItems !== undefined) return fromItems;
  if (totals.delivery_pending !== false && hasStoreProducts(d.items) && !isPickupOnly(d.items)) {
    return undefined;
  }
  return 0;
}

function computeBreakdown(items, deliveryFee) {
  const sub = itemsSubtotal(items);
  const delKnown = Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) >= 0;
  const del = delKnown ? roundMoney(Number(deliveryFee)) : 0;
  const deliveryPending = hasStoreProducts(items) && !delKnown;
  const vat = roundMoney((sub + del) * VAT_RATE);
  const goods = itemsGoodsSubtotal(items);
  const platformOnGoods = computePlatformCommission(goods);
  const platformOnDelivery = delKnown ? computePlatformCommission(del) : 0;
  const platformCommission = roundMoney(platformOnGoods + platformOnDelivery);
  const grandTotal = roundMoney(sub + del + vat);
  return {
    subtotal: sub,
    delivery: del,
    deliveryPending,
    vat,
    platformCommission,
    platformOnGoods,
    platformOnDelivery,
    merchantNet: roundMoney(goods - platformOnGoods),
    driverNet: roundMoney(del - platformOnDelivery),
    grandTotal,
  };
}

function buildFinancialIntent(items, deliveryFee, paymentMethod) {
  const b = computeBreakdown(items, deliveryFee);
  const pay = paymentMethod != null ? String(paymentMethod).trim() : "";
  return {
    subtotal: b.subtotal,
    delivery_fee: b.deliveryPending ? null : b.delivery,
    delivery_pending: b.deliveryPending,
    vat: b.vat,
    platform_fee: b.platformCommission,
    merchant_net: b.merchantNet,
    driver_net: b.driverNet,
    grand_total: b.deliveryPending ? null : b.grandTotal,
    payment_method: pay,
  };
}

function hasDeliverySnapshotInDraft(draft) {
  return hasDeliverySnapshot((draft && draft.items) || []);
}

function buildOrderCreatePayload(draft, paymentMethod) {
  const d = draft && typeof draft === "object" ? draft : {};
  const items = Array.isArray(d.items) ? d.items.slice() : [];
  const pay = String(paymentMethod || d.payment_method || "").trim();
  const deliveryFee = resolveDeliveryFeeFromDraft(d);
  const financialIntent = buildFinancialIntent(items, deliveryFee, pay);

  const payload = {
    items,
    payment_method: pay,
    financial_intent: financialIntent,
  };

  if (pay === "ew_pay") {
    payload.paid = true;
    payload.payment_status = "paid";
  }

  if (needsDeliveryCoords(items)) {
    const loc = resolveEffectiveLocation(d);
    if (loc) {
      payload.customer_lat = loc.lat;
      payload.customer_lng = loc.lng;
      payload.customer_address = loc.address || "";
    }
  } else if (hasDeliverySnapshotInDraft(d)) {
    const ctx = getDeliveryContextFromItems(items);
    if (ctx && Number.isFinite(ctx.drop_lat) && Number.isFinite(ctx.drop_lng)) {
      payload.customer_lat = ctx.drop_lat;
      payload.customer_lng = ctx.drop_lng;
      payload.customer_address = ctx.drop_address || "";
    }
  }

  return {
    payload,
    deliveryFee,
    financialIntent,
    needsCoords: needsDeliveryCoords(items),
    location: resolveEffectiveLocation(d),
  };
}

function resolvePostCheckoutRedirectUrl(orders) {
  const list = (orders || []).filter(function (o) {
    return o && o.id;
  });
  if (list.length !== 1) return "/my-orders";
  const o = list[0];
  const breakdown = o.breakdown && typeof o.breakdown === "object" ? o.breakdown : {};
  if (String(breakdown.fulfillment || "").toLowerCase() === "pickup") return "/my-orders";
  if (Number.isFinite(Number(o.drop_lat)) && Number.isFinite(Number(o.drop_lng))) {
    return "/track?id=" + encodeURIComponent(String(o.id));
  }
  return "/my-orders";
}

function fulfillmentLabelAr(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "pickup") return "الاستلام من المتجر";
  if (m === "store_delivery") return "توصيل بواسطة المتجر";
  if (m === "ervenow_delivery") return "توصيل المناديب";
  return "—";
}

module.exports = {
  VAT_RATE,
  DELIVERY_SAR_PER_KM,
  PLATFORM_COMMISSION_RATE,
  lineKind,
  itemsSubtotal,
  itemsGoodsSubtotal,
  hasStoreProducts,
  needsDeliveryCoords,
  resolveDeliveryFeeFromDraft,
  resolveEffectiveLocation,
  computeBreakdown,
  buildFinancialIntent,
  buildOrderCreatePayload,
  resolvePostCheckoutRedirectUrl,
  fulfillmentLabelAr,
  getDeliveryContextFromItems,
};
