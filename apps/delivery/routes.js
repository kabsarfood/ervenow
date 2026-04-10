const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { listOrders, acceptOrder, setStatus, saveLocation } = require("./service");

const router = express.Router();

router.get("/health", (_req, res) => ok(res, { service: "delivery" }));

router.get("/orders", requireAuth, async (req, res) => {
  try {
    const { data, error } = await listOrders(req.supabase, req.appUser);
    if (error) return fail(res, error.message, 400);
    ok(res, { orders: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase.from("delivery_orders").select("*").eq("id", req.params.id).single();
    if (error) return fail(res, error.message, 404);
    const o = data;
    if (req.appUser.role === "admin") {
      return ok(res, { order: o });
    }
    if (req.appUser.role === "customer") {
      if (o.customer_id !== req.appUser.id) return fail(res, "Forbidden", 403);
      return ok(res, { order: o });
    }
    if (req.appUser.role === "driver") {
      const mine = o.driver_id === req.appUser.id;
      const open = o.status === "new" && !o.driver_id;
      if (!mine && !open) return fail(res, "Forbidden", 403);
      return ok(res, { order: o });
    }
    return fail(res, "Forbidden", 403);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      customer_id: req.appUser.id,
      customer_phone: body.customer_phone || req.appUser.phone,
      pickup_address: body.pickup_address || "",
      drop_address: body.drop_address || "",
      notes: body.notes || "",
      status: "new",
    };

    const { data, error } = await req.supabase.from("delivery_orders").insert(row).select().single();
    if (error) return fail(res, error.message, 400);
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/accept", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const { data, error } = await acceptOrder(req.supabase, req.params.id, req.appUser.id);
    if (error) return fail(res, error.message, 400);
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.patch("/orders/:id/status", requireAuth, async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || "").trim();
    if (!nextStatus) return fail(res, "status required");

    const { data, error } = await setStatus(req.supabase, req.params.id, nextStatus, req.appUser);
    if (error) return fail(res, error.message, 400);
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/location", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return fail(res, "lat/lng required");

    const { data, error } = await saveLocation(req.supabase, req.params.id, req.appUser, lat, lng);
    if (error) return fail(res, error.message, 400);
    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
