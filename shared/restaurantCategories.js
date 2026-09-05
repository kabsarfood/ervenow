/**
 * تصنيفات مطاعم ERVENOW — قيمة عمود stores.category عندما يكون type = 'restaurant'
 * (لا تُستخدم كـ type للمتجر؛ type يبقى restaurant)
 *
 * القائمة الافتراضية للعرض والتسجيل = RESTAURANT_CATEGORY_KEYS (ترتيب العرض).
 * LEGACY_* للمتاجر المسجّلة سابقاً بـ slugs قديمة — تبقى صالحة للتحقق والعرض.
 */

const { parseStoreCategorySlugs } = require("./utils/storeCategorySlugs");

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

const RESTAURANT_NAME_CUISINE_HINTS = [
  { pattern: /كبسار|kabsar|كبسة|kabsa|بخاري|bukhari|مندي|mandi/i, slug: "kabsa_bukhari" },
  { pattern: /shawarma|شاورما|مشاوي|grill/i, slug: "shawarma_grill" },
  { pattern: /seafood|سمك|أسماك|اسماك/i, slug: "seafood" },
  { pattern: /burger|برجر|برقر/i, slug: "burger" },
  { pattern: /broasted|بروست|broast/i, slug: "broasted" },
  { pattern: /pizza|بيتza|بيتزا/i, slug: "pizza" },
  { pattern: /cafe|café|قهو|مقه/i, slug: "cafe" },
  { pattern: /sweet|حلو/i, slug: "sweets" },
];

function inferRestaurantCuisineFromName(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  for (let i = 0; i < RESTAURANT_NAME_CUISINE_HINTS.length; i += 1) {
    if (RESTAURANT_NAME_CUISINE_HINTS[i].pattern.test(n)) {
      return RESTAURANT_NAME_CUISINE_HINTS[i].slug;
    }
  }
  return null;
}

function resolveRestaurantBrowseCategory(row) {
  if (!row) return null;
  const normalized = normalizeRestaurantCategory(row.category);
  if (normalized) return normalized;
  return inferRestaurantCuisineFromName(row.name);
}

function storeNameLooksLikeRestaurant(row) {
  return !!inferRestaurantCuisineFromName(row && row.name);
}

function isRestaurantCategoryKey(value) {
  const tokens = parseStoreCategorySlugs(value);
  if (!tokens.length) {
    const s = String(value || "")
      .trim()
      .toLowerCase();
    return RESTAURANT_CATEGORY_SET.has(s);
  }
  return tokens.some((s) => RESTAURANT_CATEGORY_SET.has(s));
}

function normalizeRestaurantCategory(value) {
  const tokens = parseStoreCategorySlugs(value);
  for (let i = 0; i < tokens.length; i += 1) {
    if (RESTAURANT_CATEGORY_SET.has(tokens[i])) return tokens[i];
  }
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

/** فلاتر الواجهة: slug مطبخ → قيم category مقبولة (قديمة + جديدة) */
const RESTAURANT_CUISINE_FILTER_ALIASES = {
  kabsa_bukhari: ["kabsa_bukhari", "kabsa", "bukhari_mandi"],
  shawarma_grill: ["shawarma_grill", "shawarma", "grill"],
  burger: ["burger", "burger_broasted"],
  broasted: ["broasted", "burger_broasted"],
  cafe: ["cafe", "dessert_cafe", "breakfast_bakery"],
  sweets: ["sweets", "dessert_cafe"],
};

function restaurantCategoryMatchesCuisineSlug(categoryValue, cuisineSlug) {
  const want = String(cuisineSlug || "")
    .trim()
    .toLowerCase();
  if (!want) return true;
  const c = String(categoryValue || "")
    .trim()
    .toLowerCase();
  if (!c) return false;
  if (c === want) return true;
  const aliases = RESTAURANT_CUISINE_FILTER_ALIASES[want];
  if (aliases && aliases.includes(c)) return true;
  return false;
}

/** هل يطابق فلتر المطبخ المطلوب (slug معتمد فقط)؟ allowedSlugs اختياري: دمج أقسام من قاعدة البيانات */
function restaurantRowMatchesCuisineFilter(row, cuisineSlug, allowedSlugs) {
  const want = String(cuisineSlug || "")
    .trim()
    .toLowerCase();
  const valid = allowedSlugs && allowedSlugs.size ? allowedSlugs : RESTAURANT_CATEGORY_SET;
  if (!want || !valid.has(want)) return true;
  if (!storeRowCountsAsRestaurant(row)) return false;
  const tokens = parseStoreCategorySlugs(row.category);
  if (tokens.some((c) => restaurantCategoryMatchesCuisineSlug(c, want))) return true;
  const effective =
    resolveRestaurantBrowseCategory(row) ||
    String(row.category || "")
      .trim()
      .toLowerCase();
  return restaurantCategoryMatchesCuisineSlug(effective, want);
}

/** مطعم للعرض في قوائم «مطاعم» — type=restaurant أو تصنيف مطبخ معروف أو اسم مطعم معروف */
function storeRowCountsAsRestaurant(row) {
  if (!row) return false;
  if (
    String(row.type || "")
      .trim()
      .toLowerCase() === "restaurant"
  ) {
    return true;
  }
  const c = String(row.category || "")
    .trim()
    .toLowerCase();
  if (isRestaurantCategoryKey(c)) return true;
  return storeNameLooksLikeRestaurant(row);
}

module.exports = {
  RESTAURANT_CATEGORY_KEYS,
  LEGACY_RESTAURANT_CATEGORY_SLUGS,
  RESTAURANT_CATEGORY_LABEL_AR,
  RESTAURANT_CATEGORY_ICONS,
  RESTAURANT_CATEGORY_SET,
  RESTAURANT_CUISINE_FILTER_ALIASES,
  isRestaurantCategoryKey,
  normalizeRestaurantCategory,
  restaurantCategoryLabelAr,
  restaurantCategoryDisplayAr,
  isLegacyOrUnknownRestaurantCategory,
  restaurantCategoryMatchesCuisineSlug,
  restaurantRowMatchesCuisineFilter,
  storeRowCountsAsRestaurant,
  inferRestaurantCuisineFromName,
  resolveRestaurantBrowseCategory,
  storeNameLooksLikeRestaurant,
};
