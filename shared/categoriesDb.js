const { RESTAURANT_CATEGORY_KEYS } = require("./restaurantCategories");
const { PRODUCT_CATEGORY_KEYS } = require("./marketProductCategories");

const ALLOWED_SCOPE_TYPES = new Set(["restaurant", "market"]);
/** scope في جدول categories: مطاعم = store، أقسام منتجات السوق = product */
const CATEGORY_SCOPE_STORE = "store";
const CATEGORY_SCOPE_PRODUCT = "product";
const ALLOWED_CATEGORY_SCOPES = new Set([CATEGORY_SCOPE_STORE, CATEGORY_SCOPE_PRODUCT]);

function isCategoriesTableMissing(err) {
  if (!err) return false;
  const m = String(err.message || err.details || err.code || "");
  return /42P01|relation .*categories|categories.*does not exist|schema cache/i.test(m);
}

function normalizeScopeType(v) {
  const t = String(v || "")
    .trim()
    .toLowerCase();
  return ALLOWED_SCOPE_TYPES.has(t) ? t : null;
}

function normalizeSlugInput(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(s)) return null;
  return s;
}

function normalizeCategoryScope(v, typeHint) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (ALLOWED_CATEGORY_SCOPES.has(s)) return s;
  const t = normalizeScopeType(typeHint);
  if (t === "market") return CATEGORY_SCOPE_PRODUCT;
  if (t === "restaurant") return CATEGORY_SCOPE_STORE;
  return null;
}

async function fetchMergedRestaurantCategorySlugs(sb) {
  const base = new Set(RESTAURANT_CATEGORY_KEYS.map((k) => String(k).toLowerCase()));
  if (!sb) return base;
  const { data, error } = await sb
    .from("categories")
    .select("slug")
    .eq("type", "restaurant")
    .eq("scope", CATEGORY_SCOPE_STORE)
    .eq("is_active", true);
  if (error) {
    if (isCategoriesTableMissing(error)) return base;
    return base;
  }
  (data || []).forEach((r) => {
    if (r && r.slug) base.add(String(r.slug).toLowerCase());
  });
  return base;
}

async function fetchMergedMarketCategorySlugs(sb) {
  const base = new Set(PRODUCT_CATEGORY_KEYS.map((k) => String(k).toLowerCase()));
  if (!sb) return base;
  const { data, error } = await sb
    .from("categories")
    .select("slug")
    .eq("type", "market")
    .eq("scope", CATEGORY_SCOPE_PRODUCT)
    .eq("is_active", true);
  if (error) {
    if (isCategoriesTableMissing(error)) return base;
    return base;
  }
  (data || []).forEach((r) => {
    if (r && r.slug) base.add(String(r.slug).toLowerCase());
  });
  return base;
}

async function resolvePublicCategorySlug(sb, scopeType, rawSlug) {
  const s = String(rawSlug || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const merged =
    scopeType === "market" ? await fetchMergedMarketCategorySlugs(sb) : await fetchMergedRestaurantCategorySlugs(sb);
  return merged.has(s) ? s : null;
}

/** خريطة slug → name_ar لعرض البطاقات */
async function fetchCategoryLabelMap(sb, scopeType, slugs) {
  const map = new Map();
  const uniq = [...new Set((slugs || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];
  if (!uniq.length || !sb) return map;
  const scopeCol =
    scopeType === "market" ? CATEGORY_SCOPE_PRODUCT : CATEGORY_SCOPE_STORE;
  const { data, error } = await sb
    .from("categories")
    .select("slug,name_ar")
    .eq("type", scopeType)
    .eq("scope", scopeCol)
    .in("slug", uniq);
  if (error || !data) return map;
  data.forEach((r) => {
    if (r && r.slug) map.set(String(r.slug).toLowerCase(), r.name_ar || r.slug);
  });
  return map;
}

module.exports = {
  ALLOWED_SCOPE_TYPES,
  CATEGORY_SCOPE_STORE,
  CATEGORY_SCOPE_PRODUCT,
  isCategoriesTableMissing,
  normalizeScopeType,
  normalizeSlugInput,
  normalizeCategoryScope,
  fetchMergedRestaurantCategorySlugs,
  fetchMergedMarketCategorySlugs,
  resolvePublicCategorySlug,
  fetchCategoryLabelMap,
};
