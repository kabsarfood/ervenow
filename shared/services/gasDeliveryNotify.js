const { sendWhatsApp } = require("../utils/whatsapp");
const { googleMapsUrl } = require("../utils/gasDeliveryPricing");
const { providerMatchesBookingType } = require("../utils/serviceProviderTypes");
const { roughDistanceKm } = require("../utils/geo");
const {
  GAS_RADIUS_INITIAL_KM,
  bookingCustomerCoords,
  currentGasRadiusKm,
  notifiedGasPhones,
  providerWithinGasRadius,
} = require("../utils/gasDeliveryRadius");
const { notifyProvidersInAppByPhones } = require("./notificationEvents");

function publicBase() {
  return String(process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com").replace(/\/$/, "");
}

function gasQuantityLine(booking) {
  const mode = String(booking.gas_mode || "").toLowerCase();
  if (mode === "central_refill" || mode === "bulk") {
    const L = booking.gas_liters || booking.qty;
    return `${L} لتر`;
  }
  return `${booking.qty || booking.service_qty || 1} أسطوانة`;
}

function gasTypeLabel(booking) {
  const mode = String(booking.gas_mode || "").toLowerCase();
  if (mode === "central_refill" || mode === "bulk") return "تعبئة غاز مركزي";
  return "تبديل أسطوانة غاز";
}

function paymentLabel(booking) {
  if (booking.payment_status === "paid") return "مدفوع";
  return "الدفع عند التوصيل";
}

function buildGasProviderMessage(booking, provider, rankHint) {
  const base = publicBase();
  const idEnc = encodeURIComponent(String(booking.id));
  const completeUrl = `${base}/api/driver/complete-order/${idEnc}`;
  const orderNo = booking.service_order_number || booking.order_number || booking.id;
  const customer = bookingCustomerCoords(booking);
  const maps =
    (customer && googleMapsUrl(customer.lat, customer.lng)) ||
    booking._maps_url ||
    booking.location ||
    booking.service_location ||
    "—";
  const dist =
    customer && provider && Number.isFinite(provider.dist)
      ? `\n📏 المسافة التقريبية: ${provider.dist.toFixed(1)} كم\n`
      : "";
  const rank =
    rankHint === 0
      ? "أنت من أقرب مزودي الغاز لهذا الطلب."
      : rankHint > 0
        ? `إشعار متدرّج — ترتيب القرب: ${rankHint + 1}`
        : "";

  return (
    `🚚 ERVENOW\n\n` +
    `طلب غاز جديد:\n\n` +
    (rank ? `${rank}\n\n` : "") +
    `📦 رقم الطلب: #${orderNo}\n\n` +
    `🪔 نوع الخدمة:\n${gasTypeLabel(booking)}\n\n` +
    `📊 الكمية:\n${gasQuantityLine(booking)}\n\n` +
    `💰 السعر: ${Number(booking.total_amount || 0).toFixed(2)} ريال\n\n` +
    `💳 الحالة:\n${paymentLabel(booking)}\n\n` +
    `📍 موقع التوصيل:\n${maps}\n` +
    dist +
    `\n⬇️ إتمام المهمة:\n${completeUrl}\n\n` +
    `أو من لوحة المزود:\n${base}/services-provider.html`
  );
}

async function fetchGasProviders(sb, booking, maxRadiusKm) {
  if (!sb || !booking) return [];
  const serviceType = "gas_delivery";
  const gasMode = booking.gas_mode || null;
  const district = String(booking.district || "").trim();
  const bookingLocation = booking.service_location || booking.location;

  const { data, error } = await sb
    .from("users")
    .select("id, phone, lat, lng, service_type, service_district, name")
    .eq("role", "service");
  if (error || !Array.isArray(data)) return [];

  const customer = bookingCustomerCoords(booking);
  const radius = Number(maxRadiusKm) || currentGasRadiusKm(booking);

  return data
    .map((u) => {
      const lat = u.lat != null ? Number(u.lat) : NaN;
      const lng = u.lng != null ? Number(u.lng) : NaN;
      let dist = Infinity;
      if (customer && Number.isFinite(lat) && Number.isFinite(lng)) {
        const km = roughDistanceKm(customer.lat, customer.lng, lat, lng);
        if (Number.isFinite(km)) dist = km;
      }
      return {
        id: u.id,
        phone: String(u.phone || "").trim(),
        name: String(u.name || "").trim(),
        service_type: String(u.service_type || "").trim().toLowerCase(),
        service_district: String(u.service_district || "").trim(),
        lat,
        lng,
        dist,
      };
    })
    .filter((p) => p.phone.length >= 10)
    .filter((p) => providerMatchesBookingType(p.service_type, serviceType, gasMode))
    .filter((p) => {
      if (!customer) return true;
      return providerWithinGasRadius(p, booking, radius);
    })
    .sort((a, b) => a.dist - b.dist);
}

async function persistGasNotifyMeta(sb, booking, phones) {
  if (!sb || !booking || !booking.id) return;
  const prev = notifiedGasPhones(booking);
  for (const p of phones) prev.add(p);
  const d = booking.data && typeof booking.data === "object" ? { ...booking.data } : {};
  if (!Number.isFinite(Number(d.gas_radius_km))) d.gas_radius_km = GAS_RADIUS_INITIAL_KM;
  d.gas_notified_phones = [...prev];
  d.gas_last_notify_at = new Date().toISOString();
  try {
    await sb
      .from("orders")
      .update({ data: d, updated_at: new Date().toISOString() })
      .eq("id", booking.id);
    booking.data = d;
  } catch (e) {
    console.error("[gasDeliveryNotify] persist meta:", e && (e.message || e));
  }
}

/**
 * إشعار مزودي الغاز ضمن نطاق الكيلومترات الحالي (١٥ ثم ٢٠ بعد التوسيع).
 */
async function notifyGasDeliveryProviders(sb, booking, opts) {
  if (!sb || !booking) return { sent: 0, providers: 0 };
  const options = opts && typeof opts === "object" ? opts : {};
  const radiusKm = Number(options.radiusKm) || currentGasRadiusKm(booking);
  const skip = options.skipPhones instanceof Set ? options.skipPhones : notifiedGasPhones(booking);
  const onlyNew = options.onlyNew !== false;

  let providers = await fetchGasProviders(sb, booking, radiusKm);
  if (onlyNew) {
    providers = providers.filter((p) => !skip.has(p.phone));
  }
  if (!providers.length) return { sent: 0, providers: 0, radius_km: radiusKm };

  const phones = providers.map((p) => p.phone).filter(Boolean);
  try {
    await notifyProvidersInAppByPhones(sb, booking, phones);
  } catch (e) {
    console.error("[gasDeliveryNotify] in-app:", e && (e.message || e));
  }

  const waOnCreate = String(process.env.ERVENOW_SERVICE_WA_ON_CREATE || "").trim() === "1";
  if (!waOnCreate) {
    return { sent: 0, providers: providers.length, radius_km: radiusKm, dashboard_only: true };
  }

  let sent = 0;
  const sentPhones = [];
  for (let i = 0; i < providers.length; i++) {
    const message = buildGasProviderMessage(booking, providers[i], i);
    try {
      await sendWhatsApp({ to: providers[i].phone, message });
      sent += 1;
      sentPhones.push(providers[i].phone);
    } catch (e) {
      console.error("[gasDeliveryNotify] WA:", e && (e.message || e));
    }
  }
  if (sentPhones.length) await persistGasNotifyMeta(sb, booking, sentPhones);
  return { sent, providers: providers.length, radius_km: radiusKm };
}

module.exports = {
  buildGasProviderMessage,
  fetchGasProviders,
  notifyGasDeliveryProviders,
};
