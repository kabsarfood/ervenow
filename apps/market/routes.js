const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");

const router = express.Router();

router.get("/health", (_req, res) => ok(res, { service: "market" }));

router.get("/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase.from("market_products").select("*").eq("active", true);
    if (error) return ok(res, { products: [], note: "أضف صفوفاً في market_products أو نفّذ schema.sql" });
    ok(res, { products: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
