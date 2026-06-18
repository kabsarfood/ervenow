const { sendWhatsApp } = require("../utils/whatsapp");
const { roughDistanceKm } = require("../utils/geo");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { notifyGasDeliveryProviders } = require("./gasDeliveryNotify");
const { catalogEntry, serviceDisplayName } = require("../utils/homeServicePricing");
const { providerAreaMatches, providerMatchesBookingType } = require("../utils/serviceProviderTypes");
const { notifyProvidersInAppByPhones } = require("./notificationEvents");
async function getServiceProviderPhones(sb, serviceType) {
  let q = sb.from("users").select("phone").eq("role", "service");
  if (serviceType) q = q.eq("service_type", serviceType);
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return data
    .map((u) => String(u.phone || "").trim())
    .filter((p) => p.length >= 10);
}

function publicBase() {
  return String(process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com").replace(/\/$/, "");
}

function parseCoordsFromLocation(loc) {
  const parts = String(loc || "")
    .split(",")
    .map((x) => Number(x.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function mapsUrl(coords, fallbackText) {
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    return `https://www.google.com/maps?q=${coords.lat},${coords.lng}`;
  }
  const t = String(fallbackText || "").trim();
  return t || "—";
}

function paymentLabel(booking) {
  if (booking.payment_status === "paid") return "مدفوع ✅";
  const entry = catalogEntry(booking.service_type);
  if (entry && entry.payAfterDiagnosis) return "الدفع بعد تقييم العطل 💵";
  if (entry && entry.agreement) return "حسب الاتفاق مع المزود 🤝";
  return "الدفع عند إتمام الخدمة 💵";
}

function priceLine(booking) {
  const entry = catalogEntry(booking.service_type);
  const amt = Number(booking.total_amount || 0);
  if (entry && entry.fixedPrice) return `السعر الثابت: ${amt.toFixed(2)} ريال`;
  if (entry && entry.inspectionOnly && amt > 0) {
    return (
      `رسوم المعاينة والتقييم: ${amt.toFixed(2)} ريال\n` +
      `الإصلاح يُحسب لاحقاً عند رغبة العميل في التنفيذ.`
    );
  }
  if (entry && entry.agreement) return "السعر: حسب الاتفاق";
  return `السعر: ${amt.toFixed(2)} ريال`;
}

function buildHomeProviderMessage(booking, rankHint) {
  const base = publicBase();
  const idEnc = encodeURIComponent(String(booking.id));
  const completeUrl = `${base}/api/driver/complete-order/${idEnc}`;
  const coords = parseCoordsFromLocation(booking.location);
  const maps = mapsUrl(coords, booking.location || booking.district);
  const pct = commissionPercentLabel(booking.service_type);
  const orderNo = booking.service_order_number || booking.id;
  const svcName = booking.service_name || serviceDisplayName(booking.service_type);
  const rank =
    rankHint === 0
      ? "أنت من أقرب المزودين لهذا الطلب."
      : rankHint > 0
        ? `إشعار متدرّج — ترتيب القرب: ${rankHint + 1}`
        : "";

  return (
    `مرحباً من منصة ERVENOW 👋\n` +
    `وصلك طلب خدمة منزلية جديد:\n\n` +
    (rank ? `${rank}\n\n` : "") +
    `📋 رقم الطلب: ${orderNo}\n` +
    `🔧 نوع الخدمة: ${svcName}\n` +
    `🏘 الحي: ${booking.district || "—"}\n` +
    `📍 موقع العميل:\n${maps}\n` +
    `📞 جوال العميل: ${booking.customer_phone || "—"}\n` +
    `${priceLine(booking)}\n` +
    `💳 حالة الدفع: ${paymentLabel(booking)}\n` +
    `عمولة المنصة (${pct}): ${Number(booking.platform_commission || 0).toFixed(2)} ريال\n\n` +
    `لقبول الطلب من لوحة المزود:\n${base}/services-provider.html\n\n` +
    `⬇️ بعد إتمام المهمة (لتسجيل العمولة):\n${completeUrl}\n\n` +
    `يُرجى التواصل مع العميل وقبول الطلب في أقرب وقت.`
  );
}

async function fetchServiceProviders(sb, serviceType, bookingDistrict, bookingGasMode, bookingLocation) {
  let q = sb
    .from("users")
    .select("id, phone, lat, lng, service_type, service_district, name")
    .eq("role", "service");
  const { data, error } = await q;
  if (error || !Array.isArray(data)) {
    const phones = await getServiceProviderPhones(sb, serviceType);
    return phones.map((phone) => ({ phone, dist: Infinity }));
  }
  return data
    .map((u) => ({
      id: u.id,
      phone: String(u.phone || "").trim(),
      name: String(u.name || "").trim(),
      service_type: String(u.service_type || "").trim().toLowerCase(),
      service_district: String(u.service_district || "").trim(),
      lat: u.lat != null ? Number(u.lat) : NaN,
      lng: u.lng != null ? Number(u.lng) : NaN,
      dist: Infinity,
    }))
    .filter((p) => p.phone.length >= 10)
    .filter((p) => providerMatchesBookingType(p.service_type, serviceType, bookingGasMode))
    .filter((p) => providerAreaMatches(p.service_type, p.service_district, bookingDistrict, bookingLocation));
}

function sortProvidersByDistance(providers, customerCoords) {
  if (!customerCoords || !providers.length) return providers;
  const withDist = providers.map((p) => {
    let dist = Infinity;
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      const km = roughDistanceKm(customerCoords.lat, customerCoords.lng, p.lat, p.lng);
      if (Number.isFinite(km)) dist = km;
    }
    return { ...p, dist };
  });
  withDist.sort((a, b) => a.dist - b.dist);
  return withDist;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * إشعار مقدّمي الخدمة — الطلبات تظهر في لوحة المزود.
 * واتساب الترحيب يُرسل عند «حجز الطلب» من لوحة المزود (انظر serviceProviderReserve).
 */
async function notifyHomeServiceProvidersCascade(sb, booking) {
  if (!sb || !booking) return { sent: 0, providers: 0 };
  const serviceType = String(booking.service_type || "").trim().toLowerCase();
  if (serviceType === "gas_delivery") {
    return notifyGasDeliveryProviders(sb, booking);
  }
  const district = String(booking.district || "").trim();
  const gasMode = booking.gas_mode || null;
  let providers = await fetchServiceProviders(sb, serviceType, district, gasMode, booking.location);
  if (!providers.length) {
    const phones = await getServiceProviderPhones(sb, serviceType);
    return { sent: 0, providers: phones.length };
  }

  const coords = parseCoordsFromLocation(booking.location);
  providers = sortProvidersByDistance(providers, coords);

  const phones = providers.map((p) => p.phone).filter(Boolean);
  try {
    await notifyProvidersInAppByPhones(sb, booking, phones);
  } catch (e) {
    console.error("[homeServiceNotify] in-app:", e && (e.message || e));
  }

  const waOnCreate = String(process.env.ERVENOW_SERVICE_WA_ON_CREATE || "").trim() === "1";
  if (!waOnCreate) {
    return { sent: 0, providers: providers.length, dashboard_only: true };
  }

  const staggerMs = Math.max(2000, Number(process.env.ERVENOW_SERVICE_WA_STAGGER_MS) || 4500);
  let sent = 0;
  for (let i = 0; i < providers.length; i++) {
    const message = buildHomeProviderMessage(booking, i);
    try {
      await sendWhatsApp({ to: providers[i].phone, message });
      sent += 1;
    } catch (e) {
      console.error("[homeServiceNotify] WA:", e && (e.message || e));
    }
    if (i < providers.length - 1) await sleep(staggerMs);
  }
  return { sent, providers: providers.length };
}

module.exports = {
  buildHomeProviderMessage,
  notifyHomeServiceProvidersCascade,
};
