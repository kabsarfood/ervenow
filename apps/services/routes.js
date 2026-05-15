const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const { computePlatformCommission } = require("../../shared/utils/serviceCommission");
const {
  gasModeFromBody,
  computeGasTotal,
  gasServiceLabel,
  CENTRAL_LITERS,
} = require("../../shared/utils/gasDeliveryPricing");
const { notifyProvidersForBooking } = require("../../shared/services/serviceBookingNotify");
const { recordCommissionDebtOnDelivered } = require("../../shared/services/providerCommissionDebts");
const {
  insertServiceBookingResilient,
  insertServiceBookingsBatchResilient,
} = require("../../shared/utils/idempotency");

const router = express.Router();
const SERVICE_TYPES = new Set([
  "plumber",
  "electrician",
  "nursery",
  "ac_technician",
  "cleaning",
  "vehicle_transfer",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
  "gas_delivery",
  "service",
]);

function normalizePaymentStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "paid" || s === "unpaid") return s;
  return "unpaid";
}

function normalizeMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

async function buildNextServiceOrderNumber(sb) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const { count, error } = await sb
    .from("service_bookings")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) throw error;
  const seq = (count || 0) + 1;
  return `ES-${day}-${String(seq).padStart(3, "0")}`;
}

function labelByType(type) {
  const map = {
    plumber: "سباك",
    electrician: "كهربائي",
    nursery: "مشتل",
    ac_technician: "فني مكيفات",
    cleaning: "غسيل درج",
    vehicle_transfer: "نقل مركبات",
    internal_delivery: "توصيل داخلي",
    pickup_truck: "ونيت",
    furniture_move: "نقل أثاث",
    gas_delivery: "تبديل غاز",
    service: "خدمة عامة",
  };
  return map[type] || type || "خدمة";
}

function buildServiceBookingRow(base) {
  const service_type = String(base.service_type || "service").trim().toLowerCase();
  const totalAmount = normalizeMoney(base.total_amount);
  return {
    service_order_number: base.service_order_number,
    customer_id: base.customer_id || null,
    customer_phone: String(base.customer_phone || "").trim(),
    service_type,
    service_name: String(base.service_name || labelByType(service_type)).trim(),
    district: String(base.district || "").trim(),
    location: String(base.location || "").trim(),
    qty: normalizeQty(base.qty),
    gas_mode: base.gas_mode || null,
    gas_liters: base.gas_liters != null ? Number(base.gas_liters) : null,
    total_amount: totalAmount,
    payment_status: normalizePaymentStatus(base.payment_status),
    platform_commission: computePlatformCommission(totalAmount, service_type),
    status: "new",
  };
}

async function sendCustomerRateWhatsApp(booking) {
  if (!booking || !booking.customer_phone) return;
  const message =
    `✅ تم تنفيذ طلبك (${booking.service_name || "خدمة"}).\n` +
    `يسعدنا تقييمك للخدمة من 1 إلى 5 بالرد على هذه الرسالة.`;
  try {
    await sendWhatsApp({ to: booking.customer_phone, message });
  } catch (e) {
    console.error("[services] customer rate WhatsApp:", e && (e.message || e));
  }
}

