/**
 * تحويل صف متجر إلى عنصر خريطة حية (بدون بيانات حساسة).
 */
const { resolveMapColorForStoreType, mapCategoryFromStoreType } = require("./mapCategoryColors");
const { restaurantCategoryLabelAr } = require("../restaurantCategories");
const { parseStoreCategorySlugs } = require("./storeCategorySlugs");
const { labelForProductSlug } = require("../productCategoryTypes");

const TYPE_LABEL_AR = {
  restaurant: "مطعم",
  pharmacy: "صيدلية",
  supermarket: "سوبرماركت",
  minimarket: "بقالة",
  vegetables: "خضار وفواكه",
  butcher: "لحوم",
  fish: "أسماك",
  home_business: "أسرة منتجة",
  services: "خدمات",
  service: "خدمات",
  flowers_gifts: "ورود وهدايا",
  beauty_care: "التجميل والعناية",
  clothing: "الملابس والأزياء",
  sweets: "حلويات",
  other: "متجر",
};

function categoryLabelForLiveMap(row) {
  if (!row) return "—";
  const t = String(row.type || "").toLowerCase();
  if (row.category) {
    const slugs = parseStoreCategorySlugs(row.category);
    if (t === "restaurant") {
      const labs = slugs.map((s) => restaurantCategoryLabelAr(s) || s).filter(Boolean);
      if (labs.length) return labs.join(" · ");
    }
    if (t === "clothing") {
      const labs = slugs.map((s) => labelForProductSlug("clothing", s) || s).filter(Boolean);
      if (labs.length) return labs.join(" · ");
    }
  }
  return TYPE_LABEL_AR[t] || TYPE_LABEL_AR.other;
}

function deliveryEtaLabel(row) {
  const eta = Number(row.delivery_eta_minutes);
  if (Number.isFinite(eta) && eta > 0) return eta + " د";
  const radius = Number(row.delivery_radius_km);
  if (Number.isFinite(radius) && radius > 0) return "حتى " + Math.round(radius * 3 + 15) + " د";
  return "—";
}

function liveMapStorePayload(row, opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  const settings = opts.branding || opts.settings || {};
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = String(row.type || "").toLowerCase();
  const rating = Number(row.average_rating) || 0;
  const ratingCount = Number(row.rating_count) || 0;

  return {
    id: row.id,
    name: row.name,
    type: type,
    map_category: mapCategoryFromStoreType(type),
    category_label: categoryLabelForLiveMap(row),
    lat: lat,
    lng: lng,
    maps_url: row.maps_url || null,
    logo_url: row.logo_url || null,
    address: row.address || row.location_text || null,
    is_open: row.is_active !== false,
    open_label: row.is_active !== false ? "مفتوح" : "مغلق",
    average_rating: rating,
    rating_count: ratingCount,
    rating_label: ratingCount > 0 ? rating.toFixed(1) + " (" + ratingCount + ")" : "—",
    delivery_eta_label: deliveryEtaLabel(row),
    store_url: "/store.html?id=" + encodeURIComponent(String(row.id)),
    order_url: "/store.html?id=" + encodeURIComponent(String(row.id)) + "#order",
    color: resolveMapColorForStoreType(type, settings),
  };
}

module.exports = {
  liveMapStorePayload,
  categoryLabelForLiveMap,
};
