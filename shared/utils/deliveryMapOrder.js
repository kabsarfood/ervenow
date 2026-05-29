/**
 * بيانات طلب «توصيل من الخريطة» — مشترك بين الخادم والواجهة.
 */

const PRODUCT_TYPES = {
  clothes: "ملابس",
  bag: "شنطة / حقيبة",
  groceries: "مواد غذائية",
  kitchenware: "أواني",
  documents: "مستندات",
  electronics: "إلكترونيات",
  other: "أخرى",
};

function buildGoogleMapsUrl(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${la},${ln}`)}`;
}

function getProductLabel(typeKey, note) {
  const key = String(typeKey || "other").toLowerCase();
  const base = PRODUCT_TYPES[key] || PRODUCT_TYPES.other;
  const n = String(note || "").trim();
  if (key === "other" && n) return n.slice(0, 120);
  if (n) return `${base} — ${n.slice(0, 80)}`;
  return base;
}

function formatProductLine(typeKey, qty, note) {
  const q = Math.max(1, Math.min(99, parseInt(String(qty || "1"), 10) || 1));
  return `${getProductLabel(typeKey, note)} × ${q}`;
}

function isMapDeliveryOrder(order) {
  if (!order) return false;
  if (/توصيل من الخريطة|dashboard_map/i.test(String(order.notes || ""))) return true;
  const items = order.breakdown && Array.isArray(order.breakdown.items) ? order.breakdown.items : [];
  if (!items.length) return false;
  const d = items[0] && items[0].data ? items[0].data : {};
  return String(d.source || "") === "dashboard_map";
}

function productLineFromOrder(order) {
  const items =
    order && order.breakdown && Array.isArray(order.breakdown.items) ? order.breakdown.items : [];
  const first = items[0] || {};
  const d = first.data && typeof first.data === "object" ? first.data : {};
  if (d.product_label) return String(d.product_label);
  if (d.product_category) {
    return formatProductLine(d.product_category, d.product_qty || d.qty || 1, d.product_note);
  }
  return String(first.title || "طلب توصيل").trim() || "طلب توصيل";
}

function pickupLinkFromOrder(order) {
  const od = order && order.data && typeof order.data === "object" ? order.data : {};
  if (od.pickup_maps_url) return String(od.pickup_maps_url);
  return buildGoogleMapsUrl(order.pickup_lat, order.pickup_lng) || String(order.pickup_address || "").trim();
}

function dropLinkFromOrder(order) {
  const od = order && order.data && typeof order.data === "object" ? order.data : {};
  if (od.drop_maps_url) return String(od.drop_maps_url);
  return buildGoogleMapsUrl(order.drop_lat, order.drop_lng) || String(order.drop_address || "").trim();
}

module.exports = {
  PRODUCT_TYPES,
  buildGoogleMapsUrl,
  getProductLabel,
  formatProductLine,
  isMapDeliveryOrder,
  productLineFromOrder,
  pickupLinkFromOrder,
  dropLinkFromOrder,
};
