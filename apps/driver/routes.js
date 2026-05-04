const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../../shared/middleware/auth");
const { getJwtSecret } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { driverPendingRegistrationBody } = require("../../shared/messages/driverWhatsApp");
const { createServiceClient } = require("../../shared/config/supabase");
const { notifyDriver } = require("./notify");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { setStatus } = require("../delivery/service");
const {
  sendOTP,
  sendOrderAcceptedToCustomer,
  sendCustomerDeliveringNotice,
  sendDriverArrived,
} = require("../../shared/services/whatsappService");
const { attachSiteSessionCookie } = require("../../shared/middleware/publicSiteOtpGate");

const router = express.Router();

router.use((req, res, next) => {
  const sb = createServiceClient();
  if (!sb) {
    return res.status(503).json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY مطلوب للمصادقة عبر المنصة",
    });
  }
  req.supabase = sb;
  next();
});
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

function signDriverToken(userId, phoneDigits) {
  const secret = getJwtSecret();
  return jwt.sign({ sub: userId, phone: phoneDigits, role: "driver" }, secret, {
    expiresIn: "7d",
  });
}

async function getApprovedDriverByPhone(sb, phoneDigits) {
  const { data, error } = await sb
    .from("drivers")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (String(data.status || "") !== "approved" || data.active !== true) return null;
  return data;
}

async function ensureApprovedDriver(req, res) {
  const phone = String(req.appUser?.phone || "").replace(/\D/g, "");
  if (!phone) {
    fail(res, "بيانات المندوب غير صالحة", 403);
    return null;
  }
  const drv = await getApprovedDriverByPhone(req.supabase, phone);
  if (!drv) {
    fail(res, "الحساب غير مفعل من الإدارة", 403);
    return null;
  }
  return drv;
}

