/**
 * زيادة عدّاد استخدام تصنيف في جدول categories (يتطلّب migration_category_usage.sql).
 * لا يُرمى خطأ للمتصل — يُسجّل تحذيراً صامتاً عند غياب العمود أو الصف.
 */
const { createServiceClient } = require("./config/supabase");
const { isCategoriesTableMissing } = require("./categoriesDb");

const { PRODUCT_CATALOG_TYPE_SET } = require("./productCategoryTypes");

function normalizeUsageType(t) {
  const x = String(t || "")
    .trim()
    .toLowerCase();
  if (x === "restaurant" || x === "market" || PRODUCT_CATALOG_TYPE_SET.has(x)) return x;
  return null;
}

/**
 * @param {"restaurant"|"market"} categoryType — يطابق categories.type
 * @param {string} slug — يطابق categories.slug
 */
async function incrementCategoryUsage(categoryType, slug) {
  const t = normalizeUsageType(categoryType);
  const s = String(slug || "")
    .trim()
    .toLowerCase();
  if (!t || !s) return;
  const sb = createServiceClient();
  if (!sb) return;
  try {
    const { data: row, error: selErr } = await sb
      .from("categories")
      .select("id,usage_count")
      .eq("type", t)
      .eq("slug", s)
      .eq("is_active", true)
      .maybeSingle();
    if (selErr) {
      if (isCategoriesTableMissing(selErr)) return;
      if (/usage_count|column|schema cache/i.test(String(selErr.message || ""))) return;
      return;
    }
    if (!row || !row.id) return;
    const next = (Number(row.usage_count) || 0) + 1;
    const now = new Date().toISOString();
    const { error: upErr } = await sb
      .from("categories")
      .update({
        usage_count: next,
        last_used_at: now,
        updated_at: now,
      })
      .eq("id", row.id);
    if (upErr) {
      if (/usage_count|last_used_at|column|schema cache/i.test(String(upErr.message || ""))) return;
    }
  } catch (e) {
    console.warn("[categoryUsage/increment]", e.message || e);
  }
}

/** بعد موافقة الإدارة على متجر: يحدّث عدّاد تصنيف المطعم أو قسم البقالة */
function recordStoreCategoryUsageOnApprove(storeRow) {
  if (!storeRow) return;
  const type = String(storeRow.type || "")
    .trim()
    .toLowerCase();
  const cat = String(storeRow.category || "")
    .trim()
    .toLowerCase();
  if (!cat) return;
  if (type === "restaurant") {
    void incrementCategoryUsage("restaurant", cat);
  } else if (type === "supermarket") {
    void incrementCategoryUsage("market", cat);
  }
}

module.exports = {
  incrementCategoryUsage,
  recordStoreCategoryUsageOnApprove,
};
