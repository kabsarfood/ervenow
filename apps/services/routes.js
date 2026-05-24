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
const {
  HOME_SERVICE_CATALOG,
  isHomeServiceType,
  normalizeServiceType,
  computeHomeServiceTotal,
  serviceDisplayName,
} = require("../../shared/utils/homeServicePricing");
const { recordCommissionDebtOnDelivered } = require("../../shared/services/providerCommissionDebts");
const {
  insertServiceBookingResilient,
  insertServiceBookingsBatchResilient,
} = require("../../shared/utils/idempotency");
const { completeServiceBooking } = require("../../shared/services/completeServiceBooking");
const { sendReserveWelcomeWhatsApp } = require("../../shared/services/serviceProviderReserve");
const { getOperationalWalletPayload } = require("../../shared/utils/operationalWallet");
const {
  bookingTypesForProvider,
  districtsMatch,
  providerAreaMatches,
  providerAreaLabel,
  panelTitleForType,
  labelForType,
  providerMatchesBookingType,
} = require("../../shared/utils/serviceProviderTypes");
const { toStorageDigits } = require("../../shared/utils/phone");

const router = express.Router();
const SERVICE_TYPES = new Set([
  "plumber",
  "electrician",
  "nursery",
  "agricultural_engineer",
  "ac_technician",
  "cleaning",
  "cleaning_villa",
  "cleaning_building",
  "laundry_estates",
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
    cleaning: "غسيل درج فيلا",
    cleaning_villa: "غسيل درج فيلا",
    cleaning_building: "غسيل درج عمارة (3 أدوار)",
    vehicle_transfer: "نقل مركبات",
    internal_delivery: "توصيل داخلي",
    pickup_truck: "ونيت",
    furniture_move: "نقل أثاث",
    gas_delivery: "تبديل غاز",
    agricultural_engineer: "مهندس زراعي",
    laundry_estates: "مغسل فلل وعمائر",
    pickup_truck: "سائق سطحى",
    service: "خدمة عامة",
  };
  return map[type] || labelForType(type) || type || "خدمة";
}

function filterBookingsForProvider(rows, providerId, providerType, providerDistrict) {
  const types = bookingTypesForProvider(providerType);
  const pid = String(providerId || "");
  return (rows || []).filter((b) => {
    const st = String(b.service_type || "").toLowerCase();
    if (!providerMatchesBookingType(providerType, st, b.gas_mode)) return false;
    const status = String(b.status || "new").toLowerCase();
    const bookedBy = b.provider_id ? String(b.provider_id) : "";
    if (bookedBy && bookedBy !== pid) return false;
    if (bookedBy === pid) return true;
    if (status !== "new" && status !== "pending") return false;
    return providerAreaMatches(providerType, providerDistrict, b.district, b.location);
  });
}

