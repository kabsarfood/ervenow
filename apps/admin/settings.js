/**
 * API إعدادات المنصة — خطوة 2
 * المشروع يستخدم CommonJS و createServiceClient بدل import من lib/supabase.js
 */
const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");

const router = express.Router();

function supabaseAdmin() {
  return createServiceClient();
}

router.get("/", async (_req, res) => {
  const sb = supabaseAdmin();
  if (!sb) {
    return res.json({ success: false, error: { message: "قاعدة البيانات غير جاهزة" } });
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
    return res.json({ success: false, error: { message: "قاعدة البيانات غير جاهزة" } });
  }

  const { key, value } = req.body || {};
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
