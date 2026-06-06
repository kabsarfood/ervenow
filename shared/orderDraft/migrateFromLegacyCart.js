/**
 * ERVENOW Checkout Engine V1 — migrate legacy cart → Order Draft (Phase 1)
 */

const {
  emptyOrderDraft,
  normalizeOrderDraft,
  inferServiceTypeFromItems,
  inferProviderIdFromItems,
  normalizeCustomerLocation,
  computeItemsSubtotal,
  roundMoney,
  LEGACY_DELIVERY_LOC_KEY,
  LEGACY_PAYMENT_METHOD_KEY,
} = require("./orderDraftSchema");

const CART_STORE_VERSION = 2;

function emptyLegacyCartStore() {
  return { version: CART_STORE_VERSION, items: [], delivery: {}, payment: {}, totals: {} };
}

function parseLegacyDeliveryLocRaw(raw) {
  if (!raw) return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!o || typeof o !== "object") return null;
    return normalizeCustomerLocation({
      lat: o.lat,
      lng: o.lng,
      address: o.address || o.drop_address,
      fulfillment_mode: o.fulfillment_mode,
      store_id: o.store_id,
      maps_url: o.maps_url || o.drop_maps_url,
    });
  } catch (_e) {
    return null;
  }
}

function parseLegacyCartStore(parsed) {
  if (!parsed) return emptyLegacyCartStore();
  if (Array.isArray(parsed)) {
    return Object.assign(emptyLegacyCartStore(), { items: parsed.slice() });
  }
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
    const store = emptyLegacyCartStore();
    store.items = parsed.items.slice();
    if (parsed.delivery && typeof parsed.delivery === "object") store.delivery = parsed.delivery;
    if (parsed.payment && typeof parsed.payment === "object") store.payment = parsed.payment;
    if (parsed.totals && typeof parsed.totals === "object") store.totals = parsed.totals;
    if (parsed.version === CART_STORE_VERSION) store.version = CART_STORE_VERSION;
    return store;
  }
  return Object.assign(emptyLegacyCartStore(), { items: [] });
}

function deliveryRecordToCustomerLocation(delivery, items) {
  const fromDelivery = normalizeCustomerLocation(delivery);
  if (fromDelivery) return fromDelivery;

  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i] && list[i].data;
    if (!d) continue;
    const loc = normalizeCustomerLocation({
      lat: d.drop_lat != null ? d.drop_lat : d.lat,
      lng: d.drop_lng != null ? d.drop_lng : d.lng,
      address: d.drop_address || d.address || d.location,
      fulfillment_mode: d.fulfillment_mode,
      store_id: d.store_id,
      maps_url: d.drop_maps_url || d.maps_url,
    });
    if (loc) return loc;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {object|string|null} opts.cartRaw - localStorage cart JSON or parsed object
 * @param {object|string|null} [opts.legacyDeliveryLocRaw]
 * @param {string|null} [opts.legacyPaymentMethod]
 * @param {number|null} [opts.runtimeDeliveryFee] - window.__ervCartDeliveryFee equivalent
 * @param {string|null} [opts.sourcePage]
 * @returns {{ draft: object, migrated: boolean, legacyCartStore: object }}
 */
function migrateFromLegacyCart(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  let parsed = opts.cartRaw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_e) {
      parsed = null;
    }
  }

  const legacyCartStore = parseLegacyCartStore(parsed);
  const items = legacyCartStore.items.slice();

  if (!items.length) {
    return {
      draft: emptyOrderDraft(),
      migrated: false,
      legacyCartStore,
    };
  }

  const legacyLoc =
    parseLegacyDeliveryLocRaw(opts.legacyDeliveryLocRaw) ||
    (opts.legacyDeliveryLocRaw == null && legacyCartStore.delivery
      ? deliveryRecordToCustomerLocation(legacyCartStore.delivery, items)
      : null) ||
    deliveryRecordToCustomerLocation(null, items);

  let paymentMethod = null;
  if (legacyCartStore.payment && legacyCartStore.payment.method) {
    paymentMethod = String(legacyCartStore.payment.method);
  } else if (opts.legacyPaymentMethod) {
    paymentMethod = String(opts.legacyPaymentMethod);
  }

  let deliveryFee = null;
  if (legacyCartStore.totals && Number.isFinite(Number(legacyCartStore.totals.deliveryFee))) {
    deliveryFee = roundMoney(Number(legacyCartStore.totals.deliveryFee));
  } else if (Number.isFinite(Number(opts.runtimeDeliveryFee))) {
    deliveryFee = roundMoney(Number(opts.runtimeDeliveryFee));
  }

  const subtotal = computeItemsSubtotal(items);
  const now = Date.now();

  const draft = normalizeOrderDraft({
    service_type: inferServiceTypeFromItems(items),
    provider_id: inferProviderIdFromItems(items),
    items,
    customer_location: legacyLoc,
    payment_method: paymentMethod,
    totals: {
      subtotal,
      delivery: deliveryFee,
      vat: null,
      platform_fee: null,
      grand_total: null,
      delivery_pending: deliveryFee == null,
    },
    meta: {
      created_at: now,
      updated_at: now,
      source_page: opts.sourcePage || null,
      migrated_from_cart: true,
    },
  });

  return {
    draft,
    migrated: true,
    legacyCartStore,
  };
}

module.exports = {
  CART_STORE_VERSION,
  emptyLegacyCartStore,
  parseLegacyCartStore,
  parseLegacyDeliveryLocRaw,
  migrateFromLegacyCart,
  LEGACY_DELIVERY_LOC_KEY,
  LEGACY_PAYMENT_METHOD_KEY,
};
