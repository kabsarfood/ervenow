/**
 * Checkout Engine V1 — Phase 3: Vertical → Order Draft bridge
 */

const {
  emptyOrderDraft,
  normalizeOrderDraft,
  inferServiceTypeFromItems,
  inferProviderIdFromItems,
  normalizeCustomerLocation,
  computeItemsSubtotal,
  roundMoney,
} = require("./orderDraftSchema");

const CHECKOUT_PATH = "/checkout";

const DELIVERY_ITEM_TYPES = {
  delivery: 1,
  vehicle_transfer: 1,
  car_transport: 1,
  internal_delivery: 1,
  pickup_truck: 1,
  furniture_move: 1,
  gas_delivery: 1,
};

function validateSaPhone(phone) {
  const d = String(phone || "").replace(/\s/g, "").replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return d;
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3)}`;
  if (/^5\d{8}$/.test(d)) return `0${d}`;
  return null;
}

function isMapDeliveryItem(item) {
  const d = item && item.data;
  if (!d || typeof d !== "object") return false;
  if (String(d.source || "") === "dashboard_map") return true;
  return (
    String(item.type || "") === "delivery" &&
    Number.isFinite(Number(d.pickup_lat)) &&
    Number.isFinite(Number(d.drop_lat))
  );
}

function getStoreIdsFromItems(items) {
  const ids = new Set();
  (items || []).forEach((it) => {
    const sid = it && it.data && it.data.store_id;
    if (sid) ids.add(String(sid));
  });
  return ids;
}

function findStoreProductLineIndex(items, storeId, productId) {
  return (items || []).findIndex((i) => {
    const d = i && i.data;
    return d && String(d.store_id) === String(storeId) && String(d.product_id) === String(productId);
  });
}

function locationFromItemData(d) {
  if (!d || !d.store_id) return null;
  if (String(d.fulfillment_mode || "").toLowerCase() === "pickup") return null;
  const lat = Number(d.drop_lat);
  const lng = Number(d.drop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return normalizeCustomerLocation({
    lat,
    lng,
    address: d.drop_address || d.location || d.address,
    fulfillment_mode: d.fulfillment_mode,
    store_id: d.store_id,
    maps_url: d.drop_maps_url || d.maps_url,
  });
}

function customerLocationFromItems(items) {
  for (let i = 0; i < (items || []).length; i += 1) {
    const loc = locationFromItemData(items[i] && items[i].data);
    if (loc) return loc;
  }
  return null;
}

function resolveDeliveryFeeFromItems(items) {
  let fee = 0;
  let seen = false;
  (items || []).forEach((it) => {
    const d = it && it.data;
    if (!d || !d.store_id) return;
    const mode = String(d.fulfillment_mode || "").toLowerCase();
    if (mode === "pickup" || d.delivery_free || d.includes_delivery) {
      seen = true;
      fee = 0;
      return;
    }
    if (Number.isFinite(Number(d.delivery_fee))) {
      seen = true;
      fee = Math.max(fee, roundMoney(Number(d.delivery_fee)));
    }
  });
  if (seen) return fee;
  const hasStore = (items || []).some((i) => i && i.data && i.data.store_id);
  const hasSnap = (items || []).some((i) => {
    const d = i && i.data;
    return d && (d.delivery_snapshot_version === 1 || d.fulfillment_mode);
  });
  if (hasStore && !hasSnap) return undefined;
  return 0;
}

function normalizeIncomingItem(item) {
  if (!item || typeof item !== "object") return null;
  const dataIn = item.data && typeof item.data === "object" ? { ...item.data } : {};
  let initQty = 1;
  if (isMapDeliveryItem(item)) {
    if (dataIn.product_qty == null && dataIn.qty != null) dataIn.product_qty = dataIn.qty;
    dataIn.qty = 1;
  } else {
    initQty = Math.max(1, Math.min(99, Number(dataIn.qty) || 1));
  }
  const unitFromItem =
    Number(dataIn.unit_price) ||
    (Number(item.price) && initQty > 0 ? Number(item.price) / initQty : 0);
  const line = {
    id: item.id != null ? item.id : Date.now(),
    type: item.type,
    title: item.title,
    price: Number(item.price) || 0,
    data: {
      ...dataIn,
      qty: initQty,
      unit_price: Number.isFinite(unitFromItem) && unitFromItem > 0 ? unitFromItem : dataIn.unit_price,
    },
  };
  if (item.customer_phone) line.customer_phone = String(item.customer_phone).trim();
  if (item.payment_status) line.payment_status = item.payment_status;
  return line;
}

function mergeItemIntoItems(items, item) {
  const list = Array.isArray(items) ? items.slice() : [];
  const line = normalizeIncomingItem(item);
  if (!line) return { ok: false, message: "invalid_item", items: list };

  if (isMapDeliveryItem(line)) {
    for (let mi = list.length - 1; mi >= 0; mi -= 1) {
      if (isMapDeliveryItem(list[mi])) list.splice(mi, 1);
    }
  }

  const newSid = line.data && line.data.store_id ? String(line.data.store_id).trim() : "";
  if (newSid) {
    const existingIds = getStoreIdsFromItems(list);
    if (existingIds.size > 0 && !existingIds.has(newSid)) {
      return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين", items: list };
    }
  }

  const pid = line.data && line.data.product_id;
  if (newSid && pid != null && pid !== "") {
    const idx = findStoreProductLineIndex(list, newSid, pid);
    if (idx >= 0) {
      const cur = list[idx];
      const addQty = Math.max(1, Math.min(99, Number(line.data && line.data.qty) || 1));
      let unit =
        Number(line.data && line.data.unit_price) ||
        Number(cur.data && cur.data.unit_price) ||
        (Number(cur.price) || 0) / Math.max(1, Number(cur.data && cur.data.qty) || 1);
      if (!Number.isFinite(unit) || unit < 0) unit = 0;
      const newQty = Math.min(99, (Number(cur.data && cur.data.qty) || 1) + addQty);
      list[idx] = {
        ...cur,
        price: unit * newQty,
        data: { ...(cur.data || {}), ...(line.data || {}), qty: newQty, unit_price: unit },
      };
      return { ok: true, items: list, merged: true };
    }
  }

  const exists = list.find(
    (i) =>
      i.type === line.type &&
      i.title === line.title &&
      JSON.stringify(i.data || {}) === JSON.stringify(line.data || {})
  );
  if (exists) {
    return { ok: false, message: "تمت إضافة هذا العنصر مسبقًا", items: list };
  }

  list.push(line);
  return { ok: true, items: list, merged: false };
}

function assertSnapshotCompatibleWithItems(items, snapshot) {
  const list = items || [];
  if (!list.length) return { ok: true };
  const sid = String(snapshot.store_id || "");
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i] && list[i].data;
    if (!d || !d.store_id) continue;
    if (String(d.store_id) !== sid) {
      return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين" };
    }
    if (d.delivery_snapshot_version === 1 && snapshot.delivery_snapshot_version === 1) {
      if (d.fulfillment_mode !== snapshot.fulfillment_mode) {
        return { ok: false, message: "نوع الاستلام/التوصيل يجب أن يكون موحّداً لكل المنتجات" };
      }
      if (
        d.fulfillment_mode !== "pickup" &&
        snapshot.fulfillment_mode !== "pickup" &&
        (Math.abs(Number(d.drop_lat) - Number(snapshot.drop_lat)) > 0.0001 ||
          Math.abs(Number(d.drop_lng) - Number(snapshot.drop_lng)) > 0.0001)
      ) {
        return { ok: false, message: "موقع التوصيل يجب أن يكون واحداً لكل المنتجات" };
      }
    }
  }
  return { ok: true };
}

function buildDraftPatch(existingDraft, mergedItems, opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  const base = normalizeOrderDraft(existingDraft || emptyOrderDraft());
  const loc =
    opts.customerLocation != null
      ? normalizeCustomerLocation(opts.customerLocation)
      : customerLocationFromItems(mergedItems) || base.customer_location;
  const deliveryFee = resolveDeliveryFeeFromItems(mergedItems);
  const subtotal = computeItemsSubtotal(mergedItems);
  return normalizeOrderDraft({
    service_type: inferServiceTypeFromItems(mergedItems),
    provider_id: inferProviderIdFromItems(mergedItems),
    items: mergedItems,
    customer_location: loc,
    payment_method: opts.paymentMethod != null ? opts.paymentMethod : base.payment_method,
    totals: {
      subtotal,
      delivery: deliveryFee,
      vat: null,
      platform_fee: null,
      grand_total: null,
      delivery_pending: deliveryFee === undefined,
    },
    meta: {
      created_at: base.meta.created_at,
      updated_at: Date.now(),
      source_page: opts.sourcePage || base.meta.source_page,
      migrated_from_cart: false,
      vertical: opts.vertical || base.meta.vertical || null,
    },
  });
}

function validateServiceItem(item) {
  const phone = validateSaPhone(item && item.customer_phone);
  if (!phone && !(item && item.data && validateSaPhone(item.data.customer_phone))) {
    return { ok: false, message: "أدخل رقم جوال سعودي صحيح (05xxxxxxxx أو 9665xxxxxxxx)" };
  }
  const normalized = normalizeIncomingItem(item);
  if (!normalized) return { ok: false, message: "invalid_item" };
  const ph = validateSaPhone(normalized.customer_phone || (normalized.data && normalized.data.customer_phone));
  normalized.customer_phone = ph;
  if (normalized.data) normalized.data.customer_phone = ph;
  const price = Number(normalized.price);
  const zeroOk = { delivery: 1, restaurant: 1, food: 1, service: 1 };
  if ((!Number.isFinite(price) || price <= 0) && !zeroOk[normalized.type]) {
    return { ok: false, message: "حدد المواقع أو الخدمة لحساب السعر قبل الإتمام" };
  }
  normalized.price = Number.isFinite(price) && price >= 0 ? roundMoney(price) : 0;
  normalized.payment_status = normalized.payment_status || "unpaid";
  return { ok: true, item: normalized };
}

/**
 * @param {object} draftApi - ErvenowOrderDraft-like { readDraft, writeDraft }
 * @param {object} item
 * @param {object} [opts]
 */
function commitItemToDraft(draftApi, item, opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  if (!draftApi || typeof draftApi.readDraft !== "function" || typeof draftApi.writeDraft !== "function") {
    return { ok: false, message: "Order Draft Store غير متوفر" };
  }

  const needsPhone =
    item &&
    (DELIVERY_ITEM_TYPES[item.type] ||
      item.type === "service" ||
      item.type === "gas_delivery" ||
      isMapDeliveryItem(item));
  let normalizedItem = item;
  if (needsPhone) {
    const v = validateServiceItem(item);
    if (!v.ok) return v;
    normalizedItem = v.item;
  } else {
    normalizedItem = normalizeIncomingItem(item);
    if (!normalizedItem) return { ok: false, message: "invalid_item" };
  }

  const existing = draftApi.readDraft();
  const merge = mergeItemIntoItems(existing.items || [], normalizedItem);
  if (!merge.ok) return merge;

  const draft = buildDraftPatch(existing, merge.items, {
    sourcePage: opts.sourcePage,
    vertical: opts.vertical,
    customerLocation: opts.customerLocation,
    paymentMethod: opts.paymentMethod,
  });

  const write = draftApi.writeDraft(draft);
  if (!write.ok) {
    return { ok: false, message: (write.errors && write.errors[0]) || "تعذر حفظ المسودة", errors: write.errors };
  }

  return {
    ok: true,
    draft: write.draft,
    redirect: opts.redirect !== false ? CHECKOUT_PATH : null,
    merged: merge.merged,
  };
}

function saveCustomerLocationToDraft(draftApi, loc) {
  if (!draftApi || typeof draftApi.readDraft !== "function" || typeof draftApi.writeDraft !== "function") {
    return { ok: false };
  }
  const normalized = normalizeCustomerLocation(loc);
  if (!normalized) return { ok: false };
  const existing = draftApi.readDraft();
  const draft = normalizeOrderDraft({
    ...existing,
    customer_location: normalized,
    meta: { ...existing.meta, updated_at: Date.now() },
  });
  return draftApi.writeDraft(draft);
}

function getDraftItemsFromApi(draftApi) {
  if (!draftApi || typeof draftApi.readDraft !== "function") return [];
  const d = draftApi.readDraft();
  return Array.isArray(d.items) ? d.items : [];
}

module.exports = {
  CHECKOUT_PATH,
  validateSaPhone,
  isMapDeliveryItem,
  mergeItemIntoItems,
  assertSnapshotCompatibleWithItems,
  buildDraftPatch,
  commitItemToDraft,
  saveCustomerLocationToDraft,
  customerLocationFromItems,
  getDraftItemsFromApi,
};
