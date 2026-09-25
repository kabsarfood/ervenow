const { fetchCategoriesFromDb, CATEGORY_SCOPE_STORE } = require("./categoriesDb");
const {
  RESTAURANT_CATEGORY_KEYS,
  RESTAURANT_CATEGORY_LABEL_AR,
  RESTAURANT_CATEGORY_ICONS,
} = require("./restaurantCategories");

const STORE_ACTIVITIES = [
  ["supermarket", "سوبرماركت", "🛒"],
  ["minimarket", "ميني ماركت", "🏪"],
  ["pharmacy", "صيدلية", "💊"],
  ["beauty_care", "تجميل وعناية", "✨"],
  ["flowers_gifts", "ورود وهدايا", "💐"],
  ["clothing", "ملابس", "👗"],
  ["vegetables", "خضار", "🥬"],
  ["butcher", "ملحمة", "🥩"],
  ["fish", "بيع أسماك", "🐟"],
  ["sweets", "حلويات", "🍰"],
  ["home_business", "أسرة منتجة", "🏠"],
  ["other", "غيره", "➕"],
];

const TRANSPORT_ACTIVITIES = [
  ["pickup_truck", "سطحة", "🚛"],
  ["furniture_move", "نقل أثاث", "🛋️"],
  ["internal_delivery", "توصيل طرود", "📦"],
];

const SERVICE_ACTIVITIES = [
  ["plumber", "سباك", "🔧"],
  ["electrician", "كهربائي", "⚡"],
  ["ac_technician", "فني مكيفات", "❄️"],
  ["agricultural_engineer", "تشجير", "🌳"],
  ["laundry_estates", "غسيل وتنظيف فلل وعمائر وشقق", "🧹"],
  ["car_polishing", "تلميع مركبات", "🚗"],
  ["gas_cylinder_swap", "تبديل غاز", "🔥"],
  ["gas_central_refill", "تعبئة غاز", "⛽"],
];

function option(code, label, icon, sort) {
  return {
    option_code: code,
    label_ar: label,
    icon: icon || "",
    image_url: "",
    sort_order: sort,
    active: true,
  };
}

function fromPairs(pairs) {
  return pairs.map(function (row, i) {
    return option(row[0], row[1], row[2], (i + 1) * 10);
  });
}

function mergeDbChildren(base, rows) {
  const byCode = new Map();
  base.forEach(function (item) {
    byCode.set(item.option_code, item);
  });
  (rows || []).forEach(function (row) {
    const code = String(row.slug || "").trim().toLowerCase();
    if (!code) return;
    const prev = byCode.get(code);
    byCode.set(code, {
      option_code: code,
      label_ar: String(row.name_ar || (prev && prev.label_ar) || code),
      icon: String(row.icon || (prev && prev.icon) || ""),
      image_url: String(row.image_url || ""),
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : (prev ? prev.sort_order : 500),
      active: true,
    });
  });
  return Array.from(byCode.values()).sort(function (a, b) {
    return a.sort_order - b.sort_order;
  });
}

async function buildMembershipCatalog(sb) {
  const restaurantBase = RESTAURANT_CATEGORY_KEYS.map(function (slug, i) {
    return option(slug, RESTAURANT_CATEGORY_LABEL_AR[slug] || slug, RESTAURANT_CATEGORY_ICONS[slug] || "", (i + 1) * 10);
  });
  let restaurantChildren = restaurantBase;
  let storeChildren = fromPairs(STORE_ACTIVITIES);
  if (sb) {
    const cuisine = await fetchCategoriesFromDb(sb, "restaurant", CATEGORY_SCOPE_STORE);
    restaurantChildren = mergeDbChildren(restaurantBase, cuisine);
  }
  return [
    { membership_type: "shopper", label_ar: "متسوق", icon: "🛍️", image_url: "", sort_order: 10, kind: "customer", children: [] },
    { membership_type: "store", label_ar: "متجر", icon: "🏪", image_url: "", sort_order: 20, kind: "store_application", children: storeChildren },
    { membership_type: "restaurant", label_ar: "مطعم", icon: "🍽️", image_url: "", sort_order: 30, kind: "store_application", children: restaurantChildren },
    { membership_type: "driver", label_ar: "مندوب توصيل", icon: "🛵", image_url: "", sort_order: 40, kind: "driver_application", children: [] },
    { membership_type: "transport", label_ar: "نقل", icon: "🚛", image_url: "", sort_order: 50, kind: "service_application", children: fromPairs(TRANSPORT_ACTIVITIES) },
    { membership_type: "services", label_ar: "خدمات", icon: "🔧", image_url: "", sort_order: 60, kind: "service_application", children: fromPairs(SERVICE_ACTIVITIES) },
  ];
}

module.exports = { buildMembershipCatalog };
