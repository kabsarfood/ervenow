const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const {
  normalizeScopeType,
  isCategoriesTableMissing,
  CATEGORY_SCOPE_STORE,
  CATEGORY_SCOPE_PRODUCT,
} = require("../../shared/categoriesDb");
const {
  RESTAURANT_CATEGORY_KEYS,
  RESTAURANT_CATEGORY_LABEL_AR,
  RESTAURANT_CATEGORY_ICONS,
} = require("../../shared/restaurantCategories");
const {
  PRODUCT_CATEGORY_KEYS,
  PRODUCT_CATEGORY_LABEL_AR,
  PRODUCT_CATEGORY_ICONS,
} = require("../../shared/marketProductCategories");

const router = express.Router();

/** sort=smart (افتراضي): الأكثر usage أولاً ثم sort_order. sort=manual: الترتيب الثابت فقط */
function parseSortMode(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "manual" || s === "fixed" || s === "order") return "manual";
  return "smart";
}

function sortMergedCategories(list, sortMode) {
  const arr = (list || []).slice();
  if (sortMode === "manual") {
    arr.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.name_ar).localeCompare(String(b.name_ar), "ar");
    });
    return arr;
  }
  arr.sort((a, b) => {
    const ua = Number(a.usage_count) || 0;
    const ub = Number(b.usage_count) || 0;
    if (ub !== ua) return ub - ua;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return String(a.name_ar).localeCompare(String(b.name_ar), "ar");
  });
  return arr;
}

/** يدمج صفوف categories مع التصنيفات الافتراضية حتى لا تبقى قوائم التسجيل فارغة عند غياب الجدول أو البيانات. */
function mergeRestaurantCategories(dbRows) {
  const bySlug = new Map();
  RESTAURANT_CATEGORY_KEYS.forEach((slug, idx) => {
    bySlug.set(slug, {
      slug,
      name_ar: RESTAURANT_CATEGORY_LABEL_AR[slug] || slug,
      label_ar: RESTAURANT_CATEGORY_LABEL_AR[slug] || slug,
      icon: RESTAURANT_CATEGORY_ICONS[slug] || null,
      image_url: null,
      sort_order: (idx + 1) * 10,
      scope: CATEGORY_SCOPE_STORE,
      usage_count: 0,
      last_used_at: null,
    });
  });
  (dbRows || []).forEach((r) => {
    const slug = String(r.slug || "")
      .trim()
      .toLowerCase();
    if (!slug) return;
    const prev = bySlug.get(slug);
    const nameAr = r.name_ar != null && String(r.name_ar).trim() !== "" ? String(r.name_ar).trim() : null;
    const dbIcon = r.icon != null && String(r.icon).trim() !== "" ? String(r.icon).trim() : null;
    const fallbackIcon = RESTAURANT_CATEGORY_ICONS[slug] || null;
    bySlug.set(slug, {
      slug,
      name_ar: nameAr || (prev && prev.name_ar) || slug,
      label_ar: nameAr || (prev && prev.label_ar) || slug,
      icon: dbIcon || (prev && prev.icon) || fallbackIcon,
      image_url: r.image_url != null && String(r.image_url).trim() !== "" ? r.image_url : prev && prev.image_url,
      sort_order:
        typeof r.sort_order === "number" && !Number.isNaN(r.sort_order)
          ? r.sort_order
          : prev
            ? prev.sort_order
            : 999,
      scope: r.scope || (prev && prev.scope) || CATEGORY_SCOPE_STORE,
      usage_count: Number(r.usage_count) || 0,
      last_used_at: r.last_used_at != null ? r.last_used_at : prev && prev.last_used_at,
    });
  });
  return [...bySlug.values()];
}

