/**
 * ربط نوع المتجر (stores.type) بنوع أقسام المنتجات (categories.type + scope=product)
 */

const {
  RESTAURANT_CATEGORY_KEYS,
  RESTAURANT_CATEGORY_LABEL_AR,
  RESTAURANT_CATEGORY_ICONS,
  RESTAURANT_CATEGORY_SET,
} = require("./restaurantCategories");
const {
  PRODUCT_CATEGORY_KEYS,
  PRODUCT_CATEGORY_LABEL_AR,
  PRODUCT_CATEGORY_ICONS,
  PRODUCT_CATEGORY_SET,
} = require("./marketProductCategories");

/** أنواع أقسام المنتجات في جدول categories */
const PRODUCT_CATALOG_TYPES = [
  "restaurant",
  "market",
  "pharmacy",
  "services",
  "transport",
  "fuel",
  "clothing",
];

const PRODUCT_CATALOG_TYPE_SET = new Set(PRODUCT_CATALOG_TYPES);

const PHARMACY_BUILTIN = {
  medicines: { label: "أدوية", icon: "💊" },
  vitamins: { label: "فيتامينات ومكملات", icon: "🧴" },
  cosmetics: { label: "عناية وتجميل", icon: "✨" },
  baby_care: { label: "أم وطفل", icon: "👶" },
  medical_devices: { label: "أجهزة طبية", icon: "🩺" },
};

const SERVICES_BUILTIN = {
  home_maintenance: { label: "صيانة منزلية", icon: "🔧" },
  installation: { label: "تركيب", icon: "🛠️" },
  cleaning_service: { label: "تنظيف", icon: "🧹" },
  consultation: { label: "استشارات", icon: "📋" },
  packages: { label: "باقات خدمات", icon: "📦" },
};

const TRANSPORT_BUILTIN = {
  local_delivery: { label: "توصيل داخل المدينة", icon: "🚚" },
  intercity: { label: "نقل بين المدن", icon: "🛣️" },
  heavy_cargo: { label: "بضائع ثقيلة", icon: "📦" },
  vehicle_move: { label: "نقل مركبات", icon: "🚗" },
  furniture_move: { label: "نقل أثاث", icon: "🛋️" },
};

const FUEL_BUILTIN = {
  gas_cylinder: { label: "أسطوانات غاز", icon: "🔥" },
  gas_refill: { label: "تعبئة غاز", icon: "⛽" },
  fuel_station_shop: { label: "منتجات المحطة", icon: "🏪" },
  car_care: { label: "عناية بالمركبة", icon: "🚘" },
};

const CLOTHING_BUILTIN = {
  women: { label: "ملابس نسائية", icon: "👗" },
  men: { label: "ملابس رجالية", icon: "👔" },
  kids: { label: "ملابس أطفال", icon: "👶" },
  abayas: { label: "عبايات", icon: "🧕" },
  sportswear: { label: "ملابس رياضية", icon: "🏃" },
  underwear: { label: "ملابس داخلية", icon: "🩲" },
  shoes_bags: { label: "أحذية وشنط", icon: "👜" },
  occasions: { label: "أزياء ومناسبات", icon: "✨" },
  shoes: { label: "أحذية", icon: "👟" },
  accessories: { label: "إكسسوارات", icon: "👜" },
};

const CLOTHING_REGISTER_SLUGS = [
  "women",
  "men",
  "kids",
  "abayas",
  "sportswear",
  "underwear",
  "shoes_bags",
  "occasions",
];

const RESTAURANT_MENU_EXTRA = {
  appetizers: { label: "مقبلات", icon: "🥗" },
  main_dishes: { label: "أطباق رئيسية", icon: "🍽️" },
  drinks_menu: { label: "مشروبات", icon: "🥤" },
};

const MARKET_STORE_TYPES = new Set([
  "supermarket",
  "minimarket",
  "vegetables",
  "butcher",
  "fish",
  "sweets",
  "home_business",
  "flowers_gifts",
  "beauty_care",
]);

const SERVICES_STORE_TYPES = new Set([
  "services",
  "plumber",
  "electrician",
  "cleaning",
  "nursery",
  "ac_technician",
]);

const TRANSPORT_STORE_TYPES = new Set([
  "vehicle_transfer",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
]);

function normalizeProductCatalogType(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return PRODUCT_CATALOG_TYPE_SET.has(s) ? s : null;
}

/** نوع أقسام المنتجات حسب نوع المتجر */
function productCatalogTypeForStoreType(storeType) {
  const t = String(storeType || "")
    .trim()
    .toLowerCase();
  if (t === "restaurant") return "restaurant";
  if (t === "pharmacy") return "pharmacy";
  if (MARKET_STORE_TYPES.has(t)) return "market";
  if (SERVICES_STORE_TYPES.has(t)) return "services";
  if (TRANSPORT_STORE_TYPES.has(t)) return "transport";
  if (t === "gas_delivery") return "fuel";
  if (t === "clothing" || t === "fashion" || t === "apparel") return "clothing";
  if (t === "other") return "market";
  return "market";
}

