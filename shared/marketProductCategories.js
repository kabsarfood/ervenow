/**
 * أقسام منتجات السوبرماركت / البقالة في store_products.category
 */

const PRODUCT_CATEGORY_KEYS = [
  "vegetables",
  "meat",
  "dairy",
  "bakery",
  "drinks",
  "snacks",
  "frozen",
  "cleaning",
];

const PRODUCT_CATEGORY_LABEL_AR = {
  vegetables: "خضار وفواكه",
  meat: "لحوم",
  dairy: "ألبان",
  bakery: "مخبوزات",
  drinks: "مشروبات",
  snacks: "سناكات",
  frozen: "مجمدات",
  cleaning: "منظفات",
};

const PRODUCT_CATEGORY_ICONS = {
  vegetables: "🥬",
  meat: "🥩",
  dairy: "🥛",
  bakery: "🥖",
  drinks: "🧃",
  snacks: "🍿",
  frozen: "🧊",
  cleaning: "🧽",
};

const PRODUCT_CATEGORY_SET = new Set(PRODUCT_CATEGORY_KEYS);

/** أنواع متاجر تعرض شريط أقسام المنتجات في store.html */
const MARKET_STORE_TYPES = new Set([
  "supermarket",
  "minimarket",
  "vegetables",
  "butcher",
  "fish",
  "sweets",
  "home_business",
  "flowers_gifts",
  "pharmacy",
  "beauty_care",
]);

function normalizeProductCategory(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return PRODUCT_CATEGORY_SET.has(s) ? s : null;
}

function productCategoryLabelAr(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return PRODUCT_CATEGORY_LABEL_AR[s] || null;
}

function isMarketStoreType(storeType) {
  return MARKET_STORE_TYPES.has(String(storeType || "").trim().toLowerCase());
}

module.exports = {
  PRODUCT_CATEGORY_KEYS,
  PRODUCT_CATEGORY_LABEL_AR,
  PRODUCT_CATEGORY_ICONS,
  PRODUCT_CATEGORY_SET,
  normalizeProductCategory,
  productCategoryLabelAr,
  isMarketStoreType,
};
