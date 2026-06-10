const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { requireRole } = require("../../shared/middleware/roles");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const {
  gasModeFromBody,
  computeGasTotal,
  gasServiceLabel,
  CENTRAL_LITERS,
} = require("../../shared/utils/gasDeliveryPricing");
const {
  HOME_SERVICE_CATALOG,
  isHomeServiceType,
  normalizeServiceType,
  computeHomeServiceTotal,
  serviceDisplayName,
} = require("../../shared/utils/homeServicePricing");
const { createServiceOrder } = require("../../shared/services/serviceOrderCreate");
const { createGasDelivery } = require("../delivery/gasDeliveryCreate");
const { completeServiceBooking } = require("../../shared/services/completeServiceBooking");
const { sendReserveWelcomeWhatsApp } = require("../../shared/services/serviceProviderReserve");
const { buildCustomerMessageOrderAccepted } = require("../../shared/messages/deliveryCustomerWhatsApp");
const {
  bookingVehicleCategory,
  serviceUserMatchesVehicleCategory,
} = require("../../shared/utils/internalDeliveryVehicle");
const { broadcastDriverUpdate, broadcastOrderPatch, orderPatchFromRow } = require("../../shared/lib/trackingSocket");
const { getWalletPayloadWithLedgerFallback } = require("../../shared/utils/ledgerWallet");
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
const {
  bookingStatus,
  mapOrdersToBookings,
  orderToBookingView,
  serviceOrdersQuery,
  applyServiceTypeFilter,
  fetchServiceOrderById,
} = require("../../shared/utils/serviceOrderQuery");
const { buildOrderStatusPatch } = require("../../shared/domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../../shared/domain/orders/constants");
const { patchUnifiedOrderStatus } = require("../../shared/services/unifiedOrderStatus");
const { updateOrdersResilient } = require("../../shared/utils/idempotency");
const { applyProviderIdToPatch } = require("../../shared/utils/orderProviderId");

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

function filterBookingsForProvider(rows, providerId, providerType, providerDistrict, providerVehicleType) {
  const types = bookingTypesForProvider(providerType);
  const pid = String(providerId || "");
  const providerUser = {
    service_type: providerType,
    service_vehicle_type: providerVehicleType,
  };
  return (rows || []).filter((b) => {
    const st = String(b.service_type || "").toLowerCase();
    if (!providerMatchesBookingType(providerType, st, b.gas_mode)) return false;
    if (st === "internal_delivery" && !serviceUserMatchesVehicleCategory(providerUser, bookingVehicleCategory(b))) {
      return false;
    }
    const status = bookingStatus(b);
    const bookedBy = b.provider_id ? String(b.provider_id) : "";
    if (bookedBy && bookedBy !== pid) return false;
    if (bookedBy === pid) return true;
    if (status !== "new" && status !== "pending") return false;
    const loc = b.service_location || b.location;
    return providerAreaMatches(providerType, providerDistrict, b.district, loc);
  });
}

