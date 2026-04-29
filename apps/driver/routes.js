const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");

const router = express.Router();

router.get("/orders", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const driverId = req.appUser.id;
    const { data, error } = await req.supabase
      .from("orders")
      .select("*")
      .or(
        `and(driver_id.is.null,delivery_status.in.(new,pending)),and(driver_id.eq.${driverId},delivery_status.in.(accepted,delivering,pending))`
      )
      .order("created_at", { ascending: false });
    if (error) return fail(res, error.message, 400);
    return ok(res, { orders: data || [] });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/accept/:id", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const driverId = req.appUser.id;
    const orderId = String(req.params.id || "").trim();
    if (!orderId) return fail(res, "order id required", 400);

    const { data, error } = await req.supabase
      .from("orders")
      .update({
        driver_id: driverId,
        delivery_status: "accepted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .is("driver_id", null)
      .in("delivery_status", ["new", "pending"])
      .select()
      .maybeSingle();

    if (error) return fail(res, error.message, 400);
    if (!data) {
      return ok(res, {
        accepted: false,
        message: "تم استلام الطلب من مندوب آخر",
      });
    }
    return ok(res, { accepted: true, order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/update-location", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const orderId = String(req.body?.order_id || "").trim();
    const driverId = req.appUser.id;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail(res, "lat/lng required", 400);
    }

    let q = req.supabase
      .from("orders")
      .update({
        driver_lat: lat,
        driver_lng: lng,
        last_location_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .in("delivery_status", ["accepted", "delivering"]);
    if (orderId) q = q.eq("id", orderId);
    const { error } = await q;
    if (error) return fail(res, error.message, 400);
    return ok(res, { updated: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/rating", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("orders")
      .select("rating")
      .eq("driver_id", req.appUser.id)
      .eq("delivery_status", "delivered")
      .not("rating", "is", null);

    if (error) return fail(res, error.message, 400);

    const rows = data || [];
    const count = rows.length;
    const sum = rows.reduce((a, b) => a + Number(b.rating), 0);
    const avg = count === 0 ? null : Math.round((sum / count) * 10) / 10;

    ok(res, { avg, count });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