async function recalcProviderRating(sb, providerId) {
  if (!providerId) return;
  const { data, error } = await sb
    .from("service_bookings")
    .select("rating")
    .eq("provider_id", providerId)
    .not("rating", "is", null);
  if (error) {
    console.error("[services] recalc rating:", error.message || error);
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  const count = rows.length;
  const avg = count
    ? Math.round(
        (rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count) * 100
      ) / 100
    : 0;
  const { error: upErr } = await sb
    .from("users")
    .update({
      service_rating_avg: avg,
      service_rating_count: count,
      updated_at: new Date().toISOString(),
    })
    .eq("id", providerId);
  if (upErr) {
    console.error("[services] update provider rating:", upErr.message || upErr);
  }
}

router.get("/gas/pricing", (_req, res) => {
  return ok(res, {
    cylinder_one: 39,
    cylinder_two: 75,
    central_per_liter: 0.9,
    central_liters: CENTRAL_LITERS,
    commission_rate: require("../../shared/utils/platformCommission").PLATFORM_COMMISSION_RATE,
  });
});

router.post("/gas-order", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "تعذر تهيئة الاتصال بقاعدة البيانات", 503);

    const b = req.body || {};
    const gas_mode = gasModeFromBody(b);
    const qty = gas_mode === "cylinder_swap" ? Math.max(1, Math.min(10, normalizeQty(b.qty))) : 1;
    const gas_liters =
      gas_mode === "central_refill" ? Number(b.gas_liters || b.liters) : null;
    if (gas_mode === "central_refill" && !CENTRAL_LITERS.includes(gas_liters)) {
      return fail(res, "اختر كمية التعبئة من القائمة", 400);
    }
    const location = String(b.location || "").trim();
    if (!location) return fail(res, "حدد موقع التوصيل", 400);

    const totalAmount = computeGasTotal(gas_mode, qty, gas_liters);
    if (totalAmount <= 0) return fail(res, "تعذر حساب السعر", 400);

    const payOnDelivery = Boolean(b.pay_on_delivery);
    const payment_status = payOnDelivery ? "unpaid" : normalizePaymentStatus(b.payment_status || "paid");
    const service_order_number = await buildNextServiceOrderNumber(sb);
    const service_name = gasServiceLabel(gas_mode);

    const insertRow = buildServiceBookingRow(sb, {
      service_order_number,
      customer_id: req.appUser ? req.appUser.id : null,
      customer_phone: String(b.customer_phone || (req.appUser && req.appUser.phone) || "").trim(),
      service_type: "gas_delivery",
      service_name,
      district: String(b.district || "").trim(),
      location,
      qty: gas_mode === "central_refill" ? gas_liters : qty,
      gas_mode,
      gas_liters: gas_mode === "central_refill" ? gas_liters : null,
      total_amount: totalAmount,
      payment_status,
    });

    const { data, error } = await insertServiceBookingResilient(sb, insertRow);
    if (error) return fail(res, error.message, 400);

    await notifyProvidersForBooking(sb, data);

    return ok(res, {
      booking: data,
      order_number: data.service_order_number,
      message: payOnDelivery
        ? "تم تسجيل الطلب — الدفع عند التوصيل"
        : "تم تسجيل الطلب والدفع",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/health", (_req, res) => ok(res, { service: "services" }));

router.get("/bookings", requireAuth, async (req, res) => {
  try {
    const user = req.appUser;
    if (user.role !== "service") return res.status(403).json({ ok: false });

    const { data: profile, error: pErr } = await req.supabase
      .from("users")
      .select("service_type")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) return fail(res, pErr.message, 400);

    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return ok(res, { bookings: [] });

    const { data, error } = await req.supabase
      .from("service_bookings")
      .select("*")
      .eq("service_type", providerType)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ ok: true, bookings: data || [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

router.post("/bookings", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const service_type = String(b.service_type || "").trim().toLowerCase() || "service";
    const service_name = String(b.service_name || "").trim() || labelByType(service_type);
    const service_order_number = await buildNextServiceOrderNumber(req.supabase);
    const insertRow = buildServiceBookingRow({
      service_order_number,
      customer_id: req.appUser.id,
      customer_phone: b.customer_phone || req.appUser.phone || "",
      service_type,
      service_name,
      district: b.district,
      location: b.location,
      qty: b.qty,
      gas_mode: b.gas_mode,
      gas_liters: b.gas_liters,
      total_amount: b.total_amount,
      payment_status: b.payment_status,
    });

    const { data, error } = await insertServiceBookingResilient(req.supabase, insertRow);
    if (error) return fail(res, error.message, 400);
    ok(res, { booking: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/checkout", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "تعذر تهيئة الاتصال بقاعدة البيانات", 503);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return fail(res, "السلة فارغة", 400);

    const serviceItems = items.filter((it) => SERVICE_TYPES.has(String(it.type || "").trim().toLowerCase()));
    if (!serviceItems.length) {
      return ok(res, { bookings: [], skipped: items.length, message: "لا توجد عناصر خدمات في السلة" });
    }

    const customerId = req.appUser ? req.appUser.id : null;
    const customerPhoneFromUser = req.appUser ? req.appUser.phone || "" : "";
    const rows = [];
    for (const it of serviceItems) {
      const type = String(it.type || "").trim().toLowerCase();
      const data = it && typeof it.data === "object" && it.data ? it.data : {};
      const service_order_number = await buildNextServiceOrderNumber(sb);
      rows.push(
        buildServiceBookingRow({
          service_order_number,
          customer_id: customerId,
          customer_phone: String(data.customer_phone || customerPhoneFromUser || "").trim(),
          service_type: type,
          service_name: String(it.title || labelByType(type)).trim(),
          district: data.district,
          location: data.location,
          qty: data.qty,
          gas_mode: data.gas_mode,
          gas_liters: data.gas_liters,
          total_amount: it.price || data.total_amount || 0,
          payment_status: data.payment_status || "unpaid",
        })
      );
    }

    const { data: inserted, error } = await insertServiceBookingsBatchResilient(sb, rows);
    if (error) return fail(res, error.message, 400);

    for (const booking of inserted || []) {
      await notifyProvidersForBooking(sb, booking);
    }

    return ok(res, { bookings: inserted || [], skipped: items.length - serviceItems.length });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.patch("/bookings/:id/status", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || "").trim().toLowerCase();
    if (!nextStatus) return fail(res, "status required", 400);
    const allowed = new Set(["accepted", "delivering", "delivered", "cancelled"]);
    if (!allowed.has(nextStatus)) return fail(res, "invalid status", 400);

    const patch = { status: nextStatus, updated_at: new Date().toISOString() };
    if (req.appUser.role === "service") {
      patch.provider_id = req.appUser.id;
    }

    const { data, error } = await req.supabase
      .from("service_bookings")
      .update(patch)
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) return fail(res, error.message, 400);

    if (nextStatus === "delivered") {
      const providerId = data.provider_id || (req.appUser.role === "service" ? req.appUser.id : null);
      if (providerId) {
        try {
          await recordCommissionDebtOnDelivered(req.supabase, data, providerId);
        } catch (debtErr) {
          console.error("[services] commission debt:", debtErr && (debtErr.message || debtErr));
        }
      }
      await sendCustomerRateWhatsApp(data);
    }

    return ok(res, { booking: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/rate", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const r = Number(req.body?.rating);
    const review = String(req.body?.review || "")
      .trim()
      .slice(0, 2000);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return fail(res, "rating must be 1..5", 400);
    }

    const { data: booking, error: gErr } = await req.supabase
      .from("service_bookings")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (gErr || !booking) return fail(res, "Not found", 404);
    if (booking.customer_id !== req.appUser.id) return fail(res, "Forbidden", 403);
    if (String(booking.status || "").toLowerCase() !== "delivered") {
      return fail(res, "booking is not delivered", 400);
    }

    const { data, error } = await req.supabase
      .from("service_bookings")
      .update({
        rating: r,
        review: review || null,
        rated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) return fail(res, error.message, 400);

    if (data.provider_id) {
      await recalcProviderRating(req.supabase, data.provider_id);
    }

    return ok(res, { booking: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/me/checkout-payment-methods", requireAuth, requireRole("service"), async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const platform = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
    const { data: u, error } = await sb.from("users").select("checkout_payment_methods").eq("id", req.appUser.id).maybeSingle();
    if (error && !/column|does not exist|schema cache/i.test(String(error.message || ""))) {
      return fail(res, error.message, 400);
    }
    const userPart = error ? null : u?.checkout_payment_methods;
    return ok(res, { methods: checkoutPaymentMethods.intersectMethods(platform, userPart) });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.patch("/me/checkout-payment-methods", requireAuth, requireRole("service"), async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const platform = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
    const incoming = checkoutPaymentMethods.normalizeMethodsPartial(
      (req.body && req.body.methods) || req.body || {}
    );
    const restricted = checkoutPaymentMethods.intersectMethods(platform, incoming);
    const { data, error } = await sb
      .from("users")
      .update({ checkout_payment_methods: restricted, updated_at: new Date().toISOString() })
      .eq("id", req.appUser.id)
      .select("checkout_payment_methods")
      .single();
    if (error) {
      if (/column|does not exist|schema cache/i.test(String(error.message || ""))) {
        return fail(
          res,
          "نفّذ shared/migration_checkout_payment_methods.sql لإضافة عمود checkout_payment_methods على users",
          400
        );
      }
      return fail(res, error.message, 400);
    }
    return ok(res, { ok: true, methods: data?.checkout_payment_methods || restricted });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
