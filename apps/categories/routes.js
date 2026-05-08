const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const {
  normalizeScopeType,
  isCategoriesTableMissing,
  CATEGORY_SCOPE_STORE,
  CATEGORY_SCOPE_PRODUCT,
} = require("../../shared/categoriesDb");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const scope = normalizeScopeType(req.query.type);
    if (!scope) return fail(res, "أرسل type=restaurant أو type=market", 400);
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);

    const scopeCol = scope === "market" ? CATEGORY_SCOPE_PRODUCT : CATEGORY_SCOPE_STORE;
    const { data, error } = await sb
      .from("categories")
      .select("slug,name_ar,icon,image_url,sort_order,scope")
      .eq("type", scope)
      .eq("scope", scopeCol)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name_ar", { ascending: true });

    if (error) {
      if (isCategoriesTableMissing(error)) {
        return ok(res, { ok: true, type: scope, categories: [], note: "نفّذ shared/migration_categories.sql" });
      }
      return fail(res, error.message, 400);
    }
    const categories = (data || []).map((r) => ({
      slug: r.slug,
      name_ar: r.name_ar,
      label_ar: r.name_ar,
      icon: r.icon,
      image_url: r.image_url,
      sort_order: r.sort_order,
      scope: r.scope,
    }));
    return ok(res, { ok: true, type: scope, categories });
  } catch (e) {
    console.error("[categories/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

module.exports = router;
