const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const {
  listOrders,
  acceptOrder,
  setStatus,
  saveLocation,
  reportGpsError,
  rateOrder,
  createDeliveryOrderFromBody,
} = require("./service");

const router = express.Router();

async function getUserPhoneById(sb, userId) {
  if (!userId) return null;
  const { data, error } = await sb.from("users").select("phone").eq("id", userId).maybeSingle();
  if (error || !data || !data.phone) return null;
  return String(data.phone);
}

router.get("/health", (_req, res) => ok(res, { service: "delivery" }));

router.get("/orders", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, getDatabaseConfigHint(), 503);

    if (!req.appUser) {
      const { count, error } = await sb
        .from("orders")
        .select("*", { count: "exact", head: true })
        .in("delivery_status", ["pending", "accepted"]);
      if (error) return fail(res, error.message, 400);
      return res.json({
        ok: true,
        count: count || 0,
      });
    }

    const { data, error } = await listOrders(sb, req.appUser);
    if (error) return fail(res, error.message, 400);
    ok(res, { orders: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase.from("orders").select("*").eq("id", req.params.id).single();
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
      const open =
        ((o.delivery_status || o.status) === "new" || (o.delivery_status || o.status) === "pending") && !o.driver_id;
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
    const body = { ...(req.body || {}) };
    const src = req.get("X-Source");
    if ((body.series_source == null || String(body.series_source).trim() === "") && src) {
      body.series_source = String(src).trim();
    }
    if (body.series_source == null || String(body.series_source).trim() === "") {
      body.series_source = "ervenow";
    }

    const extRaw = body.external_order_id;
    if (extRaw != null && String(extRaw).trim() !== "") {
      const ext = String(extRaw).trim();
      const { data: existing, error: exErr } = await req.supabase
        .from("orders")
        .select("*")
        .eq("external_order_id", ext)
        .maybeSingle();
      if (exErr) return fail(res, exErr.message, 400);
      if (existing) return ok(res, { order: existing, duplicated: true });
    }

    const { data, error } = await createDeliveryOrderFromBody(req.supabase, req.appUser, body);
    if (error) return fail(res, error.message, 400);
    return ok(res, { order: data, duplicated: false });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/accept", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const { data, error } = await acceptOrder(req.supabase, orderId, req.appUser.id);
    if (error) return fail(res, error.message, 400);

    if (data) {
      const base = String(process.env.ERVENOW_PUBLIC_URL || "").replace(/\/$/, "");
      const trackUrl = `${base || ""}/track?id=${encodeURIComponent(data.id)}`;
      const orderLabel = data.order_number || String(data.id);
      const driverInfo = req.appUser.phone || req.appUser.id;

      if (data.customer_phone) {
        const customerMessage = `🚚 تم استلام طلبك

رقم الطلب: ${orderLabel}
المندوب: ${driverInfo}
تابع الطلب: ${trackUrl}`.trim();
        try {
          await sendWhatsApp({ to: data.customer_phone, message: customerMessage });
        } catch (e) {
          console.error("[delivery/accept] customer WhatsApp:", e && (e.message || e));
        }
      }

      const providerPhone =
        (await getUserPhoneById(req.supabase, data.merchant_id)) ||
        (await getUserPhoneById(req.supabase, data.service_provider_id));
      if (providerPhone) {
        const providerMessage = `✅ تم استلام طلب ${orderLabel} بواسطة المندوب ${driverInfo}.`.trim();
        try {
          await sendWhatsApp({ to: providerPhone, message: providerMessage });
        } catch (e) {
          console.error("[delivery/accept] provider WhatsApp:", e && (e.message || e));
        }
      }
    }

    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/rate", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const b = req.body || {};
    const { data, error } = await rateOrder(req.supabase, orderId, req.appUser, b.rating, b.review);
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
    if (req.body && req.body.gps_error === true) {
      const { data, error } = await reportGpsError(req.supabase, req.params.id, req.appUser);
      if (error) return fail(res, error.message, 400);
      return ok(res, { order: data });
    }

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
