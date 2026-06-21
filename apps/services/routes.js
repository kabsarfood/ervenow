const express = require("express");
const { requireAuth, optionalAuth } = require("../../shared/middleware/auth");
const { denyUnlessCanPlaceOrders } = require("../../shared/middleware/platformAccess");
const { requireRole, requireServiceProviderRole, requireServiceProviderOrAdmin } = require("../../shared/middleware/roles");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const {
  gasModeFromBody,
  computeGasTotal,
  gasServiceLabel,
  CENTRAL_LITERS,
  CENTRAL_PRICE_PER_LITER,
  GAS_CYLINDER_CUSTOMER_UNIT,
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
const { sendOrderAcceptedToCustomer, sendCustomerDeliveringNotice, sendDriverArrived } = require("../../shared/services/whatsappService");
const { notifyCustomer } = require("../../shared/services/notificationEvents");
const { notifyProvidersForBooking } = require("../../shared/services/serviceBookingNotify");
const { currentGasRadiusKm, providerCoords, providerWithinGasRadius } = require("../../shared/utils/gasDeliveryRadius");
const { usersQueryResilient, isUsersGeoColumnError } = require("../../shared/utils/usersGeoSelect");
const { broadcastDriverUpdate, broadcastOrderPatch, orderPatchFromRow } = require("../../shared/lib/trackingSocket");
const { getWalletPayloadWithLedgerFallback } = require("../../shared/utils/ledgerWallet");
const { resolvePortalRole, portalRoleForProvider } = require("../../shared/utils/resolvePortalRole");
const { filterOrdersForPortal } = require("../../shared/utils/orderPortalRouting");
const {
  bookingTypesForProvider,
  districtsMatch,
  providerAreaMatches,
  providerAreaLabel,
  panelTitleForType,
  labelForType,
  providerMatchesBookingType,
} = require("../../shared/utils/serviceProviderTypes");
const {
  isCarPolishingOrder,
  providerRejectedOrder,
  resolveCpStatus,
  cpStatusLabel,
  PROVIDER_REJECT_REASONS,
  PROVIDER_CANCEL_REASONS,
  CP_STATUS,
  mergeCarPolishingData,
  orderData,
} = require("../../shared/utils/carPolishingWorkflow");
const {
  rejectCarPolishingBooking,
  republishCarPolishingBooking,
  patchCarPolishingCpStatus,
  buildAcceptCarPolishingData,
} = require("../../shared/services/carPolishingOrderActions");
const {
  isServicePhaseOrder,
  mergeServicePhaseData,
  SP_STATUS,
  SERVICE_SUBTYPES,
} = require("../../shared/utils/servicePhaseWorkflow");
const {
  patchServicePhaseStatus,
  buildAcceptServicePhaseData,
} = require("../../shared/services/servicePhaseOrderActions");
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
const { deferServiceProviderDispatch, isPrepaidServiceType } = require("../../shared/utils/serviceOrderPaymentHold");

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
  "car_transport",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
  "gas_delivery",
  "car_polishing",
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

async function mergeProviderLocationFromBody(sb, uid, profile, body) {
  const bodyLat = Number(body?.lat);
  const bodyLng = Number(body?.lng);
  if (!Number.isFinite(bodyLat) || !Number.isFinite(bodyLng)) return profile || {};
  if (Math.abs(bodyLat) > 90 || Math.abs(bodyLng) > 180) return profile || {};
  const now = new Date().toISOString();
  let result = await sb
    .from("users")
    .update({ lat: bodyLat, lng: bodyLng, updated_at: now })
    .eq("id", uid)
    .select("id, name, phone, service_type, service_district, service_vehicle_type, lat, lng")
    .maybeSingle();
  if (result.error && isUsersGeoColumnError(result.error)) {
    return { ...(profile || {}), lat: bodyLat, lng: bodyLng };
  }
  if (result.error) return profile || {};
  return result.data || { ...(profile || {}), lat: bodyLat, lng: bodyLng };
}

function filterBookingsForProvider(rows, providerId, providerType, providerDistrict, _providerVehicleType, providerProfile) {
  const pid = String(providerId || "");
  const providerUser = providerProfile && typeof providerProfile === "object" ? providerProfile : {};
  return (rows || []).filter((b) => {
    const st = String(b.service_type || "").toLowerCase();
    if (st === "internal_delivery") return false;
    if (!providerMatchesBookingType(providerType, st, b.gas_mode)) return false;

    const status = bookingStatus(b);
    const bookedBy = b.provider_id ? String(b.provider_id) : "";
    const pay = String(b.payment_status || "").toLowerCase();
    const ds = String(b.status || b.delivery_status || "").toLowerCase();

    if (ds === "draft") return false;
    if (isPrepaidServiceType(st) && pay !== "paid" && bookedBy !== pid) return false;

    if (bookedBy && bookedBy !== pid) return false;
    if (bookedBy === pid) return true;
    if (status !== "new" && status !== "pending") return false;

    if (st === "car_polishing") {
      const data = b.data && typeof b.data === "object" ? b.data : {};
      if (providerRejectedOrder(data, pid)) return false;
    }

    if (st === "gas_delivery") {
      if (!providerCoords(providerUser)) return false;
      if (!providerWithinGasRadius(providerUser, b, currentGasRadiusKm(b))) return false;
      return true;
    }

    if (st === "car_transport" || st === "vehicle_transfer" || st === "pickup_truck") {
      return providerAreaMatchesCarBooking(providerType, providerDistrict, b);
    }

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
    car_transport: "نقل مركبات",
    internal_delivery: "توصيل داخلي",
    pickup_truck: "ونيت",
    furniture_move: "نقل أثاث",
    gas_delivery: "تبديل غاز",
    car_polishing: "تلميع المركبات",
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

async function persistGasActualLiters(sb, booking, actualLitersRaw) {
  const liters = Math.floor(Number(actualLitersRaw));
  if (!Number.isFinite(liters) || liters <= 0) {
    return { ok: false, message: "أدخل لترات فعلية صحيحة" };
  }
  const mode = String(booking.gas_mode || (booking.data && booking.data.gas_mode) || "").toLowerCase();
  if (mode !== "central_refill" && mode !== "bulk") {
    return { ok: true, skipped: true, booking };
  }
  const data = booking.data && typeof booking.data === "object" ? { ...booking.data } : {};
  data.actual_liters_delivered = liters;
  const now = new Date().toISOString();
  const { data: raw, error } = await updateOrdersResilient(
    sb,
    { data, updated_at: now },
    { id: booking.id }
  );
  if (error) return { ok: false, message: error.message || String(error) };
  return { ok: true, booking: raw || booking };
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
  return ok(res, { catalog: HOME_SERVICE_CATALOG, subtypes: SERVICE_SUBTYPES, currency: "SAR" });
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
  const { computePlatformCommission } = require("../../shared/utils/platformCommission");
  const cylinderOne = GAS_CYLINDER_CUSTOMER_UNIT;
  const cylinderCommission = computePlatformCommission(cylinderOne);
  return ok(res, {
    cylinder_one: cylinderOne,
    cylinder_two: cylinderOne * 2,
    cylinder_provider_net: Math.round((cylinderOne - cylinderCommission) * 100) / 100,
    cylinder_platform_fee: cylinderCommission,
    cylinder_customer_unit: cylinderOne,
    central_per_liter: CENTRAL_PRICE_PER_LITER,
    central_liters: CENTRAL_LITERS,
    commission_rate: require("../../shared/utils/platformCommission").PLATFORM_COMMISSION_RATE,
  });
});

router.get("/car-polishing/pricing", (_req, res) => {
  const {
    VEHICLE_TYPES,
    BASE_INTERIOR_PRICES,
    ADDON_ENGINE_WASH,
    ADDON_WHEELS,
    ADDON_EXTERIOR,
    VEHICLE_LABELS,
    VAT_RATE,
    computeCarPolishingBreakdown,
    computeCarPolishingFinancials,
  } = require("../../shared/utils/carPolishingPricing");
  const { computePlatformCommission, PLATFORM_COMMISSION_RATE } = require("../../shared/utils/platformCommission");
  const example = computeCarPolishingFinancials({
    vehicle_type: "sedan",
    addon_engine_wash: true,
    addon_wheels: true,
    addon_exterior: true,
  });
  return ok(res, {
    vehicle_types: VEHICLE_TYPES,
    vehicle_labels: VEHICLE_LABELS,
    base_interior_prices: BASE_INTERIOR_PRICES,
    addons: {
      engine_wash: ADDON_ENGINE_WASH,
      wheels: ADDON_WHEELS,
      exterior: ADDON_EXTERIOR,
    },
    vat_rate: VAT_RATE,
    example_total: example.subtotal_ex_vat,
    example_breakdown: example,
    commission_rate: PLATFORM_COMMISSION_RATE,
    example_commission: computePlatformCommission(example.subtotal_ex_vat),
    example_vat: example.vat_amount,
    example_total_with_vat: example.total_with_vat,
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
    const providersSelect =
      "id, name, phone, service_type, service_district, service_rating_avg, service_rating_count, lat, lng";
    const { data, error } = await usersQueryResilient(sb, providersSelect, (q) => {
      let query = q.eq("role", "service");
      if (serviceType) {
        const types = bookingTypesForProvider(serviceType);
        if (types.length === 1) query = query.eq("service_type", types[0]);
      }
      return query;
    });
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

router.get("/me/dashboard", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    let profile = null;
    const profileSelectFull =
      "id, name, phone, service_type, service_district, service_rating_avg, service_rating_count, service_vehicle_type, service_plate_number, service_vehicle_model, lat, lng";
    const profileSelectBase =
      "id, name, phone, service_type, service_district, service_rating_avg, service_rating_count, lat, lng";
    let firstProfile = await usersQueryResilient(sb, profileSelectFull, (q) => q.eq("id", uid), "maybeSingle");
    if (firstProfile.error) {
      const msg = String(firstProfile.error.message || "");
      if (/service_vehicle_type|service_plate_number|service_vehicle_model/i.test(msg)) {
        firstProfile = await usersQueryResilient(sb, profileSelectBase, (q) => q.eq("id", uid), "maybeSingle");
        if (firstProfile.error) return fail(res, firstProfile.error.message, 400);
        profile = firstProfile.data;
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
        profile?.service_vehicle_type,
        profile
      ),
      uid
    );
    const portalRole = portalRoleForProvider(req.appUser, profile);
    const portalBookings = filterOrdersForPortal(bookings, portalRole);

    const newCount = portalBookings.filter((b) => {
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

    const completed = portalBookings.filter((b) => bookingStatus(b) === "delivered").length;
    const activeJobs = portalBookings.filter((b) => {
      const s = bookingStatus(b);
      return (s === "accepted" || s === "delivering") && String(b.provider_id || "") === String(uid);
    }).length;

    let walletBalance = 0;
    let walletEarned = 0;
    let walletEarnedToday = 0;
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
      try {
        const { listLedgerWalletTransactions } = require("../../shared/utils/ledgerWallet");
        const txs = await listLedgerWalletTransactions(sb, uid, "service", 200);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        walletEarnedToday = (txs || [])
          .filter((t) => {
            if (!t || !t.created_at || new Date(t.created_at) < todayStart) return false;
            return String(t.direction || "").toLowerCase() === "credit";
          })
          .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
      } catch (_todayErr) {
        walletEarnedToday = 0;
      }
    } catch (_) {
      /* optional */
    }

    return ok(res, {
      panel_title: panelTitleForType(providerType),
      service_label: labelForType(providerType),
      profile: profile || {},
      bookings: portalBookings,
      portal_type: portalRole,
      stats: {
        new_orders: newCount,
        completed_jobs: completed,
        active_jobs: activeJobs,
        commission_pending_sar: Math.round(commissionPending * 100) / 100,
        wallet_balance_sar: Math.round(walletBalance * 100) / 100,
        wallet_earned_sar: Math.round(walletEarned * 100) / 100,
        wallet_earned_today_sar: Math.round(walletEarnedToday * 100) / 100,
        wallet_commission_sar: Math.round(walletCommission * 100) / 100,
        wallet_source: walletSource,
        rating_avg: Number(profile?.service_rating_avg) || 0,
        rating_count: Number(profile?.service_rating_count) || 0,
        location_ready: !!providerCoords(profile),
      },
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/me/schedule", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const dash = await (async () => {
      const { data: profile } = await sb
        .from("users")
        .select("id, service_type, service_district, service_vehicle_type")
        .eq("id", uid)
        .maybeSingle();
      const providerType = String(profile?.service_type || "").trim().toLowerCase();
      const types = bookingTypesForProvider(providerType);
      let bookingsQ = serviceOrdersQuery(sb).order("scheduled_at", { ascending: true, nullsFirst: false }).limit(200);
      bookingsQ = applyServiceTypeFilter(bookingsQ, types);
      const { data: rawBookings, error: bErr } = await bookingsQ;
      if (bErr) throw new Error(bErr.message);
      const bookings = sortBookingsByPriority(
        filterBookingsForProvider(
          mapOrdersToBookings(rawBookings),
          uid,
          providerType,
          profile?.service_district,
          profile?.service_vehicle_type,
          profile
        ),
        uid
      );
      const portalRole = portalRoleForProvider(req.appUser, profile);
      return filterOrdersForPortal(bookings, portalRole);
    })();
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const withSchedule = (dash || []).filter((b) => b.scheduled_at);
    const today = withSchedule.filter((b) => {
      const d = new Date(b.scheduled_at);
      return d >= todayStart && d < todayEnd;
    });
    const week = withSchedule.filter((b) => {
      const d = new Date(b.scheduled_at);
      return d >= todayStart && d < weekEnd;
    });
    const mine = (dash || []).filter((b) => String(b.provider_id || "") === String(uid));
    return ok(res, { today, week, all: withSchedule, my_bookings: mine });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/me/fleet", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const { data: profile, error: pErr } = await usersQueryResilient(
      sb,
      "id, name, phone, service_type, service_vehicle_type, service_plate_number, service_vehicle_model, service_rating_avg, service_rating_count, lat, lng",
      (q) => q.eq("id", uid),
      "maybeSingle"
    );
    if (pErr) return fail(res, pErr.message, 400);
    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    const types = bookingTypesForProvider(providerType);
    let bookingsQ = serviceOrdersQuery(sb).order("updated_at", { ascending: false }).limit(120);
    bookingsQ = applyServiceTypeFilter(bookingsQ, types);
    const { data: rawBookings } = await bookingsQ;
    const portalBookings = filterOrdersForPortal(
      sortBookingsByPriority(
        filterBookingsForProvider(
          mapOrdersToBookings(rawBookings || []),
          uid,
          providerType,
          profile?.service_district,
          profile?.service_vehicle_type,
          profile
        ),
        uid
      ),
      portalRoleForProvider(req.appUser, profile)
    );
    const active = portalBookings.filter((b) => {
      const st = bookingStatus(b);
      return String(b.provider_id || "") === String(uid) && (st === "accepted" || st === "delivering");
    });
    const vehicle = {
      type: profile?.service_vehicle_type || null,
      plate: profile?.service_plate_number || null,
      model: profile?.service_vehicle_model || null,
      status: active.length ? "busy" : "available",
      driver_name: profile?.name || null,
      driver_phone: profile?.phone || null,
    };
    return ok(res, {
      vehicles: vehicle.type || vehicle.plate ? [vehicle] : [],
      activity: active,
      profile: profile || {},
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/me/pricing", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const { data: profile } = await sb
      .from("users")
      .select("service_type")
      .eq("id", uid)
      .maybeSingle();
    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    const { computeUnifiedDeliveryFee } = require("../delivery/unifiedDeliveryPricing");
    const {
      CAR_TRANSPORT_EXTERNAL_RATE,
      CAR_TRANSPORT_INTERNATIONAL_RATE,
      priceCarTransportInternal,
    } = require("../delivery/unifiedDeliveryPricing");
    const gasPricing = {
      cylinder_one: GAS_CYLINDER_CUSTOMER_UNIT,
      cylinder_two: GAS_CYLINDER_CUSTOMER_UNIT * 2,
      central_per_liter: CENTRAL_PRICE_PER_LITER,
    };
    const transportSamples = [
      { label: "نقل داخلي (10 كم)", fee: priceCarTransportInternal(10, "running") },
      { label: "نقل خارجي (50 كم)", fee: computeUnifiedDeliveryFee("car_transport", { transfer_mode: "external", distance_km: 50 }).delivery_fee },
    ].filter((r) => Number.isFinite(Number(r.fee)));
    const gasSamples = [
      { label: "أسطوانة غاز", fee: computeUnifiedDeliveryFee("gas_delivery", { mode: "cylinder", cylinders: 1 }).delivery_fee },
    ].filter((r) => Number.isFinite(Number(r.fee)));
    const { isTransportPortalType } = require("../../shared/utils/resolvePortalRole");
    const isTransport = isTransportPortalType(providerType);
    const isGasService =
      providerType === "gas_cylinder_swap" || providerType === "gas_central_refill" || providerType === "gas_delivery";
    return ok(res, {
      provider_type: providerType,
      gas: isGasService ? gasPricing : undefined,
      transport_rates: isTransport
        ? {
            external_per_km: CAR_TRANSPORT_EXTERNAL_RATE,
            international_per_km: CAR_TRANSPORT_INTERNATIONAL_RATE,
          }
        : undefined,
      samples: isGasService ? gasSamples : isTransport ? transportSamples : gasSamples.concat(transportSamples),
      note: "الأسعار المرجعية من محرك التسعير الموحّد — التعديل الإداري لاحقاً",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/bookings", requireAuth, async (req, res) => {
  try {
    const user = req.appUser;
    if (user.role !== "service") return res.status(403).json({ ok: false });

    const { data: profile, error: pErr } = await usersQueryResilient(
      req.supabase,
      "service_type, service_district, service_vehicle_type, lat, lng",
      (q) => q.eq("id", user.id),
      "maybeSingle"
    );
    if (pErr) return fail(res, pErr.message, 400);

    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return ok(res, { bookings: [] });

    const types = bookingTypesForProvider(providerType);
    let q = serviceOrdersQuery(req.supabase).order("created_at", { ascending: false }).limit(200);
    q = applyServiceTypeFilter(q, types);
    const { data, error } = await q;
    if (error) throw error;

    const portalRole = portalRoleForProvider(user, profile);
    const filtered = filterOrdersForPortal(
      sortBookingsByPriority(
        filterBookingsForProvider(
          mapOrdersToBookings(data),
          user.id,
          providerType,
          profile?.service_district,
          profile?.service_vehicle_type,
          profile
        ),
        user.id
      ),
      portalRole
    );
    return res.json({ ok: true, bookings: filtered, portal_type: portalRole });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

router.post("/bookings/:id/reserve", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    let { data: profile } = await usersQueryResilient(
      sb,
      "id, name, phone, service_type, service_district, service_vehicle_type, lat, lng",
      (q) => q.eq("id", uid),
      "maybeSingle"
    );
    const providerType = String(profile?.service_type || "").trim().toLowerCase();
    if (!providerType) return fail(res, "نوع الخدمة غير مضبوط في حسابك", 400);

    profile = await mergeProviderLocationFromBody(sb, uid, profile, req.body || {});

    const { data: booking, error: gErr } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);

    if (String(booking.service_type || "").toLowerCase() === "internal_delivery") {
      return fail(res, "طلبات التوصيل الداخلي للمناديب فقط — استخدم تطبيق المندوب", 403);
    }
    if (!providerCoords(profile)) {
      return fail(res, "حدّد موقعك من قائمة البوابة (📍 تحديد الموقع) لاستقبال الطلبات", 403);
    }
    if (!providerMatchesBookingType(providerType, booking.service_type, booking.gas_mode)) {
      return fail(res, "هذا الطلب لا يطابق تخصصك", 403);
    }
    if (String(booking.service_type || "").toLowerCase() === "gas_delivery") {
      if (!providerWithinGasRadius(profile, booking, currentGasRadiusKm(booking))) {
        return fail(
          res,
          `الطلب خارج نطاق التوصيل الحالي (${currentGasRadiusKm(booking)} كم من موقع العميل)`,
          403
        );
      }
    }
    const bookingLoc = booking.service_location || booking.location;
    const bookingSt = String(booking.service_type || "").toLowerCase();
    if (
      bookingSt !== "gas_delivery" &&
      !providerAreaMatches(providerType, profile?.service_district, booking.district, bookingLoc)
    ) {
      return fail(res, providerType === "pickup_truck" ? "الطلب خارج مدينتك المسجّلة" : "الطلب خارج حيّك المسجّل", 403);
    }
    const st = bookingStatus(booking);
    if (st !== "new" && st !== "pending") return fail(res, "الطلب غير متاح للحجز", 400);
    if (booking.provider_id && String(booking.provider_id) !== String(uid)) {
      return fail(res, "تم حجز الطلب من مزود آخر", 409);
    }
    if (isCarPolishingOrder(booking)) {
      const bData = booking.data && typeof booking.data === "object" ? booking.data : {};
      if (providerRejectedOrder(bData, uid)) {
        return fail(res, "رفضت هذا الطلب مسبقاً", 403);
      }
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
        ...(isCarPolishingOrder(booking) ? { data: buildAcceptCarPolishingData(booking) } : {}),
        ...(isServicePhaseOrder(booking) ? { data: buildAcceptServicePhaseData(booking) } : {}),
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
        await sendOrderAcceptedToCustomer(raw, profile?.phone);
      } catch (waErr) {
        console.error("[services] reserve customer WA:", waErr && (waErr.message || waErr));
      }
    }
    if (raw.customer_id) {
      try {
        await notifyCustomer(
          sb,
          raw.customer_id,
          "customer.order.accepted",
          "تم قبول طلبك",
          `تم قبول طلب ${raw.service_name || "الخدمة"} رقم ${raw.order_number || raw.id} — المزود في الطريق قريباً.`,
          raw
        );
      } catch (notifyErr) {
        console.error("[services] reserve customer in-app:", notifyErr && (notifyErr.message || notifyErr));
      }
    }

    broadcastOrderPatch(raw.id, orderPatchFromRow(raw));

    return ok(res, {
      booking: data,
      message: isCarPolishingOrder(raw) ? "تم قبول الطلب" : "تم حجز الطلب وإرسال تفاصيله عبر واتساب",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/reject", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const { data: booking, error: gErr, raw } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);
    const orderRow = raw || booking;
    const out = await rejectCarPolishingBooking(sb, orderRow, uid, req.body || {});
    if (!out.ok) return fail(res, out.message, out.status || 400);
    try {
      await notifyProvidersForBooking(sb, out.order);
    } catch (notifyErr) {
      console.error("[services] reject republish notify:", notifyErr && (notifyErr.message || notifyErr));
    }
    return ok(res, { booking: orderToBookingView(out.order), message: out.message, reasons: PROVIDER_REJECT_REASONS });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/bookings/:id/cancel-task", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const uid = req.appUser.id;
    const { data: booking, error: gErr, raw } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !booking) return fail(res, "الطلب غير موجود", 404);
    const orderRow = raw || booking;
    const out = await republishCarPolishingBooking(sb, orderRow, uid, req.body || {});
    if (!out.ok) return fail(res, out.message, out.status || 400);
    return ok(res, {
      booking: orderToBookingView(out.order),
      message: out.message,
      reasons: PROVIDER_CANCEL_REASONS,
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/car-polishing/config", (_req, res) => {
  return ok(res, {
    reject_reasons: PROVIDER_REJECT_REASONS,
    cancel_reasons: PROVIDER_CANCEL_REASONS,
    max_photos: 10,
    cp_statuses: CP_STATUS,
  });
});

router.post("/bookings/:id/location", requireAuth, requireServiceProviderRole(), async (req, res) => {
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

    let workingBooking = booking;
    const actualLiters = req.body?.actual_liters ?? req.body?.actual_liters_delivered;
    if (actualLiters != null && String(actualLiters).trim() !== "") {
      const persisted = await persistGasActualLiters(sb, workingBooking, actualLiters);
      if (!persisted.ok) return fail(res, persisted.message || "تعذر حفظ اللترات", 400);
      if (persisted.booking) workingBooking = persisted.booking;
    } else if (
      isProvider &&
      (step === "legacy" || actor === "legacy") &&
      ["central_refill", "bulk"].includes(
        String(workingBooking.gas_mode || (workingBooking.data && workingBooking.data.gas_mode) || "").toLowerCase()
      )
    ) {
      return fail(res, "أدخل اللترات الفعلية المُسلَّمة قبل إنهاء المهمة", 400);
    }

    const done = await completeServiceBooking(sb, req.params.id, providerId, { actor });
    if (done.error) return fail(res, done.error.message || "فشل الإتمام", 400);
    if (done.already_done) {
      return ok(res, { booking: orderToBookingView(done.data), already_done: true });
    }

    if (done.finalized) {
      let finalRow = done.data;
      if (isCarPolishingOrder(done.data)) {
        const merged = mergeCarPolishingData(orderData(done.data), {
          cp_status: CP_STATUS.COMPLETED,
          cp_phase: null,
        });
        const cpUpd = await updateOrdersResilient(sb, { data: merged, updated_at: new Date().toISOString() }, { id: req.params.id });
        if (cpUpd.data) finalRow = cpUpd.data;
      }
      if (isServicePhaseOrder(done.data)) {
        const merged = mergeServicePhaseData(orderData(done.data), {
          sp_status: SP_STATUS.COMPLETED,
          sp_phase: null,
        });
        const spUpd = await updateOrdersResilient(sb, { data: merged, updated_at: new Date().toISOString() }, { id: req.params.id });
        if (spUpd.data) finalRow = spUpd.data;
      }
      const view = orderToBookingView(finalRow);
      await sendCustomerRateWhatsApp(view);
      if (done.data.customer_id) {
        try {
          await notifyCustomer(
            sb,
            finalRow.customer_id,
            "customer.order.delivered",
            "اكتملت الخدمة",
            `تم إنجاز طلبك رقم ${finalRow.order_number || finalRow.id}.`,
            finalRow
          );
        } catch (notifyErr) {
          console.error("[services] complete customer in-app:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
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

router.patch("/bookings/:id/status", requireAuth, requireServiceProviderOrAdmin(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    const cpStatusRaw = String(req.body?.cp_status || "").trim().toLowerCase();
    const spStatusRaw = String(req.body?.sp_status || "").trim().toLowerCase();
    let nextStatus = String(req.body?.status || req.body?.delivery_status || "").trim().toLowerCase();
    if (!nextStatus && !cpStatusRaw && !spStatusRaw) return fail(res, "status required", 400);

    const { data: bookingView, raw: bookingRaw, error: gErr } = await fetchServiceOrderById(sb, req.params.id);
    if (gErr || !bookingView) return fail(res, "Not found", 404);
    const orderRow = bookingRaw || bookingView;

    if (isServicePhaseOrder(orderRow) && spStatusRaw) {
      const providerId = req.appUser.id;
      const out = await patchServicePhaseStatus(sb, orderRow, providerId, spStatusRaw);
      if (!out.ok) return fail(res, out.message, out.status || 400);
      const updated = out.order;
      if (updated.customer_id) {
        try {
          if (spStatusRaw === SP_STATUS.ON_THE_WAY) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.driver.en_route",
              "المزود في الطريق",
              `مزود الخدمة في الطريق لتنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
              updated
            );
          } else if (spStatusRaw === SP_STATUS.IN_PROGRESS) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.order.in_progress",
              "بدأ التنفيذ",
              `بدأ مزود الخدمة تنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
              updated
            );
          } else if (spStatusRaw === SP_STATUS.COMPLETED) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.order.delivered",
              "اكتملت الخدمة",
              `تم إنجاز طلبك رقم ${updated.order_number || updated.id}.`,
              updated
            );
          }
        } catch (notifyErr) {
          console.error("[services] sp status customer in-app:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
      broadcastOrderPatch(updated.id, orderPatchFromRow(updated));
      return ok(res, { booking: orderToBookingView(updated) });
    }

    if (isServicePhaseOrder(orderRow) && nextStatus === "delivering") {
      const out = await patchServicePhaseStatus(sb, orderRow, req.appUser.id, SP_STATUS.ON_THE_WAY);
      if (!out.ok) return fail(res, out.message, out.status || 400);
      const updated = out.order;
      if (updated.customer_id) {
        try {
          await notifyCustomer(
            sb,
            updated.customer_id,
            "customer.driver.en_route",
            "المزود في الطريق",
            `مزود الخدمة في الطريق لتنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
            updated
          );
        } catch (notifyErr) {
          console.error("[services] sp delivering notify:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
      broadcastOrderPatch(updated.id, orderPatchFromRow(updated));
      return ok(res, { booking: orderToBookingView(updated) });
    }

    if (isCarPolishingOrder(orderRow) && cpStatusRaw) {
      const providerId = req.appUser.id;
      const out = await patchCarPolishingCpStatus(sb, orderRow, providerId, cpStatusRaw);
      if (!out.ok) return fail(res, out.message, out.status || 400);
      const updated = out.order;
      if (updated.customer_id) {
        try {
          if (cpStatusRaw === CP_STATUS.ON_THE_WAY) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.driver.en_route",
              "المزود في الطريق",
              `مزود الخدمة في الطريق لتنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
              updated
            );
          } else if (cpStatusRaw === CP_STATUS.IN_PROGRESS) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.order.in_progress",
              "بدأ التنفيذ",
              `بدأ مزود الخدمة تنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
              updated
            );
          } else if (cpStatusRaw === CP_STATUS.COMPLETED) {
            await notifyCustomer(
              sb,
              updated.customer_id,
              "customer.order.delivered",
              "اكتملت الخدمة",
              `تم إنجاز طلب تلميع المركبات رقم ${updated.order_number || updated.id}.`,
              updated
            );
          }
        } catch (notifyErr) {
          console.error("[services] cp status customer in-app:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
      broadcastOrderPatch(updated.id, orderPatchFromRow(updated));
      return ok(res, { booking: orderToBookingView(updated) });
    }

    if (isCarPolishingOrder(orderRow) && nextStatus === "delivering") {
      const out = await patchCarPolishingCpStatus(sb, orderRow, req.appUser.id, CP_STATUS.ON_THE_WAY);
      if (!out.ok) return fail(res, out.message, out.status || 400);
      const updated = out.order;
      if (updated.customer_id) {
        try {
          await notifyCustomer(
            sb,
            updated.customer_id,
            "customer.driver.en_route",
            "المزود في الطريق",
            `مزود الخدمة في الطريق لتنفيذ طلبك رقم ${updated.order_number || updated.id}.`,
            updated
          );
        } catch (notifyErr) {
          console.error("[services] cp delivering notify:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
      broadcastOrderPatch(updated.id, orderPatchFromRow(updated));
      return ok(res, { booking: orderToBookingView(updated) });
    }

    if (!nextStatus && !cpStatusRaw && !spStatusRaw) return fail(res, "status required", 400);
    const allowed = new Set(["accepted", "delivering", "delivered", "cancelled"]);
    if (!allowed.has(nextStatus)) return fail(res, "invalid status", 400);

    if (nextStatus === "delivered" || nextStatus === "delivering") {
      if (isServicePhaseOrder(orderRow)) {
        return fail(res, "استخدم sp_status للانتقال بين مراحل الخدمة", 400);
      }
      const out = await patchUnifiedOrderStatus(req.supabase, req.params.id, nextStatus, req.appUser);
      if (out.error) return fail(res, out.error.message, 400);
      const view = orderToBookingView(out.data);
      if (view.customer_phone) {
        try {
          if (nextStatus === "delivering") await sendCustomerDeliveringNotice(out.data);
          else if (nextStatus === "delivered") await sendDriverArrived(out.data);
        } catch (waErr) {
          console.error("[services] status customer WA:", waErr && (waErr.message || waErr));
        }
      }
      if (out.data && out.data.customer_id) {
        try {
          if (nextStatus === "delivering") {
            await notifyCustomer(
              req.supabase,
              out.data.customer_id,
              "customer.driver.en_route",
              "المزود في الطريق",
              `مزود الخدمة في الطريق لتنفيذ طلبك رقم ${out.data.order_number || out.data.id}.`,
              out.data
            );
          } else if (nextStatus === "delivered") {
            await notifyCustomer(
              req.supabase,
              out.data.customer_id,
              "customer.order.delivered",
              "تم الانتهاء من الخدمة",
              `تم إنجاز طلبك رقم ${out.data.order_number || out.data.id}.`,
              out.data
            );
          }
        } catch (notifyErr) {
          console.error("[services] status customer in-app:", notifyErr && (notifyErr.message || notifyErr));
        }
      }
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

router.get("/me/checkout-payment-methods", requireAuth, requireServiceProviderRole(), async (req, res) => {
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

router.patch("/me/location", requireAuth, requireServiceProviderRole(), async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const uid = req.appUser.id;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return fail(res, "إحداثيات غير صالحة", 400);
    }
    const now = new Date().toISOString();
    let result = await sb
      .from("users")
      .update({ lat, lng, updated_at: now })
      .eq("id", uid)
      .select("id, name, phone, service_type, service_district, lat, lng")
      .maybeSingle();
    if (result.error && isUsersGeoColumnError(result.error)) {
      return fail(res, "موقع المزود غير مدعوم في قاعدة البيانات بعد", 503);
    }
    if (result.error) return fail(res, result.error.message, 400);
    return ok(res, {
      profile: result.data || {},
      lat,
      lng,
      message: "تم تحديث موقعك — الطلبات تُطابَق حسب موقعك وموقع العميل",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.patch("/me/checkout-payment-methods", requireAuth, requireServiceProviderRole(), async (req, res) => {
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
