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
  cancelOrderByCustomer,
  createDeliveryOrderFromBody,
} = require("./service");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { deliveryOrdersCreateLimiter } = require("../../shared/middleware/apiRateLimits");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const { isAllowedDeliveryStatusTransition } = require("../../shared/utils/deliveryStateMachine");
const { logger } = require("../../shared/utils/logger");

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function isUuidLike(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "").trim()
  );
}

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
    const key = String(req.params.id || "").trim();
    if (!key) return fail(res, "id required", 400);
    let q = req.supabase.from("orders").select("*");
    if (isUuidLike(key)) q = q.eq("id", key);
    else q = q.eq("order_number", key);
    const { data, error } = await q.single();
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

router.post("/orders", deliveryOrdersCreateLimiter, requireAuth, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    delete body.idempotency_key;
    const idemKey = normalizeIdempotencyKey(req);
    if (idemKey) {
      const { data: existing, error: idemErr } = await req.supabase
        .from("orders")
        .select("*")
        .eq("customer_id", req.appUser.id)
        .eq("idempotency_key", idemKey)
        .maybeSingle();
      if (idemErr) return fail(res, idemErr.message, 400);
      if (existing) return ok(res, { order: existing, duplicated: false, idempotentReplay: true });
      body.idempotency_key = idemKey;
    }
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
    if (data) {
      try {
        await enqueueDeliveryJob("new-order", {
          orderId: data.id,
          pickup:
            data.pickup_lat != null && data.pickup_lng != null
              ? { lat: Number(data.pickup_lat), lng: Number(data.pickup_lng) }
              : null,
          dropoff:
            data.drop_lat != null && data.drop_lng != null
              ? { lat: Number(data.drop_lat), lng: Number(data.drop_lng) }
              : null,
        });
      } catch (qe) {
        logger.error({ err: qe && (qe.message || String(qe)), orderId: data.id }, "[delivery/orders] enqueue");
      }
    }
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
          logger.error({ err: e && (e.message || String(e)), orderId: data.id }, "[delivery/accept] customer WhatsApp");
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
          logger.error({ err: e && (e.message || String(e)), orderId: data.id }, "[delivery/accept] provider WhatsApp");
        }
      }
    }

    ok(res, { order: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/orders/:id/rate", requireAuth, requireRole("customer", "admin"), async (req, res) => {
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

router.post("/orders/:id/cancel", requireAuth, requireRole("customer", "admin"), async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const { data, error, refund } = await cancelOrderByCustomer(req.supabase, orderId, req.appUser);
    if (error) return fail(res, error.message, 400);

    if (data && data.driver_id) {
      try {
        const driverPhone = await getUserPhoneById(req.supabase, data.driver_id);
        if (driverPhone) {
          const orderLabel = data.order_number || String(data.id || orderId);
          const msg = `🚫 تم إلغاء الطلب من زائر المنصة

رقم الطلب: ${orderLabel}
من: ${String(data.pickup_address || "-")}
إلى: ${String(data.drop_address || "-")}`.trim();
          await sendWhatsApp({ to: driverPhone, message: msg });
        }
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr && (notifyErr.message || String(notifyErr)), orderId },
          "[delivery/cancel] driver WhatsApp"
        );
      }
    }

    return ok(res, {
      order: data,
      refund: refund || null,
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.patch("/orders/:id/status", requireAuth, async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || "").trim();
    if (!nextStatus) return fail(res, "status required");
    const orderId = String(req.params.id || "").trim();
    const { data: cur, error: curErr } = await req.supabase
      .from("orders")
      .select("delivery_status,status")
      .eq("id", orderId)
      .maybeSingle();
    if (curErr || !cur) return fail(res, curErr?.message || "Not found", 404);
    const current = cur.delivery_status || cur.status || "pending";
    if (!isAllowedDeliveryStatusTransition(current, nextStatus)) {
      return fail(res, `Invalid transition ${current} → ${nextStatus}`, 400);
    }
    const { data, error } = await setStatus(req.supabase, orderId, nextStatus, req.appUser);
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

router.post("/complaints", requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const orderId = String(req.body?.order_id || "").trim() || null;
    if (!message) return fail(res, "message required", 400);

    const row = {
      user_id: req.appUser.id,
      order_id: orderId,
      message,
      status: "open",
    };
    const { data, error } = await req.supabase.from("complaints").insert(row).select("*").single();
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaint: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/complaints/mine", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("complaints")
      .select("*")
      .eq("user_id", req.appUser.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return fail(res, error.message, 400);
    return ok(res, { complaints: data || [] });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

module.exports = router;