async function upsertDriverUser(sb, phoneDigits) {
  let existing = null;
  let selErr = null;
  const firstSel = await sb
    .from("users")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (firstSel.error && isMissingStatusColumnError(firstSel.error)) {
    const fallbackSel = await sb
      .from("users")
      .select("id, role, phone, updated_at")
      .eq("phone", phoneDigits)
      .maybeSingle();
    existing = fallbackSel.data || null;
    selErr = fallbackSel.error || null;
  } else {
    existing = firstSel.data || null;
    selErr = firstSel.error || null;
  }
  if (selErr) throw selErr;
  if (existing && existing.id) {
    if (
      String(existing.status || "").toLowerCase() === "blocked" ||
      String(existing.role || "").toLowerCase() === "blocked"
    ) {
      throw new Error("الحساب محظور من الإدارة");
    }
    const withStatusUpdate = await sb
      .from("users")
      .update({ role: "driver", status: "active", updated_at: nowIso() })
      .eq("id", existing.id)
      .select()
      .single();
    if (!withStatusUpdate.error) return withStatusUpdate.data;
    if (!isMissingStatusColumnError(withStatusUpdate.error)) throw withStatusUpdate.error;
    const fallbackUpdate = await sb
      .from("users")
      .update({ role: "driver", updated_at: nowIso() })
      .eq("id", existing.id)
      .select()
      .single();
    if (fallbackUpdate.error) throw fallbackUpdate.error;
    return fallbackUpdate.data;
  }
  const withStatusInsert = await sb
    .from("users")
    .insert({ phone: phoneDigits, role: "driver", status: "active", updated_at: nowIso() })
    .select()
    .single();
  if (!withStatusInsert.error) return withStatusInsert.data;
  if (!isMissingStatusColumnError(withStatusInsert.error)) throw withStatusInsert.error;
  const fallbackInsert = await sb
    .from("users")
    .insert({ phone: phoneDigits, role: "driver", updated_at: nowIso() })
    .select()
    .single();
  if (fallbackInsert.error) throw fallbackInsert.error;
  return fallbackInsert.data;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toNumberOrNaN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

router.post("/send-otp", async (req, res) => {
  try {
    const e164 = toE164(req.body?.phone);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) {
      return fail(res, "رقم الجوال غير صالح", 400);
    }
    const digits = toStorageDigits(e164);
    const code = genOtp();
    otpStore.set(digits, { code, expiresAt: Date.now() + OTP_TTL_MS });

    let sent = false;
    try {
      sent = await sendOTP(digits, code, {
        message: `رمز دخول المندوب ERVENOW: ${code}`,
        type: "otp_driver",
      });
    } catch (e) {
      sent = false;
    }

    return res.json({ ok: true, sent });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const e164 = toE164(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    if (!e164 || !isErvnowSaudiMobileE164(e164)) return fail(res, "رقم الجوال غير صالح", 400);
    if (!code) return fail(res, "أدخل رمز الدخول", 400);
    const digits = toStorageDigits(e164);

    const saved = otpStore.get(digits);
    const valid =
      !!saved &&
      saved.code === code &&
      Number(saved.expiresAt) > Date.now();
    if (!valid) return fail(res, "رمز غير صحيح أو منتهي", 400);
    otpStore.delete(digits);

    const { data: drv, error: dErr } = await req.supabase
      .from("drivers")
      .select("*")
      .eq("phone", digits)
      .maybeSingle();
    if (dErr) return fail(res, dErr.message, 400);
    if (!drv) return fail(res, "المندوب غير مسجل", 403);
    if (String(drv.status || "") !== "approved" || drv.active !== true) {
      return fail(res, "الحساب بانتظار الموافقة أو موقوف", 403);
    }

    const user = await upsertDriverUser(req.supabase, digits);
    const token = signDriverToken(user.id, digits);
    attachSiteSessionCookie(req, res, token);
    return ok(res, {
      token,
      driver: {
        id: drv.id,
        name: drv.name,
        phone: drv.phone,
        car_type: drv.car_type,
        status: drv.status,
      },
      profile: {
        id: user.id,
        role: "driver",
        phone: user.phone,
      },
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/register", async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const iqama = String(b.iqama || "").trim();
    const carType = String(b.car_type || "").trim();
    const plate = String(b.plate_number || "").trim();
    const e164 = toE164(b.phone);
    if (!name) return fail(res, "الاسم مطلوب", 400);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) return fail(res, "رقم الجوال غير صالح", 400);
    if (!iqama) return fail(res, "رقم الهوية / الإقامة مطلوب", 400);
    if (!carType) return fail(res, "نوع المركبة مطلوب", 400);
    if (!plate) return fail(res, "رقم اللوحة مطلوب", 400);
    const phone = toStorageDigits(e164);

    const row = {
      name,
      phone,
      iqama,
      car_type: carType,
      plate_number: plate,
      status: "pending",
      active: false,
    };

    const { data, error } = await req.supabase
      .from("drivers")
      .upsert(row, { onConflict: "phone" })
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    try {
      await sendWhatsApp({
        to: phone,
        message: driverPendingRegistrationBody(name),
      });
    } catch (waErr) {
      console.error("[driver/register] WhatsApp:", waErr && (waErr.message || String(waErr)));
    }
    return ok(res, {
      driver: data,
      message: "تم تسجيلك — بانتظار الموافقة",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/orders", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const driverId = req.appUser.id;
    const { data: assignedOrders, error: asErr } = await req.supabase
      .from("orders")
      .select("*")
      .eq("driver_id", driverId)
      .in("delivery_status", ["accepted", "delivering", "pending"])
      .order("created_at", { ascending: false });
    if (asErr) return fail(res, asErr.message, 400);

    const { data: openOrders, error: opErr } = await req.supabase
      .from("orders")
      .select("*")
      .is("driver_id", null)
      .in("delivery_status", ["new", "pending"])
      .order("created_at", { ascending: false });
    if (opErr) return fail(res, opErr.message, 400);

    const { data: activeDrivers, error: drErr } = await req.supabase
      .from("drivers")
      .select("id, lat, lng")
      .eq("status", "approved")
      .eq("active", true);
    if (drErr) {
      console.error("[driver/orders] drivers location query failed:", drErr.message);
    }

    const activeList = (activeDrivers || []).filter((d) => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)));
    const meId = String(drv.id || "");
    const meLat = toNumberOrNaN(drv.lat);
    const meLng = toNumberOrNaN(drv.lng);

    const visibleOpenOrders = (openOrders || []).filter((order) => {
      const orderLat = toNumberOrNaN(order.pickup_lat);
      const orderLng = toNumberOrNaN(order.pickup_lng);
      if (!Number.isFinite(orderLat) || !Number.isFinite(orderLng)) return true;
      if (!Number.isFinite(meLat) || !Number.isFinite(meLng)) return false;
      if (!activeList.length) return true;

      const nearest = activeList
        .map((d) => ({
          id: String(d.id || ""),
          dist: haversineKm(orderLat, orderLng, Number(d.lat), Number(d.lng)),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);
      const allowed = nearest.some((d) => d.id === meId);
      if (allowed) notifyDriver(drv, order);
      return allowed;
    });

    const finalOrders = [...(assignedOrders || []), ...visibleOpenOrders];
    return ok(res, { orders: finalOrders });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/wallet", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const { data, error } = await req.supabase
      .from("ervenow_wallets")
      .select("balance, total_earned, total_withdrawn")
      .eq("user_id", req.appUser.id)
      .maybeSingle();
    if (error) return fail(res, error.message, 400);
    return ok(res, {
      balance: Number(data?.balance) || 0,
      total_earned: Number(data?.total_earned) || 0,
      total_withdrawn: Number(data?.total_withdrawn) || 0,
      wallet_mode: "operational",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/accept/:id", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
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
    await bumpDeliveryOrdersListEpoch();
    if (data.customer_phone) {
      await sendOrderAcceptedToCustomer(data, req.appUser.phone);
    }
    return ok(res, { accepted: true, order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/update-location", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
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
    const { error: dErr } = await req.supabase
      .from("drivers")
      .update({
        lat,
        lng,
        last_seen: nowIso(),
      })
      .eq("id", drv.id);
    if (dErr) {
      console.error("[driver/update-location] drivers table location update failed:", dErr.message);
    }
    return ok(res, { updated: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/start-delivery/:id", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "order id required", 400);
    const { data, error } = await req.supabase
      .from("orders")
      .update({ delivery_status: "delivering", updated_at: nowIso() })
      .eq("id", id)
      .eq("driver_id", req.appUser.id)
      .in("delivery_status", ["accepted", "pending"])
      .select()
      .maybeSingle();
    if (error) return fail(res, error.message, 400);
    if (!data) return fail(res, "order not available", 400);
    if (data.customer_phone) {
      await sendCustomerDeliveringNotice(data);
    }
    await bumpDeliveryOrdersListEpoch();
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/complete-order/:id", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "order id required", 400);
    const { data, error } = await setStatus(req.supabase, id, "delivered", req.appUser);
    if (error) return fail(res, error.message || "order not available", 400);
    if (!data) return fail(res, "order not available", 400);
    if (data.customer_phone) {
      await sendDriverArrived(data);
    }
    if (data.store_id) {
      try {
        const { error: rpcErr } = await req.supabase.rpc("increment_store_orders", { store_id: data.store_id });
        if (rpcErr) {
          console.error("[driver/complete-order] increment_store_orders:", rpcErr.message || rpcErr);
        }
      } catch (e) {
        console.error("[driver/complete-order] increment_store_orders:", e && (e.message || e));
      }
    }
    await bumpDeliveryOrdersListEpoch();
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/rating", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
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
