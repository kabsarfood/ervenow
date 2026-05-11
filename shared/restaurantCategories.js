/**
 * تصنيفات مطاعم ERVENOW — قيمة عمود stores.category عندما يكون type = 'restaurant'
 * (لا تُستخدم كـ type للمتجر؛ type يبقى restaurant)
 *
 * القائمة الافتراضية للعرض والتسجيل = RESTAURANT_CATEGORY_KEYS (ترتيب العرض).
 * LEGACY_* للمتاجر المسجّلة سابقاً بـ slugs قديمة — تبقى صالحة للتحقق والعرض.
 */

const LEGACY_RESTAURANT_CATEGORY_SLUGS = [
  "bukhari_mandi",
  "burger_broasted",
  "kabsa",
  "breakfast_bakery",
  "dessert_cafe",
  "juice_drinks",
];

/** ترتيب العرض الافتراضي (قوائم API + تسجيل متجر) */
const RESTAURANT_CATEGORY_KEYS = [
  "kabsa_bukhari",
  "shawarma_grill",
  "seafood",
  "burger",
  "broasted",
  "pizza",
  "cafe",
  "sweets",
  "home_producers",
];

const RESTAURANT_CATEGORY_LABEL_AR = {
  kabsa_bukhari: "مطاعم كبسة وبخاري",
  shawarma_grill: "مطاعم شاورما ومشاوي",
  seafood: "مطاعم سمك",
  burger: "مطاعم برقر",
  broasted: "مطاعم بروستد",
  pizza: "مطاعم بيتزا",
  cafe: "مقاهي",
  sweets: "حلويات",
  home_producers: "أسر منتجة",
  /* قيم قديمة — تبقى معترفاً بها */
  bukhari_mandi: "بخاري ومندي (تصنيف سابق)",
  burger_broasted: "برقر وبروستد (تصنيف سابق)",
  kabsa: "كبسة (تصنيف سابق)",
  breakfast_bakery: "فطور ومخابز (تصنيف سابق)",
  dessert_cafe: "حلويات وقهوة (تصنيف سابق)",
  juice_drinks: "عصائر ومشروبات (تصنيف سابق)",
};

const RESTAURANT_CATEGORY_ICONS = {
  kabsa_bukhari: "🍚",
  shawarma_grill: "🌯",
  seafood: "🐟",
  burger: "🍔",
  broasted: "🍗",
  pizza: "🍕",
  cafe: "☕",
  sweets: "🍰",
  home_producers: "🏠",
  bukhari_mandi: "🍚",
  burger_broasted: "🍔",
  kabsa: "🍗",
  breakfast_bakery: "🥐",
  dessert_cafe: "🍰",
  juice_drinks: "🥤",
};

const RESTAURANT_CATEGORY_SET = new Set([...RESTAURANT_CATEGORY_KEYS, ...LEGACY_RESTAURANT_CATEGORY_SLUGS]);

function isRestaurantCategoryKey(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return RESTAURANT_CATEGORY_SET.has(s);
}

function normalizeRestaurantCategory(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return RESTAURANT_CATEGORY_SET.has(s) ? s : null;
}

function restaurantCategoryLabelAr(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return RESTAURANT_CATEGORY_LABEL_AR[s] || null;
}

/** تسمية عرض للمطاعم فقط — قيم قديمة أو غير معروفة تبقى ظاهرة تحت «الكل» وليس تحت فلتر مطبخ محدّد */
function restaurantCategoryDisplayAr(categoryValue, storeType) {
  const t = String(storeType || "")
    .trim()
    .toLowerCase();
  if (t !== "restaurant") return null;
  const s = String(categoryValue == null ? "" : categoryValue)
    .trim()
    .toLowerCase();
  if (RESTAURANT_CATEGORY_LABEL_AR[s]) return RESTAURANT_CATEGORY_LABEL_AR[s];
  if (!s || s === "restaurant") return "مطعم (تصنيف عام — قديم أو غير محدّد)";
  return "مطعم (تصنيف قديم)";
}

/** هل category للمطعم لا يطابق أي slug مطبخ حديث؟ */
function isLegacyOrUnknownRestaurantCategory(value, storeType) {
  if (String(storeType || "")
    .trim()
    .toLowerCase() !== "restaurant") {
    return false;
  }
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (!s || s === "restaurant") return true;
  return !RESTAURANT_CATEGORY_SET.has(s);
}

/** هل يطابق فلتر المطبخ المطلوب (slug معتمد فقط)؟ allowedSlugs اختياري: دمج أقسام من قاعدة البيانات */
function restaurantRowMatchesCuisineFilter(row, cuisineSlug, allowedSlugs) {
  const want = String(cuisineSlug || "")
    .trim()
    .toLowerCase();
  const valid = allowedSlugs && allowedSlugs.size ? allowedSlugs : RESTAURANT_CATEGORY_SET;
  if (!want || !valid.has(want)) return true;
  if (String(row.type || "")
    .trim()
    .toLowerCase() !== "restaurant") {
    return false;
  }
  const c = String(row.category || "")
    .trim()
    .toLowerCase();
  return c === want;
}

module.exports = {
  RESTAURANT_CATEGORY_KEYS,
  LEGACY_RESTAURANT_CATEGORY_SLUGS,
  RESTAURANT_CATEGORY_LABEL_AR,
  RESTAURANT_CATEGORY_ICONS,
  RESTAURANT_CATEGORY_SET,
  isRestaurantCategoryKey,
  normalizeRestaurantCategory,
  restaurantCategoryLabelAr,
  restaurantCategoryDisplayAr,
  isLegacyOrUnknownRestaurantCategory,
  restaurantRowMatchesCuisineFilter,
};
