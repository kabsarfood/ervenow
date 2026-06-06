/**
 * ERVENOW Checkout Engine V1 — Order Draft schema (Phase 1)
 * مصدر الحقيقة الوحيد للمسودة — لا منافس.
 */

const ORDER_DRAFT_VERSION = 1;

const ORDER_DRAFT_STORAGE_KEY = "ervenow:order-draft";

const LEGACY_CART_STORAGE_KEY = "cart";
const LEGACY_DELIVERY_LOC_KEY = "ervenow:delivery-location";
const LEGACY_PAYMENT_METHOD_KEY = "erv_cart_payment_method";

const SERVICE_TYPES = Object.freeze([
  "store",
  "restaurant",
  "gas",
  "service",
  "vehicle",
  "map_delivery",
]);

const DELIVERY_ITEM_TYPES = Object.freeze({
  delivery: 1,
  vehicle_transfer: 1,
  car_transport: 1,
  internal_delivery: 1,
  pickup_truck: 1,
  furniture_move: 1,
  gas_delivery: 1,
});

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function emptyOrderDraft() {
  const now = Date.now();
  return {
    version: ORDER_DRAFT_VERSION,
    service_type: null,
    provider_id: null,
    items: [],
    customer_location: null,
    payment_method: null,
    order_notes: "",
    totals: {
      subtotal: 0,
      delivery: null,
      vat: null,
      platform_fee: null,
      grand_total: null,
      delivery_pending: true,
    },
    meta: {
      created_at: now,
      updated_at: now,
      source_page: null,
      migrated_from_cart: false,
    },
  };
}

function isStoreProductLine(item) {
  const d = item && item.data;
  return !!(d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "");
}

function isMapDeliveryLine(item) {
  const d = item && item.data;
  if (!d || typeof d !== "object") return false;
  if (String(d.source || "") === "dashboard_map") return true;
  return (
    String(item.type || "") === "delivery" &&
    Number.isFinite(Number(d.pickup_lat)) &&
    Number.isFinite(Number(d.drop_lat))
  );
}

function inferServiceTypeFromItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;

  if (list.some(isMapDeliveryLine)) return "map_delivery";

  for (let i = 0; i < list.length; i += 1) {
    const t = String((list[i] && list[i].type) || "").toLowerCase();
    if (t === "gas_delivery") return "gas";
  }

  for (let i = 0; i < list.length; i += 1) {
    const t = String((list[i] && list[i].type) || "").toLowerCase();
    if (DELIVERY_ITEM_TYPES[t] && t !== "gas_delivery") return "vehicle";
  }

  for (let i = 0; i < list.length; i += 1) {
    if (isStoreProductLine(list[i])) {
      const d = list[i].data || {};
      const st = String(d.store_type || "").toLowerCase();
      if (st === "restaurant" || /مطعم|restaurant/i.test(String(d.store_name || d.merchant_name || ""))) {
        return "restaurant";
      }
      return "store";
    }
  }

  return "service";
}

function inferProviderIdFromItems(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i] && list[i].data;
    if (d && d.store_id) return String(d.store_id);
  }
  return null;
}

function normalizeCustomerLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    address: String(loc.address || loc.drop_address || "").trim(),
    fulfillment_mode: loc.fulfillment_mode ? String(loc.fulfillment_mode) : null,
    store_id: loc.store_id != null ? String(loc.store_id) : null,
    maps_url: loc.maps_url || loc.drop_maps_url || null,
  };
}

function computeItemsSubtotal(items) {
  return roundMoney(
    (items || []).reduce(function (sum, it) {
      return sum + (Number(it && it.price) || 0);
    }, 0)
  );
}