function sortBookingsByPriority(rows, providerId) {
  const pid = String(providerId || "");
  return (rows || []).slice().sort((a, b) => {
    const sa = String(a.status || "").toLowerCase();
    const sb = String(b.status || "").toLowerCase();
    const mineA = String(a.provider_id || "") === pid;
    const mineB = String(b.provider_id || "") === pid;
    if (mineA && !mineB) return -1;
    if (!mineA && mineB) return 1;
    const rank = (s) => {
      if (s === "new") return 0;
      if (s === "accepted") return 1;
      if (s === "delivering") return 2;
      if (s === "delivered") return 3;
      return 4;
    };
    const d = rank(sa) - rank(sb);
    if (d !== 0) return d;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
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

router.get("/catalog", (_req, res) => {
  return ok(res, { catalog: HOME_SERVICE_CATALOG, currency: "SAR" });
});

router.post("/home-order", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "تعذر تهيئة الاتصال بقاعدة البيانات", 503);

    const b = req.body || {};
    const service_type = normalizeServiceType(b.service_type);
    if (!isHomeServiceType(service_type)) return fail(res, "نوع الخدمة غير مدعوم", 400);

    const district = String(b.district || "").trim();
    const customer_phone = String(b.customer_phone || (req.appUser && req.appUser.phone) || "").trim();
    if (!district) return fail(res, "حدد الحي", 400);
    if (customer_phone.replace(/\D/g, "").length < 9) return fail(res, "أدخل رقم جوال صحيح", 400);

    const location = String(b.location || "").trim();
    const payMode = String(b.pay_mode || b.payment_mode || "on_service").trim().toLowerCase();
    const entry = HOME_SERVICE_CATALOG[service_type];
    const totalAmount = computeHomeServiceTotal(service_type);

    if (payMode === "cart") {
      return ok(res, {
        use_cart: true,
        cart_item: {
          type: service_type,
          title: serviceDisplayName(service_type),
          price: totalAmount,
          data: {
            district,
            location,
            customer_phone,
            total_amount: totalAmount,
            payment_status: "unpaid",
          },
        },
      });
    }

    const payAfterDiag = Boolean(entry.payAfterDiagnosis);
    let payment_status = "unpaid";
    if (payMode === "paid" || payMode === "prepaid") payment_status = "paid";
    if (payAfterDiag && payMode !== "paid" && payMode !== "prepaid") payment_status = "unpaid";

    const service_order_number = await buildNextServiceOrderNumber(sb);
    const insertRow = buildServiceBookingRow({
      service_order_number,
      customer_id: req.appUser ? req.appUser.id : null,
      customer_phone,
      service_type,
      service_name: serviceDisplayName(service_type),
      district,
      location: location || district,
      qty: 1,
      total_amount: totalAmount,
      payment_status,
    });

    const { data, error } = await insertServiceBookingResilient(sb, insertRow);
    if (error) return fail(res, error.message, 400);

    await notifyProvidersForBooking(sb, data);

    return ok(res, {
      booking: data,
      order_number: data.service_order_number,
      message:
        payment_status === "paid"
          ? "تم تسجيل الطلب وإشعار المزودين"
          : entry.fixedPrice
            ? "تم تسجيل الطلب — سعر ثابت " + (entry.priceLabel || "")
            : entry.inspectionOnly
              ? "تم تسجيل الطلب — رسوم المعاينة 60 ريال، والإصلاح يُحسب لاحقاً عند رغبتكم"
              : payAfterDiag
                ? "تم تسجيل الطلب — الدفع بعد المعاينة"
                : "تم تسجيل الطلب — الدفع عند إتمام الخدمة",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

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

    const insertRow = buildServiceBookingRow({
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

router.get("/provider-types", (_req, res) => {
  const { SERVICE_PROVIDER_OPTIONS } = require("../../shared/utils/serviceProviderTypes");
  return ok(res, { options: SERVICE_PROVIDER_OPTIONS });
});

router.get("/providers", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const serviceType = String(req.query?.service_type || req.query?.type || "").trim().toLowerCase();
    const district = String(req.query?.district || "").trim();
    let q = sb
      .from("users")
      .select("id, name, phone, service_type, service_district, service_rating_avg, service_rating_count, lat, lng")
      .eq("role", "service");
    if (serviceType) {
      const types = bookingTypesForProvider(serviceType);
      if (types.length === 1) q = q.eq("service_type", types[0]);
    }
    const { data, error } = await q;
    if (error) return fail(res, error.message, 400);
    let list = (data || []).filter((u) => {
      if (!serviceType) return true;
      return providerMatchesBookingType(u.service_type, serviceType);
    });
    if (district) {
      list = list.filter((u) => districtsMatch(u.service_district, district));
    }
    list.sort((a, b) => {
      const ra = Number(a.service_rating_avg) || 0;
      const rb = Number(b.service_rating_avg) || 0;
      if (rb !== ra) return rb - ra;
      return (Number(b.service_rating_count) || 0) - (Number(a.service_rating_count) || 0);
    });
    return ok(res, { providers: list });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/me/dashboard", requireAuth, requireRole("service"), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    let profile = null;
    const firstProfile = await sb
      .from("users")
      .select(
        "id, name, phone, service_type, service_district, service_rating_avg, service_rating_count, service_vehicle_type, service_plate_number, service_vehicle_model"
      )
      .eq("id", uid)
      .maybeSingle();
    if (firstProfile.error) {
      const msg = String(firstProfile.error.message || "");
      if (/service_vehicle_type|service_plate_number|service_vehicle_model/i.test(msg)) {
        const fallback = await sb
          .from("users")
          .select("id, name, phone, service_type, service_district, service_rating_avg, service_rating_count")
          .eq("id", uid)
          .maybeSingle();
        if (fallback.error) return fail(res, fallback.error.message, 400);
        profile = fallback.data;
      } else {
        return fail(res, firstProfile.error.message, 400);
      }
    } else {
      profile = firstProfile.data;
    }

    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    const types = bookingTypesForProvider(providerType);

    let bookingsQ = sb.from("service_bookings").select("*").order("created_at", { ascending: false }).limit(200);
    if (types.length === 1) bookingsQ = bookingsQ.eq("service_type", types[0]);
    else if (types.length > 1) bookingsQ = bookingsQ.in("service_type", types);
    const { data: rawBookings, error: bErr } = await bookingsQ;
    if (bErr) return fail(res, bErr.message, 400);

    const bookings = sortBookingsByPriority(
      filterBookingsForProvider(rawBookings, uid, providerType, profile?.service_district),
      uid
    );
    const newCount = bookings.filter((b) => {
      const s = String(b.status || "").toLowerCase();
      return (s === "new" || s === "pending") && !b.provider_id;
    }).length;

    let commissionPending = 0;
    try {
      const { data: debts } = await sb
        .from("provider_commission_debts")
        .select("commission_amount, status")
        .eq("provider_id", uid)
        .eq("status", "pending");
      commissionPending = (debts || []).reduce((s, r) => s + (Number(r.commission_amount) || 0), 0);
    } catch (_) {
      /* table optional */
    }

    const completed = bookings.filter((b) => String(b.status || "").toLowerCase() === "delivered").length;
    const activeJobs = bookings.filter((b) => {
      const s = String(b.status || "").toLowerCase();
      return (s === "accepted" || s === "delivering") && String(b.provider_id || "") === String(uid);
    }).length;

    let walletBalance = 0;
    let walletEarned = 0;
    try {
      const wallet = await getOperationalWalletPayload(sb, uid);
      walletBalance = Number(wallet.balance) || 0;
      walletEarned = Number(wallet.total_earned) || 0;
    } catch (_) {
      /* optional */
    }

    return ok(res, {
      panel_title: panelTitleForType(providerType),
      service_label: labelForType(providerType),
      profile: profile || {},
      bookings,
      stats: {
        new_orders: newCount,
        completed_jobs: completed,
        active_jobs: activeJobs,
        commission_pending_sar: Math.round(commissionPending * 100) / 100,
        wallet_balance_sar: Math.round(walletBalance * 100) / 100,
        wallet_earned_sar: Math.round(walletEarned * 100) / 100,
        rating_avg: Number(profile?.service_rating_avg) || 0,
        rating_count: Number(profile?.service_rating_count) || 0,
      },
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/bookings", requireAuth, async (req, res) => {
  try {
    const user = req.appUser;
    if (user.role !== "service") return res.status(403).json({ ok: false });

    const { data: profile, error: pErr } = await req.supabase
      .from("users")
      .select("service_type, service_district")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) return fail(res, pErr.message, 400);

    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return ok(res, { bookings: [] });

    const types = bookingTypesForProvider(providerType);
    let q = req.supabase.from("service_bookings").select("*").order("created_at", { ascending: false }).limit(200);
    if (types.length === 1) q = q.eq("service_type", types[0]);
    else q = q.in("service_type", types);
    const { data, error } = await q;
    if (error) throw error;

    const filtered = sortBookingsByPriority(
      filterBookingsForProvider(data, user.id, providerType, profile?.service_district),
      user.id
    );
    return res.json({ ok: true, bookings: filtered });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

router.post("/bookings/:id/reserve", requireAuth, requireRole("service"), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const { data: profile } = await sb
      .from("users")
      .select("id, name, phone, service_type, service_district")
      .eq("id", uid)
      .maybeSingle();
    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return fail(res, "نوع الخدمة غير مضبوط في حسابك", 400);

    const { data: booking, error: gErr } = await sb
      .from("service_bookings")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);

    const types = bookingTypesForProvider(providerType);
    if (!providerMatchesBookingType(providerType, booking.service_type, booking.gas_mode)) {
      return fail(res, "هذا الطلب لا يطابق تخصصك", 403);
    }
    if (!providerAreaMatches(providerType, profile?.service_district, booking.district, booking.location)) {
      return fail(res, providerType === "pickup_truck" ? "الطلب خارج مدينتك المسجّلة" : "الطلب خارج حيّك المسجّل", 403);
    }
    const st = String(booking.status || "new").toLowerCase();
    if (st !== "new" && st !== "pending") return fail(res, "الطلب غير متاح للحجز", 400);
    if (booking.provider_id && String(booking.provider_id) !== String(uid)) {
      return fail(res, "تم حجز الطلب من مزود آخر", 409);
    }

    const now = new Date().toISOString();
    const { data, error } = await sb
      .from("service_bookings")
      .update({
        provider_id: uid,
        status: "accepted",
        reserved_at: now,
        updated_at: now,
      })
      .eq("id", req.params.id)
      .is("provider_id", null)
      .in("status", ["new", "pending"])
      .select("*")
      .maybeSingle();

    if (error) return fail(res, error.message, 400);
    if (!data) return fail(res, "تعذر حجز الطلب — ربما حجزه مزود آخر", 409);

    await sendReserveWelcomeWhatsApp(data, profile?.phone, profile?.name);

    return ok(res, { booking: data, message: "تم حجز الطلب وإرسال تفاصيله عبر واتساب" });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/complete", requireAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const role = String(req.appUser.role || "").toLowerCase();
    const { data: booking, error: gErr } = await sb
      .from("service_bookings")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);

    const status = String(booking.status || "").toLowerCase();
    if (status === "delivered" || status === "cancelled") {
      return ok(res, { booking, already_done: true });
    }

    const phoneDigits = toStorageDigits(req.appUser.phone || "");
    const custPhone = toStorageDigits(booking.customer_phone || "");
    const isProvider = role === "service" && String(booking.provider_id || "") === String(uid);
    const isCustomer =
      role === "customer" &&
      (String(booking.customer_id || "") === String(uid) || (phoneDigits && custPhone && phoneDigits === custPhone));
    const isAdmin = role === "admin";
    if (!isProvider && !isCustomer && !isAdmin) {
      return fail(res, "غير مصرح", 403);
    }

    const providerId = booking.provider_id || (isProvider ? uid : null);
    const step = String(req.body?.step || req.body?.actor || "").toLowerCase();
    let actor = "legacy";
    if (isAdmin) actor = "both";
    else if (isProvider) actor = "provider";
    else if (isCustomer) actor = "customer";

    const done = await completeServiceBooking(sb, req.params.id, providerId, { actor });
    if (done.error) return fail(res, done.error.message || "فشل الإتمام", 400);
    if (done.already_done) {
      return ok(res, { booking: done.data, already_done: true });
    }

    if (done.finalized) {
      await sendCustomerRateWhatsApp(done.data);
      return ok(res, {
        booking: done.data,
        message: "تمت المهمة — شكراً. يمكن للعميل تقييم الخدمة الآن.",
        finalized: true,
      });
    }

    const msg =
      actor === "provider"
        ? "تم تأكيد التنفيذ — بانتظار تأكيد العميل."
        : "تم تأكيد الاستلام — بانتظار مزود الخدمة.";
    return ok(res, {
      booking: done.data,
      message: msg,
      finalized: false,
      awaiting_customer: !!done.data?.awaiting_customer,
      awaiting_provider: !!done.data?.awaiting_provider,
    });
  } catch (e) {
    return fail(res, e.message, 500);
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
    const phoneDigits = toStorageDigits(req.appUser.phone || "");
    const custPhone = toStorageDigits(booking.customer_phone || "");
    const ownsBooking =
      String(booking.customer_id || "") === String(req.appUser.id) ||
      (phoneDigits && custPhone && phoneDigits === custPhone);
    if (!ownsBooking) return fail(res, "Forbidden", 403);
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
