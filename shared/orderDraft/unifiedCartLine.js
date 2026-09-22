/**
 * Unified Cart line + Fulfillment Groups.
 * يعمل فوق شكل المسودة الحالي (type/title/price/data) دون كسر Draft قديمة.
 */

const WORKFLOW = Object.freeze({
  STORE: "store",
  SERVICE: "service",
  TRANSPORT: "transport",
  DELIVERY: "delivery",
});

const TRANSPORT_TYPES = Object.freeze({
  pickup_truck: 1,
  furniture_move: 1,
  vehicle_transfer: 1,
  car_transport: 1,
});

const DELIVERY_TYPES = Object.freeze({
  delivery: 1,
  internal_delivery: 1,
});

const STORE_TYPE_HINTS = Object.freeze({
  restaurant: 1,
  store: 1,
  supermarket: 1,
  pharmacy: 1,
  minimarket: 1,
  vegetables: 1,
  butcher: 1,
  fish: 1,
  home_business: 1,
  flowers_gifts: 1,
  beauty_care: 1,
  clothing: 1,
  sweets: 1,
  other: 1,
});

function isStoreProductLine(item) {
  const d = item && item.data;
  return !!(d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "");
}

function isMapDeliveryLine(item) {
  const d = item && item.data;
  if (!d || typeof d !== "object") return false;
  if (String(d.source || "") === "dashboard_map") return true;
  return (
    String((item && item.type) || "") === "delivery" &&
    Number.isFinite(Number(d.pickup_lat)) &&
    Number.isFinite(Number(d.drop_lat))
  );
}

function inferWorkflow(item) {
  const explicit = String((item && item.workflow) || "").toLowerCase();
  if (explicit === WORKFLOW.STORE || explicit === WORKFLOW.SERVICE || explicit === WORKFLOW.TRANSPORT || explicit === WORKFLOW.DELIVERY) {
    return explicit;
  }
  const t = String((item && item.type) || "").toLowerCase();
  const d = (item && item.data) || {};
  if (isStoreProductLine(item)) return WORKFLOW.STORE;
  if (TRANSPORT_TYPES[t]) return WORKFLOW.TRANSPORT;
  if (DELIVERY_TYPES[t] || isMapDeliveryLine(item)) return WORKFLOW.DELIVERY;
  if (d.store_id && STORE_TYPE_HINTS[t]) return WORKFLOW.STORE;
  return WORKFLOW.SERVICE;
}

function inferSource(item, workflow) {
  if (item && item.source != null && String(item.source).trim()) return String(item.source).trim();
  const t = String((item && item.type) || "").toLowerCase();
  const d = (item && item.data) || {};
  if (workflow === WORKFLOW.STORE) {
    const st = String(d.store_type || t || "").toLowerCase();
    if (st === "restaurant" || /مطعم|restaurant/i.test(String(d.store_name || d.merchant_name || ""))) {
      return "restaurant";
    }
    return st || "store";
  }
  if (t === "gas_delivery" || t === "gas_cylinder_swap" || t === "gas_central_refill") return "gas";
  if (t === "pickup_truck") return "tow";
  if (t === "furniture_move") return "furniture";
  if (t === "internal_delivery" || t === "delivery") return "courier";
  if (t === "car_polishing") return "car_polishing";
  return t || workflow;
}

function fulfillmentGroupKey(line, index) {
  const wf = line.workflow;
  const id = line.id != null ? String(line.id) : String(index);
  if (wf === WORKFLOW.STORE) return `store:${line.provider_id || "unknown"}`;
  const type = String(line.type || line.source || "service").toLowerCase();
  if (wf === WORKFLOW.TRANSPORT) return `transport:${type}:${id}`;
  if (wf === WORKFLOW.DELIVERY) return `delivery:${id}`;
  return `service:${type}:${id}`;
}

function stripRepeatedMerchantPrefix(name, kind) {
  let n = String(name || "").trim();
  if (kind === "restaurant") {
    n = n.replace(/^مطعم(?:\s+ال)?\s+/u, "").replace(/^مطعم\s+/u, "").trim();
  }
  return n || String(name || "").trim();
}