function mergeMarketCategories(dbRows) {
  const bySlug = new Map();
  PRODUCT_CATEGORY_KEYS.forEach((slug, idx) => {
    bySlug.set(slug, {
      slug,
      name_ar: PRODUCT_CATEGORY_LABEL_AR[slug] || slug,
      label_ar: PRODUCT_CATEGORY_LABEL_AR[slug] || slug,
      icon: PRODUCT_CATEGORY_ICONS[slug] || null,
      image_url: null,
      sort_order: (idx + 1) * 10,
      scope: CATEGORY_SCOPE_PRODUCT,
      usage_count: 0,
      last_used_at: null,
    });
  });
  (dbRows || []).forEach((r) => {
    const slug = String(r.slug || "")
      .trim()
      .toLowerCase();
    if (!slug) return;
    const prev = bySlug.get(slug);
    const nameAr = r.name_ar != null && String(r.name_ar).trim() !== "" ? String(r.name_ar).trim() : null;
    const dbIcon = r.icon != null && String(r.icon).trim() !== "" ? String(r.icon).trim() : null;
    const fallbackIcon = PRODUCT_CATEGORY_ICONS[slug] || null;
    bySlug.set(slug, {
      slug,
      name_ar: nameAr || (prev && prev.name_ar) || slug,
      label_ar: nameAr || (prev && prev.label_ar) || slug,
      icon: dbIcon || (prev && prev.icon) || fallbackIcon,
      image_url: r.image_url != null && String(r.image_url).trim() !== "" ? r.image_url : prev && prev.image_url,
      sort_order:
        typeof r.sort_order === "number" && !Number.isNaN(r.sort_order)
          ? r.sort_order
          : prev
            ? prev.sort_order
            : 999,
      scope: r.scope || (prev && prev.scope) || CATEGORY_SCOPE_PRODUCT,
      usage_count: Number(r.usage_count) || 0,
      last_used_at: r.last_used_at != null ? r.last_used_at : prev && prev.last_used_at,
    });
  });
  return [...bySlug.values()];
}

async function loadCategoriesRows(sb, scope, scopeCol) {
  const selWithUsage = "slug,name_ar,icon,image_url,sort_order,scope,usage_count,last_used_at";
  const selBasic = "slug,name_ar,icon,image_url,sort_order,scope";
  const base = sb.from("categories").select(selWithUsage).eq("type", scope).eq("scope", scopeCol).eq("is_active", true);
  let { data, error } = await base.order("sort_order", { ascending: true }).order("name_ar", { ascending: true });
  if (error && /usage_count|last_used_at|column|schema cache/i.test(String(error.message || ""))) {
    ({ data, error } = await sb
      .from("categories")
      .select(selBasic)
      .eq("type", scope)
      .eq("scope", scopeCol)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name_ar", { ascending: true }));
    if (!error) {
      return { rows: data || [], hasUsageColumns: false };
    }
  }
  if (error) return { rows: null, error, hasUsageColumns: false };
  return { rows: data || [], hasUsageColumns: true };
}

router.get("/", async (req, res) => {
  try {
    const scope = normalizeScopeType(req.query.type);
    if (!scope) return fail(res, "أرسل type=restaurant أو type=market", 400);
    const sortMode = parseSortMode(req.query.sort);
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);

    const scopeCol = scope === "market" ? CATEGORY_SCOPE_PRODUCT : CATEGORY_SCOPE_STORE;
    const { rows, error, hasUsageColumns } = await loadCategoriesRows(sb, scope, scopeCol);

    if (error) {
      if (isCategoriesTableMissing(error)) {
        const merged = scope === "market" ? mergeMarketCategories([]) : mergeRestaurantCategories([]);
        const categories = sortMergedCategories(merged, sortMode);
        return ok(res, {
          ok: true,
          type: scope,
          categories,
          meta: {
            sort: sortMode,
            usage_tracking: false,
            has_usage_columns: false,
          },
          note: "نفّذ shared/migration_categories.sql لمزامنة الأقسام مع قاعدة البيانات",
        });
      }
      return fail(res, error.message, 400);
    }

    const raw = (rows || []).map((r) => ({
      slug: r.slug,
      name_ar: r.name_ar,
      label_ar: r.name_ar,
      icon: r.icon,
      image_url: r.image_url,
      sort_order: r.sort_order,
      scope: r.scope,
      usage_count: hasUsageColumns ? Number(r.usage_count) || 0 : 0,
      last_used_at: hasUsageColumns ? r.last_used_at : null,
    }));
    const merged = scope === "market" ? mergeMarketCategories(raw) : mergeRestaurantCategories(raw);
    const categories = sortMergedCategories(merged, sortMode);
    return ok(res, {
      ok: true,
      type: scope,
      categories,
      meta: {
        sort: sortMode,
        usage_tracking: hasUsageColumns,
        has_usage_columns: hasUsageColumns,
      },
    });
  } catch (e) {
    console.error("[categories/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

module.exports = router;
