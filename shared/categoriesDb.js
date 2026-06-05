const { RESTAURANT_CATEGORY_KEYS } = require("./restaurantCategories");
const { PRODUCT_CATEGORY_KEYS } = require("./marketProductCategories");
const {
  PRODUCT_CATALOG_TYPES,
  PRODUCT_CATALOG_TYPE_SET,
  normalizeProductCatalogType,
  builtinCatalogEntries,
  builtinSlugSet,
  labelForProductSlug,
  iconForProductSlug,
} = require("./productCategoryTypes");

/** أنواع categories.type — مطاعم + كل أقسام المنتجات */
const ALLOWED_SCOPE_TYPES = new Set(PRODUCT_CATALOG_TYPES);
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
  if (!t) return null;
  if (t === "restaurant") return CATEGORY_SCOPE_STORE;
  return CATEGORY_SCOPE_PRODUCT;
}

function isStoreScopeCategory(type, scope) {
  return String(type || "").toLowerCase() === "restaurant" && String(scope || "").toLowerCase() === CATEGORY_SCOPE_STORE;
}

function isProductScopeCategory(type, scope) {
  return String(scope || "").toLowerCase() === CATEGORY_SCOPE_PRODUCT;
}

async function fetchCategoriesFromDb(sb, type, scope) {
  if (!sb) return [];
  const { data, error } = await sb
    .from("categories")
    .select("slug,name_ar,icon,sort_order")
    .eq("type", type)
    .eq("scope", scope)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name_ar", { ascending: true });
  if (error) {
    if (isCategoriesTableMissing(error)) return [];
    return [];
  }
  return data || [];
}

let mergedRestaurantSlugsCache = { at: 0, value: null };
const MERGED_SLUGS_CACHE_MS = 5 * 60 * 1000;

async function fetchMergedRestaurantCategorySlugs(sb) {
  const now = Date.now();
  if (mergedRestaurantSlugsCache.value && now - mergedRestaurantSlugsCache.at < MERGED_SLUGS_CACHE_MS) {
    return mergedRestaurantSlugsCache.value;
  }
  const base = new Set(RESTAURANT_CATEGORY_KEYS.map((k) => String(k).toLowerCase()));
  const rows = await fetchCategoriesFromDb(sb, "restaurant", CATEGORY_SCOPE_STORE);
  rows.forEach((r) => {
    if (r && r.slug) base.add(String(r.slug).toLowerCase());
  });
  mergedRestaurantSlugsCache = { at: now, value: base };
  return base;
}

async function fetchMergedMarketCategorySlugs(sb) {
  const base = new Set(PRODUCT_CATEGORY_KEYS.map((k) => String(k).toLowerCase()));
  const rows = await fetchCategoriesFromDb(sb, "market", CATEGORY_SCOPE_PRODUCT);
  rows.forEach((r) => {
    if (r && r.slug) base.add(String(r.slug).toLowerCase());
  });
  return base;
}

/** قائمة أقسام المنتجات لنوع متجر (مدمج: افتراضي + قاعدة البيانات) */
async function fetchProductCategoryCatalog(sb, catalogType) {
  const type = normalizeProductCatalogType(catalogType) || "market";
  const bySlug = new Map();
  builtinCatalogEntries(type).forEach((e) => {
    bySlug.set(e.slug, {
      slug: e.slug,
      label: e.label,
      icon: e.icon,
      sort_order: e.sort_order,
    });
  });
  const rows = await fetchCategoriesFromDb(sb, type, CATEGORY_SCOPE_PRODUCT);
  rows.forEach((r) => {
    if (!r || !r.slug) return;
    const slug = String(r.slug).toLowerCase();
    bySlug.set(slug, {
      slug,
      label: r.name_ar || labelForProductSlug(type, slug, null) || slug,
      icon: r.icon || iconForProductSlug(type, slug, null),
      sort_order: r.sort_order != null ? Number(r.sort_order) : 0,
    });
  });
  return [...bySlug.values()].sort(
    (a, b) =>
      (a.sort_order || 0) - (b.sort_order || 0) || String(a.label).localeCompare(String(b.label), "ar")
  );
}

async function fetchMergedProductCategorySlugs(sb, catalogType) {
  const type = normalizeProductCatalogType(catalogType) || "market";
  const set = builtinSlugSet(type);
  const catalog = await fetchProductCategoryCatalog(sb, type);
  catalog.forEach((e) => set.add(e.slug));
  return set;
}

async function resolveProductCategorySlug(sb, catalogType, rawSlug) {
  const s = String(rawSlug || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const merged = await fetchMergedProductCategorySlugs(sb, catalogType);
  return merged.has(s) ? s : null;
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
  PRODUCT_CATALOG_TYPE_SET,
  CATEGORY_SCOPE_STORE,
  CATEGORY_SCOPE_PRODUCT,
  isCategoriesTableMissing,
  normalizeScopeType,
  normalizeSlugInput,
  normalizeCategoryScope,
  isStoreScopeCategory,
  isProductScopeCategory,
  fetchMergedRestaurantCategorySlugs,
  fetchMergedMarketCategorySlugs,
  fetchProductCategoryCatalog,
  fetchMergedProductCategorySlugs,
  resolveProductCategorySlug,
  resolvePublicCategorySlug,
  fetchCategoryLabelMap,
};
