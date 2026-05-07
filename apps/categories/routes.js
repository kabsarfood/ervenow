const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizeScopeType, isCategoriesTableMissing } = require("../../shared/categoriesDb");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const scope = normalizeScopeType(req.query.type);
    if (!scope) return fail(res, "أرسل type=restaurant أو type=market", 400);
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);

    const { data, error } = await sb
      .from("categories")
      .select("slug,label_ar,icon,sort_order")
      .eq("type", scope)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("label_ar", { ascending: true });

    if (error) {
      if (isCategoriesTableMissing(error)) {
        return ok(res, { ok: true, type: scope, categories: [], note: "نفّذ migration_categories.sql" });
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { ok: true, type: scope, categories: data || [] });
  } catch (e) {
    console.error("[categories/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

module.exports = router;
