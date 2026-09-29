/**
 * ترتيب الصفحة الرئيسية: تقييم بحد أدنى، وطلب مكتمل داخل نافذة زمنية.
 * لا يختلق أرقاماً تسويقية.
 */

const MIN_RATING_COUNT = 5;
const DEMAND_WINDOW_DAYS = 30;

const STORE_TYPE_LABEL_AR = {
  pharmacy: "صيدليات",
  supermarket: "سوبرماركت",
  minimarket: "ميني ماركت",
  vegetables: "خضار",
  butcher: "ملحمة",
  fish: "أسماك",
  home_business: "أسرة منتجة",
  flowers_gifts: "ورود وهدايا",
  beauty_care: "تجميل",
  clothing: "ملابس",
  sweets: "حلويات",
};

const DELIVERY_LINKS = {
  car_transport: { label: "سطحات", href: "/delivery-services.html?service=car_transport" },
  flatbed: { label: "سطحات", href: "/delivery-services.html?service=car_transport" },
  gas_delivery: { label: "غاز", href: "/delivery-services.html?service=gas_delivery" },
  gas: { label: "غاز", href: "/delivery-services.html?service=gas_delivery" },
  local_delivery: { label: "طرود", href: "/delivery-services.html?service=local_delivery" },
  parcel: { label: "طرود", href: "/delivery-services.html?service=local_delivery" },
  delivery: { label: "توصيل", href: "/delivery-services.html" },
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function completedStatus(order) {
  const s = String((order && (order.delivery_status || order.status)) || "")
    .trim()
    .toLowerCase();
  return s === "delivered" || s === "completed";
}

function laneForStoreType(type) {
  return String(type || "").trim().toLowerCase() === "restaurant" ? "restaurant" : "store";
}

function laneForServiceType(serviceType) {
  const s = String(serviceType || "").trim().toLowerCase();
  if (!s) return "service";
  if (DELIVERY_LINKS[s]) return "delivery";
  return "service";
}

function categorySlugs(raw) {
  return String(raw || "")
    .split(/[,\u00b7|/]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function topChips(rows, limit) {
  const cap = limit > 0 ? limit : 3;
  return (rows || [])
    .filter((row) => row && row.label && row.href && num(row.count) > 0)
    .sort((a, b) => num(b.count) - num(a.count) || String(a.label).localeCompare(String(b.label), "ar"))
    .slice(0, cap)
    .map((row) => ({ label: String(row.label), href: String(row.href) }));
}

function restaurantChips(stores, labelForSlug) {
  const counts = new Map();
  (stores || []).forEach((store) => {
    if (laneForStoreType(store && store.type) !== "restaurant") return;
    categorySlugs(store.category).forEach((slug) => {
      const label = labelForSlug ? labelForSlug(slug) : null;
      if (!label) return;
      const prev = counts.get(slug) || { label, href: "/restaurants?category=" + encodeURIComponent(slug), count: 0 };
      prev.count += 1;
      counts.set(slug, prev);
    });
  });
  return topChips([...counts.values()], 3);
}

function storeTypeChips(stores) {
  const counts = new Map();
  (stores || []).forEach((store) => {
    const type = String((store && store.type) || "").trim().toLowerCase();
    if (!type || type === "restaurant") return;
    const label = STORE_TYPE_LABEL_AR[type];
    if (!label) return;
    const prev = counts.get(type) || { label, href: "/stores?type=" + encodeURIComponent(type), count: 0 };
    prev.count += 1;
    counts.set(type, prev);
  });
  return topChips([...counts.values()], 3);
}

function serviceChips(serviceCounts, catalogLabels) {
  const rows = [];
  const seen = new Set();
  (serviceCounts || []).forEach((row) => {
    const key = String(row && row.key || "").trim().toLowerCase();
    if (!key || DELIVERY_LINKS[key] || seen.has(key)) return;
    const label = catalogLabels && catalogLabels[key];
    if (!label) return;
    seen.add(key);
    rows.push({ label, href: "/services", count: num(row.count) });
  });
  return topChips(rows, 3);
}

function deliveryChips(serviceCounts) {
  const rows = [];
  const seen = new Set();
  (serviceCounts || []).forEach((row) => {
    const key = String(row && row.key || "").trim().toLowerCase();
    const link = DELIVERY_LINKS[key];
    if (!link || seen.has(link.href)) return;
    seen.add(link.href);
    rows.push({ label: link.label, href: link.href, count: num(row.count) });
  });
  return topChips(rows, 3);
}

function rankTopRated(items, minCount) {
  const min = minCount == null ? MIN_RATING_COUNT : Number(minCount);
  return (items || [])
    .filter((item) => num(item && item.rating_count) >= min && num(item && item.rating_avg) > 0)
    .slice()
    .sort((a, b) => {
      const avg = num(b.rating_avg) - num(a.rating_avg);
      if (avg !== 0) return avg;
      return num(b.rating_count) - num(a.rating_count);
    });
}

function aggregateDemand(orders, sinceIso) {
  const sinceMs = new Date(sinceIso).getTime();
  const byStore = new Map();
  const byService = new Map();
  const cities = new Set();
  (orders || []).forEach((order) => {
    if (!order) return;
    const created = new Date(order.created_at).getTime();
    if (!Number.isFinite(sinceMs) || !Number.isFinite(created) || created < sinceMs) return;
    if (!completedStatus(order)) return;
    const city = String(order.city || "").trim();
    if (city) cities.add(city);
    if (order.store_id) {
      const id = String(order.store_id);
      byStore.set(id, (byStore.get(id) || 0) + 1);
      return;
    }
    const key = String(order.service_type || order.order_type || "").trim().toLowerCase();
    if (!key) return;
    byService.set(key, (byService.get(key) || 0) + 1);
  });
  return {
    byStore,
    byService,
    cities,
    serviceCounts: [...byService.entries()].map(([key, count]) => ({ key, count })),
  };
}

function rankMostOrdered(cards, demandById) {
  return (cards || [])
    .map((card) => ({
      ...card,
      recent_orders: demandById && card && card.id != null ? num(demandById.get(String(card.id))) : 0,
    }))
    .filter((card) => card.recent_orders > 0)
    .sort((a, b) => {
      const orders = b.recent_orders - a.recent_orders;
      if (orders !== 0) return orders;
      const distA = a.distance_km == null ? Infinity : num(a.distance_km);
      const distB = b.distance_km == null ? Infinity : num(b.distance_km);
      if (distA !== distB) return distA - distB;
      return num(b.rating_avg) - num(a.rating_avg);
    });
}

function buildPublicStats(input) {
  const src = input || {};
  const cfg = src.settings && typeof src.settings === "object" && !Array.isArray(src.settings) ? src.settings : {};
  const stats = [];
  function pushCount(key, settingValue, dbValue, label) {
    const settingN = Number(settingValue);
    const dbN = Number(dbValue);
    const n = Number.isFinite(settingN) && settingN > 0 ? settingN : Number.isFinite(dbN) && dbN > 0 ? dbN : 0;
    if (n > 0) stats.push({ key, value: String(Math.round(n)), label });
  }
  pushCount("customers", cfg.customers, src.customerCount, "عدد العملاء");
  pushCount("stores", cfg.stores, src.storeCount, "متجر نشط");
  pushCount("cities", cfg.cities, src.cityCount, "المدن المخدومة");
  const minutes = Number(cfg.delivery_minutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    stats.push({ key: "delivery", value: Math.round(minutes) + " دقيقة", label: "توصيل سريع" });
  }
  return stats;
}

function demandSinceIso(now, days) {
  const windowDays = days > 0 ? days : DEMAND_WINDOW_DAYS;
  const base = now instanceof Date ? now : new Date();
  return new Date(base.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  MIN_RATING_COUNT,
  DEMAND_WINDOW_DAYS,
  STORE_TYPE_LABEL_AR,
  DELIVERY_LINKS,
  completedStatus,
  laneForStoreType,
  laneForServiceType,
  topChips,
  restaurantChips,
  storeTypeChips,
  serviceChips,
  deliveryChips,
  rankTopRated,
  aggregateDemand,
  rankMostOrdered,
  buildPublicStats,
  demandSinceIso,
};
