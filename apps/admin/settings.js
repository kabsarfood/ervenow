/**
 * API إعدادات المنصة — محمي بـ JWT + role=admin (P0-02).
 */
const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

function supabaseAdmin() {
  return createServiceClient();
}

router.get("/", async (_req, res) => {
  const sb = supabaseAdmin();
  if (!sb) {
    return res.status(503).json({ success: false, error: { message: "قاعدة البيانات غير جاهزة" } });
  }
  const { data, error } = await sb.from("platform_settings").select("*");
  if (error) {
    return res.json({ success: false, error });
  }
  res.json({ success: true, data });
});

router.post("/update", async (req, res) => {
  const sb = supabaseAdmin();
  if (!sb) {
    return res.status(503).json({ success: false, error: { message: "قاعدة البيانات غير جاهزة" } });
  }

  const { key, value } = req.body || {};
  if (!key) {
    return res.status(400).json({ success: false, error: { message: "key مطلوب" } });
  }
  const { error } = await sb
    .from("platform_settings")
    .update({ value, updated_at: new Date() })
    .eq("key", key);

  if (error) {
    return res.json({ success: false, error });
  }

  res.json({ success: true });
});

module.exports = router;
