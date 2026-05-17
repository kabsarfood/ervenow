const { sendWhatsApp } = require("../utils/whatsapp");
const { commissionPercentLabel } = require("../utils/serviceCommission");
const { gasServiceLabel } = require("../utils/gasDeliveryPricing");
const { isHomeServiceType } = require("../utils/homeServicePricing");
const { notifyHomeServiceProvidersCascade } = require("./homeServiceNotify");

async function getServiceProviderPhones(sb, serviceType) {
  let q = sb.from("users").select("phone").eq("role", "service");
  if (serviceType) q = q.eq("service_type", serviceType);
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return data
    .map((u) => String(u.phone || "").trim())
    .filter((p) => p.length >= 10);
}

function gasTypeLine(booking) {
  if (String(booking.service_type || "").toLowerCase() !== "gas_delivery") return "";
  const mode = String(booking.gas_mode || "cylinder_swap").toLowerCase();
  if (mode === "central_refill") {
    const L = booking.gas_liters || booking.qty;
    return `نوع الخدمة: 2 — تعبئة غاز مركزي\nالكمية: ${L} لتر\n`;
  }
  return `نوع الخدمة: 1 — تبديل اسطوانة غاز\nالكمية: ${booking.qty || 1} أسطوانة\n`;
}

async function sendProviderBookingWhatsApp(phones, booking) {
  if (!Array.isArray(phones) || !phones.length || !booking) return;
  const paymentText =
    booking.payment_status === "paid" ? "مدفوع ✅" : "الدفع عند التوصيل 💵";
  const pct = commissionPercentLabel(booking.service_type);
  const gasLine = gasTypeLine(booking);
  const welcome =
    "مرحباً من منصة ERVENOW 👋\n" +
    "وصلك طلب خدمة غاز جديد:\n\n";
  const message =
    welcome +
    `📋 رقم الطلب: ${booking.service_order_number || booking.id || "—"}\n` +
    gasLine +
    `الخدمة: ${booking.service_name || gasServiceLabel(booking.gas_mode) || "توصيل غاز"}\n` +
    `الموقع: ${booking.location || booking.district || "—"}\n` +
    `جوال العميل: ${booking.customer_phone || "—"}\n` +
    `السعر: ${Number(booking.total_amount || 0).toFixed(2)} ريال\n` +
    `حالة الدفع: ${paymentText}\n` +
    `عمولة المنصة (${pct}): ${Number(booking.platform_commission || 0).toFixed(2)} ريال\n\n` +
    `بعد إتمام المهمة من لوحة المزود، تُسجَّل العمولة (7%) في ذمتكم ويجب توريدها للمنصة.\n` +
    `🔗 إتمام المهمة: ${process.env.ERVENOW_PUBLIC_URL || "https://ervenow.com"}/services-provider.html`;

  for (const phone of phones) {
    try {
      await sendWhatsApp({ to: phone, message });
    } catch (e) {
      console.error("[serviceBookingNotify] provider WhatsApp:", e && (e.message || e));
    }
  }
}

async function notifyProvidersForBooking(sb, booking) {
  if (!sb || !booking) return;
  const t = String(booking.service_type || "").toLowerCase();
  if (isHomeServiceType(t) || t === "gas_delivery") {
    await notifyHomeServiceProvidersCascade(sb, booking);
    return;
  }
  const phones = await getServiceProviderPhones(sb, booking.service_type);
  await sendProviderBookingWhatsApp(phones, booking);
}

module.exports = {
  getServiceProviderPhones,
  sendProviderBookingWhatsApp,
  notifyProvidersForBooking,
};
