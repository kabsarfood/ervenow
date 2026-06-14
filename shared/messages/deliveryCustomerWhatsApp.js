/**
 * رسائل واتساب موحّدة لطالب الخدمة — ERVENOW
 * (بعد الدفع · قبول المزود/المندوب · في الطريق · الوصول)
 */

const { sendWhatsApp } = require("../utils/whatsapp");
const { isMapDeliveryOrder, productLineFromOrder } = require("../utils/deliveryMapOrder");
const { serviceDisplayName, isHomeServiceType } = require("../utils/homeServicePricing");
const { gasServiceLabel } = require("../utils/gasDeliveryPricing");

const MSG_PLATFORM_WELCOME = "ERVENOW - ترحب بكم";

const VEHICLE_CAT_AR = {
  sedan: "سيدان",
  pickup_truck: "سطحة",
  motorcycle: "دراجة نارية",
  furniture_truck: "شاحنة أثاث",
  van: "فان",
  suv: "دفع رباعي",
};

const VEHICLE_COND_AR = {
  working: "تعمل",
  damaged: "متضررة",
  broken: "معطلة",
  appraisal: "تقدير حادث",
};

const TRANSFER_AR = {
  internal: "داخلي",
  external: "خارجي",
  international: "دولي",
};

function orderDataObj(order) {
  return order && order.data && typeof order.data === "object" ? order.data : {};
}

function orderNumber(order) {
  return String(order?.order_number || order?.service_order_number || order?.id || "—").trim();
}

function orderTrackKey(order) {
  return orderNumber(order);
}

function buildPublicTrackUrl(orderOrKey) {
  const base = String(process.env.ERVENOW_PUBLIC_URL || "").replace(/\/$/, "");
  if (!base) return "";
  const key =
    orderOrKey != null && typeof orderOrKey === "object"
      ? orderTrackKey(orderOrKey)
      : String(orderOrKey || "").trim();
  if (!key) return "";
  return `${base}/track?id=${encodeURIComponent(key)}`;
}

function trackBlock(order) {
  const url = buildPublicTrackUrl(order);
  if (!url) return "🔗 تتبع الطلب: —";
  return (
    `🔗 تتبع الطلب:\n${url}\n\n` +
    "اضغط الرابط — سيُحمَّل رقم الطلب تلقائياً ثم اضغط «تحميل الطلب» للمتابعة."
  );
}

/** عرض الجوال للعميل (محاولة 05********) */
function formatCustomerPhoneLine(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "—";
  if (d.startsWith("966") && d.length >= 12) return "0" + d.slice(3);
  if (d.startsWith("0")) return d;
  if (d.length === 9) return "0" + d;
  return String(phone || "").trim() || "—";
}

function formatDriverPhoneLine(phone) {
  return formatCustomerPhoneLine(phone);
}

function fmtMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(2)} ريال`;
}

function orderAmountLine(order) {
  const sub = (Number(order?.order_total) || 0) + (Number(order?.delivery_fee) || 0);
  const twv = Number(order?.total_with_vat);
  if (Number.isFinite(twv) && twv > 0) return fmtMoney(twv);
  if (sub > 0) return fmtMoney(sub);
  const ta = Number(order?.total_amount);
  if (Number.isFinite(ta) && ta > 0) return fmtMoney(ta);
  return "—";
}

function pushLine(lines, label, value) {
  const v = String(value == null ? "" : value).trim();
  if (!v || v === "—") return;
  lines.push(`${label}: ${v}`);
}

function buildOrderDetailsLines(order) {
  const lines = [];
  if (!order) return lines;

  const d = orderDataObj(order);
  const car = d.car && typeof d.car === "object" ? d.car : {};
  const st = String(order.service_type || d.service_type || order.order_type || "").toLowerCase();

  if (["car_transport", "pickup_truck", "vehicle_transfer"].includes(st)) {
    pushLine(lines, "الخدمة", "نقل مركبات (سطحة)");
    const vcat = car.vehicle_category || d.vehicle_category;
    if (vcat) pushLine(lines, "نوع المركبة", VEHICLE_CAT_AR[vcat] || vcat);
    const vcond = car.vehicle_condition || d.vehicle_condition;
    if (vcond) pushLine(lines, "حالة المركبة", VEHICLE_COND_AR[vcond] || vcond);
    const tmode = car.transfer_mode || d.transfer_mode;
    if (tmode) pushLine(lines, "نوع النقل", TRANSFER_AR[tmode] || tmode);
    if (d.plate_number || car.plate_number) pushLine(lines, "اللوحة", d.plate_number || car.plate_number);
    if (d.from_city) pushLine(lines, "من مدينة", d.from_city);
    if (d.to_city) pushLine(lines, "إلى مدينة", d.to_city);
    if (d.pickup_district_label || car.pickup_district_label) {
      pushLine(lines, "منطقة الاستلام", d.pickup_district_label || car.pickup_district_label);
    }
    if (d.drop_district_label || car.drop_district_label) {
      pushLine(lines, "منطقة التسليم", d.drop_district_label || car.drop_district_label);
    }
  } else if (st === "gas_delivery") {
    pushLine(lines, "الخدمة", order.service_name || gasServiceLabel(order.gas_mode || d.gas_mode) || "توصيل غاز");
    const mode = String(order.gas_mode || d.gas_mode || "").toLowerCase();
    if (mode === "central_refill") {
      pushLine(lines, "النوع", "تعبئة غاز مركزي");
      pushLine(lines, "الكمية", `${order.gas_liters || d.gas_liters || order.qty || d.qty || "—"} لتر`);
    } else {
      pushLine(lines, "النوع", "تبديل أسطوانة غاز");
      pushLine(lines, "الكمية", `${order.qty || d.qty || order.service_qty || 1} أسطوانة`);
    }
  } else if (st === "internal_delivery" || st === "local_delivery") {
    pushLine(lines, "الخدمة", order.service_name || "توصيل داخلي");
    pushLine(lines, "الشحنة", d.shipment_name || d.product_label || "—");
    if (d.shipment_details || d.notes_extra) pushLine(lines, "التفاصيل", d.shipment_details || d.notes_extra);
    if (d.recipient_phone) pushLine(lines, "جوال المستلم", formatCustomerPhoneLine(d.recipient_phone));
  } else if (isHomeServiceType(st)) {
    pushLine(lines, "الخدمة", order.service_name || serviceDisplayName(st));
    pushLine(lines, "الحي", order.district || d.district || "—");
    pushLine(lines, "الموقع", order.service_location || order.location || d.location || "—");
  } else if (isMapDeliveryOrder(order)) {
    pushLine(lines, "الخدمة", "توصيل من الخريطة");
    pushLine(lines, "الشحنة", productLineFromOrder(order));
  } else if (order.store_name || order.store_id) {
    pushLine(lines, "المتجر", order.store_name || "متجر");
    if (order.notes) pushLine(lines, "ملاحظات", String(order.notes).split("\n")[0].slice(0, 120));
  } else {
    pushLine(lines, "الخدمة", order.service_name || "طلب ERVENOW");
  }

  if (order.pickup_address) pushLine(lines, "من", order.pickup_address);
  if (order.drop_address) pushLine(lines, "إلى", order.drop_address);
  if (!order.pickup_address && !order.drop_address && (order.district || d.district)) {
    pushLine(lines, "الحي", order.district || d.district);
  }

  const km = Number(order.distance_km != null ? order.distance_km : d.distance_km);
  if (Number.isFinite(km) && km > 0) pushLine(lines, "المسافة", `${km.toFixed(1)} كم`);

  pushLine(lines, "المبلغ", orderAmountLine(order));
  if (order.payment_status === "paid") pushLine(lines, "الدفع", "مدفوع ✅");

  return lines;
}

function detailsBlock(order) {
  const lines = buildOrderDetailsLines(order);
  if (!lines.length) return "تفاصيل الطلب: —";
  return "تفاصيل الطلب:\n" + lines.map((l) => `• ${l}`).join("\n");
}

/** بعد الدفع واعتماد الطلب */
function buildCustomerMessageOrderPaid(order) {
  const no = orderNumber(order);
  const phone = formatCustomerPhoneLine(order?.customer_phone);
  return (
    `${MSG_PLATFORM_WELCOME}\n\n` +
    `الطلب رقم ${no}\n\n` +
    `${detailsBlock(order)}\n\n` +
    `الجوال: ${phone}\n\n` +
    trackBlock(order)
  ).trim();
}

/** بعد قبول المندوب أو مزود الخدمة */
function buildCustomerMessageOrderAccepted(order, providerPhoneRaw) {
  const no = orderNumber(order);
  const providerNo = formatDriverPhoneLine(providerPhoneRaw);
  const extra =
    providerNo && providerNo !== "—"
      ? `\n\nرقم المندوب/المزود: ${providerNo}`
      : "";
  return (
    `${MSG_PLATFORM_WELCOME}\n\n` +
    `عزيزنا صاحب الطلب رقم (${no})\n` +
    `تم استلام الطلب.${extra}\n\n` +
    trackBlock(order)
  ).trim();
}

/** المندوب في الطريق */
function buildCustomerMessageOrderPickedUp(order) {
  const no = orderNumber(order);
  return (
    `${MSG_PLATFORM_WELCOME}\n\n` +
    `عزيزنا صاحب الطلب رقم (${no})\n` +
    `المندوب في الطريق إليك.\n\n` +
    trackBlock(order)
  ).trim();
}

/** وصول المندوب إلى وجهة العميل */
function buildCustomerMessageDriverArrived(order) {
  const no = orderNumber(order);
  return (
    `${MSG_PLATFORM_WELCOME}\n\n` +
    `عزيزنا صاحب الطلب رقم (${no})\n` +
    `لقد وصل المندوب إلى وجهتك.\n\n` +
    trackBlock(order)
  ).trim();
}

async function sendDeliveryCustomerWhatsApp(to, messageBody, logger) {
  const phone = String(to || "").trim();
  if (!phone || !messageBody) return false;
  try {
    return await sendWhatsApp({ to: phone, message: messageBody });
  } catch (e) {
    const err = e && (e.message || String(e));
    if (logger && typeof logger.error === "function") {
      logger.error({ err }, "[delivery-customer-wa] send");
    } else {
      console.error("[delivery-customer-wa]", err);
    }
    return false;
  }
}

async function sendCustomerOrderPaidWhatsApp(order, logger) {
  if (!order?.customer_phone) return false;
  if (String(order.payment_status || "").toLowerCase() !== "paid") return false;
  const body = buildCustomerMessageOrderPaid(order);
  return sendDeliveryCustomerWhatsApp(order.customer_phone, body, logger);
}

module.exports = {
  MSG_PLATFORM_WELCOME,
  buildPublicTrackUrl,
  orderNumber,
  orderTrackKey,
  formatCustomerPhoneLine,
  formatDriverPhoneLine,
  buildOrderDetailsLines,
  buildCustomerMessageOrderPaid,
  buildCustomerMessageOrderAccepted,
  buildCustomerMessageOrderPickedUp,
  buildCustomerMessageDriverArrived,
  sendDeliveryCustomerWhatsApp,
  sendCustomerOrderPaidWhatsApp,
};