function builtinCatalogEntries(catalogType) {
  const type = normalizeProductCatalogType(catalogType) || "market";
  const out = [];
  const push = (slug, label, icon, sort) => {
    out.push({ slug, label, icon, sort_order: sort });
  };

  if (type === "restaurant") {
    let i = 0;
    RESTAURANT_CATEGORY_KEYS.forEach((slug) => {
      i += 10;
      push(slug, RESTAURANT_CATEGORY_LABEL_AR[slug] || slug, RESTAURANT_CATEGORY_ICONS[slug] || "🍽️", i);
    });
    Object.keys(RESTAURANT_MENU_EXTRA).forEach((slug) => {
      i += 10;
      const x = RESTAURANT_MENU_EXTRA[slug];
      push(slug, x.label, x.icon, i);
    });
    return out;
  }

  if (type === "market") {
    let i = 0;
    PRODUCT_CATEGORY_KEYS.forEach((slug) => {
      i += 10;
      push(slug, PRODUCT_CATEGORY_LABEL_AR[slug] || slug, PRODUCT_CATEGORY_ICONS[slug] || "📦", i);
    });
    return out;
  }

  const maps = {
    pharmacy: PHARMACY_BUILTIN,
    services: SERVICES_BUILTIN,
    transport: TRANSPORT_BUILTIN,
    fuel: FUEL_BUILTIN,
    clothing: CLOTHING_BUILTIN,
  };
  const m = maps[type] || {};
  let i = 0;
  Object.keys(m).forEach((slug) => {
    i += 10;
    push(slug, m[slug].label, m[slug].icon, i);
  });
  return out;
}

function builtinSlugSet(catalogType) {
  return new Set(builtinCatalogEntries(catalogType).map((e) => e.slug));
}

function normalizeProductSlugForCatalog(catalogType, value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const type = normalizeProductCatalogType(catalogType) || "market";
  if (type === "restaurant" && RESTAURANT_CATEGORY_SET.has(s)) return s;
  if (type === "market" && PRODUCT_CATEGORY_SET.has(s)) return s;
  if (builtinSlugSet(type).has(s)) return s;
  return null;
}

function labelForProductSlug(catalogType, slug, dbLabel) {
  if (dbLabel) return dbLabel;
  const s = String(slug || "").trim().toLowerCase();
  const type = normalizeProductCatalogType(catalogType) || "market";
  if (type === "restaurant") return RESTAURANT_CATEGORY_LABEL_AR[s] || RESTAURANT_MENU_EXTRA[s]?.label || null;
  if (type === "market") return PRODUCT_CATEGORY_LABEL_AR[s] || null;
  const maps = {
    pharmacy: PHARMACY_BUILTIN,
    services: SERVICES_BUILTIN,
    transport: TRANSPORT_BUILTIN,
    fuel: FUEL_BUILTIN,
    clothing: CLOTHING_BUILTIN,
  };
  return maps[type]?.[s]?.label || null;
}

function iconForProductSlug(catalogType, slug, dbIcon) {
  if (dbIcon) return dbIcon;
  const s = String(slug || "").trim().toLowerCase();
  const type = normalizeProductCatalogType(catalogType) || "market";
  if (type === "restaurant") return RESTAURANT_CATEGORY_ICONS[s] || RESTAURANT_MENU_EXTRA[s]?.icon || "🍽️";
  if (type === "market") return PRODUCT_CATEGORY_ICONS[s] || "📦";
  const maps = {
    pharmacy: PHARMACY_BUILTIN,
    services: SERVICES_BUILTIN,
    transport: TRANSPORT_BUILTIN,
    fuel: FUEL_BUILTIN,
    clothing: CLOTHING_BUILTIN,
  };
  return maps[type]?.[s]?.icon || "📦";
}

function storeSupportsProductCategoryBrowse(storeType) {
  return !!productCatalogTypeForStoreType(storeType);
}

function isMarketStoreType(storeType) {
  return MARKET_STORE_TYPES.has(String(storeType || "").trim().toLowerCase());
}

module.exports = {
  PRODUCT_CATALOG_TYPES,
  PRODUCT_CATALOG_TYPE_SET,
  CLOTHING_BUILTIN,
  CLOTHING_REGISTER_SLUGS,
  productCatalogTypeForStoreType,
  normalizeProductCatalogType,
  builtinCatalogEntries,
  builtinSlugSet,
  normalizeProductSlugForCatalog,
  labelForProductSlug,
  iconForProductSlug,
  storeSupportsProductCategoryBrowse,
  isMarketStoreType,
};