function normalizeOrderDraft(input) {
  const base = emptyOrderDraft();
  if (!input || typeof input !== "object") return base;

  const draft = Object.assign({}, base, input);
  draft.version = ORDER_DRAFT_VERSION;
  draft.items = Array.isArray(input.items) ? input.items.slice() : [];
  draft.service_type = SERVICE_TYPES.includes(input.service_type) ? input.service_type : null;
  draft.provider_id = input.provider_id != null && String(input.provider_id).trim() ? String(input.provider_id) : null;
  draft.payment_method =
    input.payment_method != null && String(input.payment_method).trim() ? String(input.payment_method) : null;
  draft.order_notes =
    input.order_notes != null ? String(input.order_notes).trim().slice(0, 500) : "";
  draft.customer_location = normalizeCustomerLocation(input.customer_location);

  const totalsIn = input.totals && typeof input.totals === "object" ? input.totals : {};
  draft.totals = {
    subtotal: Number.isFinite(Number(totalsIn.subtotal)) ? roundMoney(totalsIn.subtotal) : computeItemsSubtotal(draft.items),
    delivery: Number.isFinite(Number(totalsIn.delivery)) ? roundMoney(totalsIn.delivery) : null,
    vat: Number.isFinite(Number(totalsIn.vat)) ? roundMoney(totalsIn.vat) : null,
    platform_fee: Number.isFinite(Number(totalsIn.platform_fee)) ? roundMoney(totalsIn.platform_fee) : null,
    grand_total: Number.isFinite(Number(totalsIn.grand_total)) ? roundMoney(totalsIn.grand_total) : null,
    delivery_pending: totalsIn.delivery_pending !== false,
  };

  const metaIn = input.meta && typeof input.meta === "object" ? input.meta : {};
  draft.meta = {
    created_at: Number.isFinite(Number(metaIn.created_at)) ? Number(metaIn.created_at) : base.meta.created_at,
    updated_at: Number.isFinite(Number(metaIn.updated_at)) ? Number(metaIn.updated_at) : Date.now(),
    source_page: metaIn.source_page != null ? String(metaIn.source_page) : null,
    migrated_from_cart: !!metaIn.migrated_from_cart,
  };

  if (!draft.service_type && draft.items.length) {
    draft.service_type = inferServiceTypeFromItems(draft.items);
  }
  if (!draft.provider_id && draft.items.length) {
    draft.provider_id = inferProviderIdFromItems(draft.items);
  }

  return draft;
}

function validateOrderDraft(draft) {
  const errors = [];
  const d = normalizeOrderDraft(draft);

  if (d.version !== ORDER_DRAFT_VERSION) {
    errors.push("invalid_version");
  }
  if (!Array.isArray(d.items)) {
    errors.push("items_must_be_array");
  }
  if (d.items.length && !d.service_type) {
    errors.push("service_type_required_when_items_present");
  }
  if (d.service_type && !SERVICE_TYPES.includes(d.service_type)) {
    errors.push("invalid_service_type");
  }
  if ((d.service_type === "store" || d.service_type === "restaurant") && d.items.length && !d.provider_id) {
    errors.push("provider_id_required_for_store");
  }
  if (d.payment_method != null && !String(d.payment_method).trim()) {
    errors.push("invalid_payment_method");
  }
  if (d.customer_location) {
    if (!Number.isFinite(Number(d.customer_location.lat)) || !Number.isFinite(Number(d.customer_location.lng))) {
      errors.push("invalid_customer_location_coords");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    draft: d,
  };
}

function hasDraftItems(draft) {
  return !!(draft && Array.isArray(draft.items) && draft.items.length);
}

module.exports = {
  ORDER_DRAFT_VERSION,
  ORDER_DRAFT_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  LEGACY_DELIVERY_LOC_KEY,
  LEGACY_PAYMENT_METHOD_KEY,
  SERVICE_TYPES,
  DELIVERY_ITEM_TYPES,
  emptyOrderDraft,
  normalizeOrderDraft,
  validateOrderDraft,
  inferServiceTypeFromItems,
  inferProviderIdFromItems,
  normalizeCustomerLocation,
  computeItemsSubtotal,
  hasDraftItems,
  roundMoney,
};