function sortBookingsByPriority(rows, providerId) {
  const pid = String(providerId || "");
  return (rows || []).slice().sort((a, b) => {
    const sa = bookingStatus(a);
    const sb = bookingStatus(b);
    const mineA = String(a.provider_id || "") === pid;
    const mineB = String(b.provider_id || "") === pid;
    if (mineA && !mineB) return -1;
    if (!mineA && mineB) return 1;
    const rank = (s) => {
      if (s === "new" || s === "pending") return 0;
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
    service: "خدمة عامة",
  };
  return map[type] || labelForType(type) || type || "خدمة";
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
  const { data, error } = await serviceOrdersQuery(sb)
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
            payment_mode: "cart",
          },
        },
      });
    }

    const { deprecateLegacyOrderRoute, UNIFIED_ORDER_CREATE } = require("../../shared/middleware/deprecateLegacyRoute");
    deprecateLegacyOrderRoute(req, res, "POST /api/services/home-order", UNIFIED_ORDER_CREATE);

    const payAfterDiag = Boolean(entry.payAfterDiagnosis);
    let payment_status = "unpaid";
    if (payMode === "paid" || payMode === "prepaid") payment_status = "paid";
    if (payAfterDiag && payMode !== "paid" && payMode !== "prepaid") payment_status = "unpaid";

    const created = await createServiceOrder(sb, req.appUser || { id: null, phone: customer_phone }, {
      order_type: "service",
      service_type,
      service_name: serviceDisplayName(service_type),
      district,
      location: location || district,
      qty: 1,
      total_amount: totalAmount,
      payment_status,
      customer_phone,
    });
    if (!created.ok) return fail(res, created.message, created.status || 400);
    const data = orderToBookingView(created.order);

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
    const { deprecateLegacyOrderRoute, UNIFIED_ORDER_CREATE } = require("../../shared/middleware/deprecateLegacyRoute");
    deprecateLegacyOrderRoute(req, res, "POST /api/services/gas-order", UNIFIED_ORDER_CREATE);

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
    const { data: gasOrder, error: gasErr } = await createGasDelivery(sb, req.appUser || { id: null, phone: String(b.customer_phone || "") }, {
      location,
      lat: b.lat,
      lng: b.lng,
      district: String(b.district || "").trim(),
      payload: {
        gas_mode,
        qty,
        gas_liters: gas_mode === "central_refill" ? gas_liters : null,
        payment_method: payOnDelivery ? "cash_on_delivery" : "paid",
      },
      payment_status,
      customer_phone: String(b.customer_phone || (req.appUser && req.appUser.phone) || "").trim(),
      delivery_fee: totalAmount,
      force_delivery_fee: true,
    });
    if (gasErr) return fail(res, gasErr.message, 400);
    if (!gasOrder) return fail(res, "تعذر إنشاء طلب الغاز", 400);

    const data = orderToBookingView(gasOrder);

    return ok(res, {
      booking: data,
      order: gasOrder,
      order_number: data.service_order_number || gasOrder.order_number,
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

    let bookingsQ = serviceOrdersQuery(sb).order("created_at", { ascending: false }).limit(200);
    bookingsQ = applyServiceTypeFilter(bookingsQ, types);
    const { data: rawBookings, error: bErr } = await bookingsQ;
    if (bErr) return fail(res, bErr.message, 400);

    const bookings = sortBookingsByPriority(
      filterBookingsForProvider(
        mapOrdersToBookings(rawBookings),
        uid,
        providerType,
        profile?.service_district,
        profile?.service_vehicle_type
      ),
      uid
    );
    const newCount = bookings.filter((b) => {
      const s = bookingStatus(b);
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

    const completed = bookings.filter((b) => bookingStatus(b) === "delivered").length;
    const activeJobs = bookings.filter((b) => {
      const s = bookingStatus(b);
      return (s === "accepted" || s === "delivering") && String(b.provider_id || "") === String(uid);
    }).length;

    let walletBalance = 0;
    let walletEarned = 0;
    let walletCommission = 0;
    let walletSource = "legacy";
    try {
      const wallet = await getWalletPayloadWithLedgerFallback(sb, uid, "service");
      walletBalance = Number(wallet.balance) || 0;
      walletEarned = Number(wallet.total_earned) || 0;
      walletCommission = Number(wallet.total_commission) || 0;
      walletSource = wallet.source || wallet.wallet_mode || "legacy";
      if (walletSource === "ervenow_ledger" && walletCommission > 0) {
        commissionPending = walletCommission;
      }
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
        wallet_commission_sar: Math.round(walletCommission * 100) / 100,
        wallet_source: walletSource,
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
    let q = serviceOrdersQuery(req.supabase).order("created_at", { ascending: false }).limit(200);
    q = applyServiceTypeFilter(q, types);
    const { data, error } = await q;
    if (error) throw error;

    const filtered = sortBookingsByPriority(
      filterBookingsForProvider(
        mapOrdersToBookings(data),
        user.id,
        providerType,
        profile?.service_district,
        profile?.service_vehicle_type
      ),
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
      .select("id, name, phone, service_type, service_district, service_vehicle_type, lat, lng")
      .eq("id", uid)
      .maybeSingle();
    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return fail(res, "نوع الخدمة غير مضبوط في حسابك", 400);

    const { data: booking, error: gErr } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);

    if (!providerMatchesBookingType(providerType, booking.service_type, booking.gas_mode)) {
      return fail(res, "هذا الطلب لا يطابق تخصصك", 403);
    }
    if (
      String(booking.service_type || "").toLowerCase() === "internal_delivery" &&
      !serviceUserMatchesVehicleCategory(profile, bookingVehicleCategory(booking))
    ) {
      return fail(res, "نوع المركبة المطلوبة لا يطابق مركبتك المسجّلة", 403);
    }
  const bookingLoc = booking.service_location || booking.location;
    if (!providerAreaMatches(providerType, profile?.service_district, booking.district, bookingLoc)) {
      return fail(res, providerType === "pickup_truck" ? "الطلب خارج مدينتك المسجّلة" : "الطلب خارج حيّك المسجّل", 403);
    }
    const st = bookingStatus(booking);
    if (st !== "new" && st !== "pending") return fail(res, "الطلب غير متاح للحجز", 400);
    if (booking.provider_id && String(booking.provider_id) !== String(uid)) {
      return fail(res, "تم حجز الطلب من مزود آخر", 409);
    }

    const now = new Date().toISOString();
    const provLat = Number(profile?.lat);
    const provLng = Number(profile?.lng);
    const reservePatch = applyProviderIdToPatch(
      {
        reserved_at: now,
        updated_at: now,
        last_location_at: now,
        ...(Number.isFinite(provLat) && Number.isFinite(provLng)
          ? { driver_lat: provLat, driver_lng: provLng }
          : {}),
        ...buildOrderStatusPatch(DELIVERY_STATUS.ACCEPTED),
      },
      uid
    );
    const { data: raw, error } = await updateOrdersResilient(sb, reservePatch, (q) =>
      q
        .eq("id", req.params.id)
        .is("provider_id", null)
        .in("delivery_status", ["new", "pending"])
    );

    if (error) return fail(res, error.message, 400);
    if (!raw) return fail(res, "تعذر حجز الطلب — ربما حجزه مزود آخر", 409);
    const data = orderToBookingView(raw);

    await sendReserveWelcomeWhatsApp(data, profile?.phone, profile?.name);

    if (booking.customer_phone) {
      try {
        const msg = buildCustomerMessageOrderAccepted(raw, profile?.phone);
        await sendWhatsApp({ to: booking.customer_phone, message: msg });
      } catch (waErr) {
        console.error("[services] reserve customer WA:", waErr && (waErr.message || waErr));
      }
    }

    broadcastOrderPatch(raw.id, orderPatchFromRow(raw));

    return ok(res, { booking: data, message: "تم حجز الطلب وإرسال تفاصيله عبر واتساب" });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/location", requireAuth, requireRole("service"), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(res, "إحداثيات غير صالحة", 400);

    const { data: booking, error: gErr } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);
    if (String(booking.provider_id || "") !== String(uid)) return fail(res, "غير مصرح", 403);

    const st = bookingStatus(booking);
    if (!["accepted", "delivering", "picked"].includes(st)) {
      return fail(res, "الطلب غير نشط للتتبع", 400);
    }

    const now = new Date().toISOString();
    const { data: raw, error } = await updateOrdersResilient(
      sb,
      { driver_lat: lat, driver_lng: lng, last_location_at: now, updated_at: now },
      { id: req.params.id }
    );
    if (error) return fail(res, error.message, 400);

    broadcastDriverUpdate(req.params.id, uid, { lat, lng, ts: Date.now() });

    return ok(res, { booking: orderToBookingView(raw), message: "تم تحديث الموقع" });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/complete", requireAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const role = String(req.appUser.role || "").toLowerCase();
    const { data: booking, error: gErr } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);

    const status = bookingStatus(booking);
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
      return ok(res, { booking: orderToBookingView(done.data), already_done: true });
    }

    if (done.finalized) {
      const view = orderToBookingView(done.data);
      await sendCustomerRateWhatsApp(view);
      return ok(res, {
        booking: view,
        message: "تمت المهمة — شكراً. يمكن للعميل تقييم الخدمة الآن.",
        finalized: true,
      });
    }

    const msg =
      actor === "provider"
        ? "تم تأكيد التنفيذ — بانتظار تأكيد العميل."
        : "تم تأكيد الاستلام — بانتظار مزود الخدمة.";
  const view = orderToBookingView(done.data);
    return ok(res, {
      booking: view,
      message: msg,
      finalized: false,
      awaiting_customer: !!done.data?.awaiting_customer,
      awaiting_provider: !!done.data?.awaiting_provider,
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings", requireAuth, denyUnlessCanPlaceOrders, async (req, res) => {
  try {
    const b = req.body || {};
    const service_type = String(b.service_type || "").trim().toLowerCase() || "service";
    const created = await createServiceOrder(req.supabase, req.appUser, {
      order_type: "service",
      service_type,
      service_name: String(b.service_name || "").trim() || labelByType(service_type),
      district: b.district,
      location: b.location,
      qty: b.qty,
      gas_mode: b.gas_mode,
      gas_liters: b.gas_liters,
      total_amount: b.total_amount,
      payment_status: b.payment_status,
      customer_phone: b.customer_phone || req.appUser.phone || "",
    });
    if (!created.ok) return fail(res, created.message, created.status || 400);
    ok(res, { booking: orderToBookingView(created.order) });
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

    const customerPhoneFromUser = req.appUser ? req.appUser.phone || "" : "";
    const inserted = [];
    for (const it of serviceItems) {
      const type = String(it.type || "").trim().toLowerCase();
      const data = it && typeof it.data === "object" && it.data ? it.data : {};
      const created = await createServiceOrder(sb, req.appUser || { id: null, phone: customerPhoneFromUser }, {
        order_type: type === "gas_delivery" ? "gas_delivery" : "service",
        service_type: type,
        service_name: String(it.title || labelByType(type)).trim(),
        district: data.district,
        location: data.location,
        qty: data.qty,
        gas_mode: data.gas_mode,
        gas_liters: data.gas_liters,
        total_amount: it.price || data.total_amount || 0,
        payment_status: data.payment_status || "unpaid",
        customer_phone: String(data.customer_phone || customerPhoneFromUser || "").trim(),
        data,
      });
      if (!created.ok) return fail(res, created.message, created.status || 400);
      inserted.push(orderToBookingView(created.order));
    }

    return ok(res, { bookings: inserted, skipped: items.length - serviceItems.length });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.patch("/bookings/:id/status", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const nextStatus = String(req.body?.status || req.body?.delivery_status || "").trim().toLowerCase();
    if (!nextStatus) return fail(res, "status required", 400);
    const allowed = new Set(["accepted", "delivering", "delivered", "cancelled"]);
    if (!allowed.has(nextStatus)) return fail(res, "invalid status", 400);

    if (nextStatus === "delivered" || nextStatus === "delivering") {
      const out = await patchUnifiedOrderStatus(req.supabase, req.params.id, nextStatus, req.appUser);
      if (out.error) return fail(res, out.error.message, 400);
      const view = orderToBookingView(out.data);
      if (nextStatus === "delivered") await sendCustomerRateWhatsApp(view);
      return ok(res, { booking: view });
    }

    const patch = {
      ...buildOrderStatusPatch(nextStatus),
    };
    if (req.appUser.role === "service") {
      Object.assign(patch, applyProviderIdToPatch({}, req.appUser.id));
    }

    const { data, error } = await updateOrdersResilient(req.supabase, patch, (q) =>
      q.eq("id", req.params.id).in("order_type", ["service", "gas_delivery"])
    );
    if (error) return fail(res, error.message, 400);

    return ok(res, { booking: orderToBookingView(data) });
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

    const { data: booking, error: gErr } = await fetchServiceOrderById(req.supabase, req.params.id);
    if (gErr || !booking) return fail(res, "Not found", 404);
    const phoneDigits = toStorageDigits(req.appUser.phone || "");
    const custPhone = toStorageDigits(booking.customer_phone || "");
    const ownsBooking =
      String(booking.customer_id || "") === String(req.appUser.id) ||
      (phoneDigits && custPhone && phoneDigits === custPhone);
    if (!ownsBooking) return fail(res, "Forbidden", 403);
    if (bookingStatus(booking) !== "delivered") {
      return fail(res, "booking is not delivered", 400);
    }

    const { data, error } = await req.supabase
      .from("orders")
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

    return ok(res, { booking: orderToBookingView(data) });
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