function groupHeadingAr(group) {
  const wf = group.workflow;
  const first = (group.items && group.items[0]) || {};
  const d = first.data || {};
  if (wf === WORKFLOW.STORE) {
    const rawName = String(d.store_name || first.title || "متجر").trim();
    if (group.source === "restaurant" || inferSource(first, wf) === "restaurant") {
      return `طلبك من مطعم ${stripRepeatedMerchantPrefix(rawName, "restaurant")}`;
    }
    return `طلبك من ${rawName}`;
  }
  if (wf === WORKFLOW.TRANSPORT) {
    const t = String(first.type || "").toLowerCase();
    if (t === "pickup_truck") return "خدمة سطحة";
    if (t === "furniture_move") return "نقل أثاث";
    if (t === "car_transport" || t === "vehicle_transfer") return "نقل مركبات";
    const transportTitle = String(first.title || "").trim();
    return transportTitle || "نقل مركبات";
  }
  if (wf === WORKFLOW.DELIVERY) return "توصيل";
  const t = String(first.type || "").toLowerCase();
  if (t === "gas_delivery") return "خدمة غاز";
  if (t === "car_polishing") return "تلميع المركبات";
  const title = String(first.title || "").trim();
  return title ? `خدمة: ${title}` : "خدمة";
}

function locationFromItem(item) {
  if (item && item.location && typeof item.location === "object") return item.location;
  const d = (item && item.data) || {};
  const loc = {};
  if (Number.isFinite(Number(d.pickup_lat))) {
    loc.pickup = { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address || d.from || null };
  }
  if (Number.isFinite(Number(d.drop_lat))) {
    loc.drop = { lat: Number(d.drop_lat), lng: Number(d.drop_lng), address: d.drop_address || d.to || d.location || null };
  }
  return Object.keys(loc).length ? loc : null;
}

function normalizeUnifiedCartLine(item, index) {
  if (!item || typeof item !== "object") return null;
  const data = item.data && typeof item.data === "object" ? Object.assign({}, item.data) : {};
  const workflow = inferWorkflow(item);
  const source = inferSource(item, workflow);
  const provider_id =
    item.provider_id != null && String(item.provider_id).trim()
      ? String(item.provider_id).trim()
      : data.store_id != null && String(data.store_id).trim()
        ? String(data.store_id).trim()
        : null;
  const item_id =
    item.item_id != null && String(item.item_id).trim()
      ? String(item.item_id).trim()
      : data.product_id != null && String(data.product_id).trim() !== ""
        ? String(data.product_id)
        : null;
  const qty = Math.max(1, Math.min(99, Number(item.qty != null ? item.qty : data.qty) || 1));
  const notes = String(
    item.notes != null ? item.notes : data.order_notes || data.notes || data.customer_notes || ""
  )
    .trim()
    .slice(0, 500);
  const scheduled_at = item.scheduled_at || data.scheduled_at || data.execution_time || null;
  const line = Object.assign({}, item, {
    workflow,
    source,
    provider_id,
    item_id,
    title: item.title || data.product_name || "",
    price: Number(item.price) || 0,
    qty,
    notes,
    scheduled_at,
    location: locationFromItem(item),
    data,
    draft_index: item.draft_index != null ? item.draft_index : index,
  });
  if (line.id == null) line.id = Date.now() + (Number(index) || 0);
  line.group_key = fulfillmentGroupKey(line, index);
  return line;
}

function normalizeUnifiedCartItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it, idx) => normalizeUnifiedCartLine(it, idx))
    .filter(Boolean);
}

function groupFulfillmentItems(items) {
  const list = normalizeUnifiedCartItems(items);
  const storeMap = new Map();
  const others = [];
  list.forEach((line) => {
    if (line.workflow === WORKFLOW.STORE && line.provider_id) {
      const key = `store:${line.provider_id}`;
      if (!storeMap.has(key)) {
        storeMap.set(key, {
          key,
          workflow: WORKFLOW.STORE,
          source: line.source,
          provider_id: line.provider_id,
          items: [],
        });
      }
      storeMap.get(key).items.push(line);
      return;
    }
    others.push({
      key: line.group_key,
      workflow: line.workflow,
      source: line.source,
      provider_id: line.provider_id,
      items: [line],
    });
  });
  const out = [...storeMap.values(), ...others];
  out.forEach((g) => {
    g.heading_ar = groupHeadingAr(g);
  });
  return out;
}

function splitFulfillmentBatches(type, groupItems) {
  const list = Array.isArray(groupItems) ? groupItems : [];
  if (type === "delivery") return list.map((it) => [it]);
  if (type === "store" || type === "restaurant") {
    const map = new Map();
    list.forEach((i) => {
      const sid = String((i && i.data && i.data.store_id) || (i && i.provider_id) || "").trim() || "_none";
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid).push(i);
    });
    return [...map.values()];
  }
  return [list];
}

module.exports = {
  WORKFLOW,
  TRANSPORT_TYPES,
  DELIVERY_TYPES,
  isStoreProductLine,
  isMapDeliveryLine,
  inferWorkflow,
  inferSource,
  fulfillmentGroupKey,
  groupHeadingAr,
  normalizeUnifiedCartLine,
  normalizeUnifiedCartItems,
  groupFulfillmentItems,
  splitFulfillmentBatches,
};
