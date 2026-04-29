const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");

const router = express.Router();
const PLATFORM_COMMISSION_RATE = 0.12;
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

async function getServiceProviderPhones(sb, serviceType) {
  let q = sb.from("users").select("phone").eq("role", "service");
  if (serviceType) q = q.eq("service_type", serviceType);
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return data
    .map((u) => String(u.phone || "").trim())
    .filter((p) => p.length >= 10);
}

async function sendProviderBookingWhatsApp(phones, booking) {
  if (!Array.isArray(phones) || !phones.length || !booking) return;
  const paymentText = booking.payment_status === "paid" ? "مدفوع" : "غير مدفوع";
  const message =
    `📥 طلب خدمة جديد\n` +
    `الخدمة: ${booking.service_name || "خدمة"}\n` +
    `العدد: ${booking.qty || 1}\n` +
    `الموقع/الحي: ${booking.location || booking.district || "—"}\n` +
    `جوال طالب الخدمة: ${booking.customer_phone || "—"}\n` +
    `الحالة المالية: ${paymentText}\n` +
    `القيمة: ${Number(booking.total_amount || 0).toFixed(2)} ريال\n` +
    `عمولة المنصة (12%): ${Number(booking.platform_commission || 0).toFixed(2)} ريال`;
  for (const phone of phones) {
    try {
      await sendWhatsApp({ to: phone, message });
    } catch (e) {
      console.error("[services] provider WhatsApp:", e && (e.message || e));
    }
  }
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
    return res.status(500).json({ ok: false });
  }
});

router.post("/bookings", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const service_type = String(b.service_type || "").trim().toLowerCase() || "service";
    const service_name = String(b.service_name || "").trim() || labelByType(service_type);
    const qty = normalizeQty(b.qty);
    const totalAmount = normalizeMoney(b.total_amount);
    const payment_status = normalizePaymentStatus(b.payment_status);
    const platform_commission = Math.round(totalAmount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const service_order_number = await buildNextServiceOrderNumber(req.supabase);

    const { data, error } = await req.supabase
      .from("service_bookings")
      .insert({
        service_order_number,
        customer_id: req.appUser.id,
        customer_phone: b.customer_phone || req.appUser.phone || "",
        service_type,
        service_name,
        district: String(b.district || "").trim(),
        location: String(b.location || "").trim(),
        qty,
        total_amount: totalAmount,
        payment_status,
        platform_commission,
        status: "new",
      })
      .select()
      .single();
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
      const qty = normalizeQty(data.qty || 1);
      const totalAmount = normalizeMoney(it.price || data.total_amount || 0);
      const service_order_number = await buildNextServiceOrderNumber(sb);
      rows.push({
        service_order_number,
        customer_id: customerId,
        customer_phone: String(data.customer_phone || customerPhoneFromUser || "").trim(),
        service_type: type,
        service_name: String(it.title || labelByType(type)).trim(),
        district: String(data.district || "").trim(),
        location: String(data.location || "").trim(),
        qty,
        total_amount: totalAmount,
        payment_status: normalizePaymentStatus(data.payment_status || "unpaid"),
        platform_commission: Math.round(totalAmount * PLATFORM_COMMISSION_RATE * 100) / 100,
        status: "new",
      });
    }

    const { data: inserted, error } = await sb.from("service_bookings").insert(rows).select("*");
    if (error) return fail(res, error.message, 400);

    for (const booking of inserted || []) {
      const providerPhones = await getServiceProviderPhones(sb, booking.service_type);
      await sendProviderBookingWhatsApp(providerPhones, booking);
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

module.exports = router;
