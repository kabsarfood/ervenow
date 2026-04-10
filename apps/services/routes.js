const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");

const router = express.Router();

router.get("/health", (_req, res) => ok(res, { service: "services" }));

router.get("/bookings", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("service_bookings")
      .select("*")
      .eq("customer_id", req.appUser.id)
      .order("created_at", { ascending: false });
    if (error) return fail(res, error.message, 400);
    ok(res, { bookings: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/bookings", requireAuth, async (req, res) => {
  try {
    const service_name = String(req.body?.service_name || "").trim() || "خدمة عامة";
    const { data, error } = await req.supabase
      .from("service_bookings")
      .insert({ customer_id: req.appUser.id, service_name, status: "new" })
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    ok(res, { booking: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
