const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { getJwtSecret } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

const router = express.Router();
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function allowDevOtp() {
  return String(process.env.ALLOW_DEV_OTP || "")
    .trim()
    .toLowerCase() === "true";
}

function nowIso() {
  return new Date().toISOString();
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
  const { data: existing, error: selErr } = await sb
    .from("users")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.id) {
    const { data, error } = await sb
      .from("users")
      .update({ role: "driver", updated_at: nowIso() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb
    .from("users")
    .insert({ phone: phoneDigits, role: "driver", updated_at: nowIso() })
    .select()
    .single();
  if (error) throw error;
  return data;
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
      sent = await sendWhatsApp({
        to: digits,
        message: `رمز دخول المندوب ERVENOW: ${code}`,
      });
    } catch (e) {
      sent = false;
    }

    const payload = { ok: true, sent };
    if (allowDevOtp()) payload.dev_otp = code;
    return res.json(payload);
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
    const isDev = allowDevOtp() && !!saved && saved.code === code;
    const valid =
      !!saved &&
      saved.code === code &&
      Number(saved.expiresAt) > Date.now();
    if (!valid && !isDev) return fail(res, "رمز غير صحيح أو منتهي", 400);
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
      updated_at: nowIso(),
    };

    const { data, error } = await req.supabase
      .from("drivers")
      .upsert(row, { onConflict: "phone" })
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    return ok(res, {
      driver: data,
      message: "تم تسجيلك — بانتظار الموافقة",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/orders", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
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
    return ok(res, { accepted: true, order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/update-location", requireAuth, requireRole("driver"), async (req, res) => {
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
    return ok(res, { updated: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/start-delivery/:id", requireAuth, requireRole("driver"), async (req, res) => {
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
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/complete-order/:id", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "order id required", 400);
    const { data, error } = await req.supabase
      .from("orders")
      .update({ delivery_status: "delivered", updated_at: nowIso() })
      .eq("id", id)
      .eq("driver_id", req.appUser.id)
      .in("delivery_status", ["accepted", "delivering"])
      .select()
      .maybeSingle();
    if (error) return fail(res, error.message, 400);
    if (!data) return fail(res, "order not available", 400);
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/rating", requireAuth, requireRole("driver"), async (req, res) => {
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
