const { isValidDeliveryTransition, deliveryLifecycleIndex } = require("../../shared/utils/helpers");
const { onDeliveryDelivered } = require("../finance/hooks");
const { normalizePhone } = require("../../shared/utils/phone");
const { getOsrmRouteKmOrHaversine } = require("../../shared/utils/osrmClient");
const { logger } = require("../../shared/utils/logger");

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * مسافة القيادة عبر ORS (كم). عند عدم المفتاح أو فشل الـ API يُستخدم خطّ الطيور (هافرساين) كاحتياطي.
 */
async function getRoadDistanceKm(lat1, lng1, lat2, lng2) {
  const apiKey = String(process.env.ORS_API_KEY || "").trim();
  if (apiKey) {
    try {
      const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [
            [lng1, lat1],
            [lng2, lat2],
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      const meters = data?.routes?.[0]?.summary?.distance;
      if (res.ok && typeof meters === "number" && !Number.isNaN(meters)) {
        return meters / 1000;
      }
      console.warn("[delivery] ORS distance:", res.status, data.error || data.message || JSON.stringify(data).slice(0, 200));
    } catch (e) {
      console.warn("[delivery] ORS fetch:", e.message || e);
    }
  }
  return haversineDistanceKm(lat1, lng1, lat2, lng2);
}

function calcDeliveryFee(distanceKm) {
  return Math.round(Number(distanceKm) * 2.3 * 100) / 100;
}

function calcPlatformFee(total) {
  return Math.round(Number(total) * 0.12 * 100) / 100;
}

function normalizeVehicleType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["bike", "bicycle", "motorbike", "motorcycle", "دراجة", "دباب"].includes(s)) return "bike";
  return "car";
}

function calcDeliveryBaseFee(distanceKm, vehicleType) {
  const km = Number(distanceKm) || 0;
  const vt = normalizeVehicleType(vehicleType);
  if (km <= 7) return vt === "bike" ? 15 : 22;
  return calcDeliveryFee(km);
}

function calcDeliveryPlatformFee(deliveryFee) {
  return Math.round(Number(deliveryFee) * 0.15 * 100) / 100;
}

function calcDriverEarning(deliveryFee) {
  return Math.round(Number(deliveryFee) * 100) / 100;
}

/** ضريبة القيمة المضافة 15% من (قيمة الطلب + التوصيل)، خانتان عشريتان */
function calcVAT(amount) {
  return Math.round(Number(amount) * 0.15 * 100) / 100;
}

/** تاريخ «اليوم» بتقويم الرياض (YYYY-MM-DD) — للتقارير و VAT */
function getRiyadhDate() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh",
  });
}

/** رقم فاتورة شبه فريد — طابع زمني + عشوائي (قيد unique في القاعدة) */
function buildInvoiceNumber() {
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 1000);
  return `INV-${ts}-${rand}`;
}

function parseCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isOrderPaid(order) {
  const payStatus =
    String(order?.payment_status || order?.data?.payment_status || "")
      .trim()
      .toLowerCase() || "";
  return payStatus === "paid" || payStatus === "captured" || payStatus === "completed";
}

function calcRefundAmount(order) {
  const totalWithVat = Number(order?.total_with_vat);
  if (Number.isFinite(totalWithVat) && totalWithVat > 0) return Math.round(totalWithVat * 100) / 100;
  const base = (Number(order?.order_total) || 0) + (Number(order?.delivery_fee) || 0);
  return Math.round(base * 100) / 100;
}

async function resolveCustomerId(sb, order) {
  if (order?.customer_id) return order.customer_id;
  const p = normalizePhone(order?.customer_phone || "");
  if (!p) return null;
  const { data, error } = await sb.from("users").select("id").eq("phone", p).maybeSingle();
  if (error) return null;
  return data?.id || null;
}

async function refundCustomerWalletIfPaid(sb, order) {
  if (!isOrderPaid(order)) return { refunded: false, reason: "not_paid" };
  const customerId = await resolveCustomerId(sb, order);
  if (!customerId) return { refunded: false, reason: "customer_not_found" };
  const refundAmount = calcRefundAmount(order);
  if (!(refundAmount > 0)) return { refunded: false, reason: "zero_amount" };

  const refundNote = `refund_customer_cancel:${order.id}`;
  const { data: exists, error: exErr } = await sb
    .from("ervenow_wallet_transactions")
    .select("id")
    .eq("user_id", customerId)
    .eq("type", "earning")
    .eq("note", refundNote)
    .maybeSingle();
  if (exErr) {
    return { refunded: false, reason: "wallet_tx_check_error" };
  }
  if (exists?.id) return { refunded: false, reason: "already_refunded" };

  const { data: wallet, error: wErr } = await sb
    .from("ervenow_wallets")
    .select("*")
    .eq("user_id", customerId)
    .maybeSingle();
  if (wErr) return { refunded: false, reason: "wallet_fetch_error" };

  if (!wallet) {
    const { error: insWErr } = await sb.from("ervenow_wallets").insert({
      user_id: customerId,
      role: "customer",
      balance: refundAmount,
      total_earned: refundAmount,
      total_withdrawn: 0,
    });
    if (insWErr) return { refunded: false, reason: "wallet_create_error" };
  } else {
    const nextBal = (Number(wallet.balance) || 0) + refundAmount;
    const nextEarn = (Number(wallet.total_earned) || 0) + refundAmount;
    const { error: upWErr } = await sb
      .from("ervenow_wallets")
      .update({ balance: nextBal, total_earned: nextEarn })
      .eq("user_id", customerId);
    if (upWErr) return { refunded: false, reason: "wallet_update_error" };
  }

  const { error: txErr } = await sb.from("ervenow_wallet_transactions").insert({
    user_id: customerId,
    amount: refundAmount,
    type: "earning",
    reference_id: null,
    note: refundNote,
  });
  if (txErr) return { refunded: false, reason: "wallet_tx_insert_error" };

  return { refunded: true, amount: refundAmount, customer_id: customerId };
}

/**
 * إنشاء طلب توصيل من واجهة /api/delivery/orders: مسافة طريق + أجور عند توفر إحداثيات.
 */
async function createDeliveryOrderFromBody(sb, appUser, body) {
  const b = body && typeof body === "object" ? body : {};
  const pickup_lat = parseCoord(b.pickup_lat);
  const pickup_lng = parseCoord(b.pickup_lng);
  const drop_lat = parseCoord(b.drop_lat);
  const drop_lng = parseCoord(b.drop_lng);
  const orderTotal = Math.max(0, Number(b.order_total) || 0);
  const vehicleType = normalizeVehicleType(b.vehicle_type);

  let distanceKm = null;
  let deliveryFee = 0;
  if (pickup_lat != null && pickup_lng != null && drop_lat != null && drop_lng != null) {
    distanceKm = haversineDistanceKm(pickup_lat, pickup_lng, drop_lat, drop_lng);
    deliveryFee = calcDeliveryBaseFee(distanceKm, vehicleType);
  } else if (b.delivery_fee != null && b.delivery_fee !== "") {
    deliveryFee = Math.max(0, Math.round(Number(b.delivery_fee) * 100) / 100);
  }
  const platformFee = calcDeliveryPlatformFee(deliveryFee);

  const extId =
    b.external_order_id != null && String(b.external_order_id).trim() !== ""
      ? String(b.external_order_id).trim().slice(0, 200)
      : null;
  const srcSeries =
    b.series_source != null && String(b.series_source).trim() !== ""
      ? String(b.series_source).trim().slice(0, 64)
      : "ervenow";
  const idemRaw =
    b.idempotency_key != null && String(b.idempotency_key).trim() !== ""
      ? String(b.idempotency_key).trim().slice(0, 256)
      : null;
  const driverEarning = Math.max(0, Math.round((deliveryFee - platformFee) * 100) / 100);

  const subtotal = orderTotal + deliveryFee;
  const vatAmount = calcVAT(subtotal);
  const totalWithVAT = Math.round((subtotal + vatAmount) * 100) / 100;

  return insertDeliveryOrderWithRetry(sb, (order_number) => ({
    customer_id: appUser.id,
    customer_phone: b.customer_phone != null && String(b.customer_phone).trim() !== "" ? String(b.customer_phone) : appUser.phone || "",
    pickup_address: String(b.pickup_address || "").trim(),
    drop_address: String(b.drop_address || "").trim(),
    notes: String(b.notes || "").trim(),
    order_number,
    delivery_status: "pending",
    pickup_lat,
    pickup_lng,
    drop_lat,
    drop_lng,
    distance_km: distanceKm,
    delivery_fee: deliveryFee,
    platform_fee: platformFee,
    order_total: orderTotal,
    driver_earning: driverEarning,
    vat_amount: vatAmount,
    total_with_vat: totalWithVAT,
    external_order_id: extId,
    series_source: srcSeries,
    ...(idemRaw ? { idempotency_key: idemRaw } : {}),
  }));
}

/**
 * تسلسل يومي ED-<day>-<seq> — العدّ داخل نفس يوم created_at؛ تنسيق 001/010 ثم 100+ بدون سقف خانات.
 */
async function buildNextDeliveryOrderNumber(sb) {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { count, error } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) throw error;

  const seq = (count ?? 0) + 1;
  const formattedSeq =
    seq < 10
      ? `00${seq}`
      : seq < 100
        ? `0${seq}`
        : String(seq);
  return `ED-${day}-${formattedSeq}`;
}

const PG_UNIQUE_VIOLATION = "23505";

function isOrderNumberUniqueViolation(err) {
  if (!err) return false;
  if (err.code === PG_UNIQUE_VIOLATION) return true;
  const m = String(err.message || err.details || "");
  return /duplicate key|unique constraint/i.test(m);
}

/**
 * سجل ضريبة في vat_records — upsert على order_id لتفادي التكرار. لا يلغي نجاح الطلب عند الفشل.
 */
async function insertVatRecordForOrder(sb, insertedOrder) {
  if (!insertedOrder || insertedOrder.id == null) return;
  const raw = insertedOrder.vat_amount;
  const vatAmount = raw == null || raw === "" ? 0 : Math.round(Number(raw) * 100) / 100;
  if (vatAmount <= 0) return;

  const ot = Number(insertedOrder.order_total) || 0;
  const df = Number(insertedOrder.delivery_fee) || 0;
  const subtotal = Math.round((ot + df) * 100) / 100;

  try {
    const { error } = await sb.from("vat_records").upsert(
      {
        order_id: insertedOrder.id,
        vat_amount: vatAmount,
        subtotal,
        vat_date_riyadh: getRiyadhDate(),
      },
      { onConflict: "order_id" }
    );
    if (error) {
      logger.error({ err: error.message || String(error) }, "VAT UPSERT ERROR");
    }
  } catch (e) {
    logger.error({ err: e && e.message != null ? e.message : String(e) }, "VAT UPSERT ERROR");
  }
}

/**
 * يُعيد المحاولة عند تعارض order_number (ضغط متزامن) دون تغيير منطق التوليد.
 */
async function insertDeliveryOrderWithRetry(sb, buildRow) {
  const maxAttempts = 12;
  for (let a = 0; a < maxAttempts; a++) {
    const base = 20;
    const cap = 2000; // 2s كحد أعلى
    const delay = Math.min(cap, Math.pow(2, a) * base);
    const jitter = Math.random() * 50;

    await new Promise((r) => setTimeout(r, delay + jitter));
    const order_number = await buildNextDeliveryOrderNumber(sb);
    const row = buildRow(order_number);
    const { data, error } = await sb.from("orders").insert(row).select().single();
    if (!error) {
      if (data) await insertVatRecordForOrder(sb, data);
      return { data, error: null };
    }
    if (isOrderNumberUniqueViolation(error)) continue;
    return { data, error };
  }
  return {
    data: null,
    error: new Error("تعذّر إنشاء رقم طلب فريد بعد عدة محاولات"),
  };
}

/** أعمدة قائمة الطلبات فقط — أخف من select("*") ويُبقي واجهات dashboard/driver/orders تعمل */
const ORDERS_LIST_COLUMNS =
  "id,customer_id,driver_id,status,delivery_status,order_number,created_at,updated_at," +
  "pickup_address,drop_address,pickup_lat,pickup_lng,drop_lat,drop_lng," +
  "series_source,external_order_id,customer_phone,delivery_fee,distance_km";

async function listOrders(sb, appUser) {
  if (appUser.role === "admin") {
    return sb
      .from("orders")
      .select(ORDERS_LIST_COLUMNS)
      .in("delivery_status", ["new", "pending", "accepted", "delivering"])
      .order("created_at", { ascending: false })
      .limit(100);
  }
  if (appUser.role === "driver") {
    /* المندوب: طلبات مفتوحة (new/pending) + طلباته المسندة */
    return sb
      .from("orders")
      .select(ORDERS_LIST_COLUMNS)
      .or(
        `and(driver_id.is.null,delivery_status.in.(new,pending)),and(driver_id.eq.${appUser.id},delivery_status.in.(new,pending,accepted,delivering))`
      )
      .order("created_at", { ascending: false })
      .limit(50);
  }
  return sb
    .from("orders")
    .select(ORDERS_LIST_COLUMNS)
    .eq("customer_id", appUser.id)
    .order("created_at", { ascending: false })
    .limit(50);
}

async function acceptOrder(sb, orderId, driverId) {
  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  const current = order.delivery_status || order.status || "pending";
  if (deliveryLifecycleIndex(current) !== 0) {
    return { data: null, error: new Error("Order not available") };
  }

  const { data, error } = await sb
    .from("orders")
    .update({
      delivery_status: "accepted",
      driver_id: driverId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .is("driver_id", null)
    .in("delivery_status", ["new", "pending"])
    .select()
    .single();

  return { data, error };
}

async function setStatus(sb, orderId, nextStatus, appUser) {
  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };

  if (appUser.role === "driver" && order.driver_id !== appUser.id) {
    return { data: null, error: new Error("Not your order") };
  }

  const current = order.delivery_status || order.status || "pending";
  if (!isValidDeliveryTransition(current, nextStatus)) {
    return { data: null, error: new Error(`Invalid transition ${current} → ${nextStatus}`) };
  }

  const { data, error } = await sb
    .from("orders")
    .update({ delivery_status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select()
    .single();

  if (!error && data && nextStatus === "delivered") {
    onDeliveryDelivered(sb, data).catch((err) =>
      logger.error({ err: err.message || String(err) }, "[ERVENOW] finance hook")
    );
    sb.rpc("ervenow_credit_driver_for_delivery", { p_order_id: data.id }).then(({ error: rpcErr }) => {
      if (rpcErr) logger.error({ err: rpcErr.message || String(rpcErr) }, "[ervenow] ervenow_credit_driver_for_delivery");
    });
  }

  return { data, error };
}

async function saveLocation(sb, orderId, appUser, lat, lng) {
  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  if (appUser.role !== "driver" || order.driver_id !== appUser.id) {
    return { data: null, error: new Error("Forbidden") };
  }

  const { data, error } = await sb
    .from("orders")
    .update({
      driver_lat: lat,
      driver_lng: lng,
      last_location_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  return { data, error };
}

/**
 * ينبّه الخادم بأن GPS تعذّر دون تغيير last known lat/lng (متابعة الوقت فقط).
 */
async function reportGpsError(sb, orderId, appUser) {
  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  if (appUser.role !== "driver" || order.driver_id !== appUser.id) {
    return { data: null, error: new Error("Forbidden") };
  }

  const { data, error } = await sb
    .from("orders")
    .update({
      last_location_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  return { data, error };
}

async function rateOrder(sb, orderId, appUser, rating, review) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return { data: null, error: new Error("rating must be 1–5") };
  }

  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  const canRateVisitor =
    order.customer_id === appUser.id &&
    (appUser.role === "customer" || appUser.role === "admin");
  if (!canRateVisitor) {
    return { data: null, error: new Error("Forbidden") };
  }
  const current = order.delivery_status || order.status;
  if (current !== "delivered") {
    return { data: null, error: new Error("Order not delivered") };
  }

  const reviewText = review == null || review === "" ? null : String(review).trim().slice(0, 4000);

  const { data, error } = await sb
    .from("orders")
    .update({
      rating: r,
      review: reviewText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  return { data, error };
}

async function cancelOrderByCustomer(sb, orderId, appUser) {
  const { data: order, error: gErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (gErr || !order) return { data: null, error: gErr || new Error("Not found"), refund: null };

  const canCancelVisitor =
    order.customer_id === appUser.id &&
    (appUser.role === "customer" || appUser.role === "admin");
  if (!canCancelVisitor) {
    return { data: null, error: new Error("Forbidden"), refund: null };
  }
  const current = String(order.delivery_status || order.status || "").trim().toLowerCase();
  if (!["new", "pending", "accepted"].includes(current)) {
    return { data: null, error: new Error("لا يمكن إلغاء الطلب في هذه المرحلة"), refund: null };
  }

  const { data, error } = await sb
    .from("orders")
    .update({
      delivery_status: "cancelled_by_customer",
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();
  if (error) return { data: null, error, refund: null };

  const refund = await refundCustomerWalletIfPaid(sb, order);
  return { data, error: null, refund };
}

/**
 * بعد إنشاء الطلب بمسافة هافرساين سريعة: يعيد حساب المسافة بـ OSRM (محكوم) ويحدّث الأجور والضريبة.
 */
async function refineDeliveryOrderPricingFromOsrm(sb, orderId) {
  const id = String(orderId || "").trim();
  if (!id || !sb) return { ok: false };

  const { data: order, error } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (error || !order) return { ok: false };

  const pickup_lat = parseCoord(order.pickup_lat);
  const pickup_lng = parseCoord(order.pickup_lng);
  const drop_lat = parseCoord(order.drop_lat);
  const drop_lng = parseCoord(order.drop_lng);
  if (pickup_lat == null || pickup_lng == null || drop_lat == null || drop_lng == null) {
    return { ok: true, skipped: true };
  }

  const vehicleType = normalizeVehicleType(order?.data?.vehicle_type);
  const distanceKm = await getOsrmRouteKmOrHaversine(
    { lat: pickup_lat, lng: pickup_lng },
    { lat: drop_lat, lng: drop_lng }
  );
  if (!Number.isFinite(distanceKm)) return { ok: false };

  const deliveryFee = calcDeliveryBaseFee(distanceKm, vehicleType);
  const platformFee = calcDeliveryPlatformFee(deliveryFee);
  const driverEarning = Math.max(0, Math.round((deliveryFee - platformFee) * 100) / 100);
  const orderTotal = Math.max(0, Number(order.order_total) || 0);
  const subtotal = orderTotal + deliveryFee;
  const vatAmount = calcVAT(subtotal);
  const totalWithVAT = Math.round((subtotal + vatAmount) * 100) / 100;

  const { data: updated, error: uErr } = await sb
    .from("orders")
    .update({
      distance_km: distanceKm,
      delivery_fee: deliveryFee,
      platform_fee: platformFee,
      driver_earning: driverEarning,
      vat_amount: vatAmount,
      total_with_vat: totalWithVAT,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (uErr || !updated) return { ok: false, error: uErr };
  await insertVatRecordForOrder(sb, updated);
  return { ok: true, order: updated };
}

module.exports = {
  listOrders,
  acceptOrder,
  setStatus,
  saveLocation,
  reportGpsError,
  rateOrder,
  cancelOrderByCustomer,
  getRoadDistanceKm,
  calcDeliveryFee,
  calcPlatformFee,
  calcDeliveryPlatformFee,
  calcDeliveryBaseFee,
  normalizeVehicleType,
  calcDriverEarning,
  calcVAT,
  getRiyadhDate,
  buildInvoiceNumber,
  createDeliveryOrderFromBody,
  buildNextDeliveryOrderNumber,
  insertDeliveryOrderWithRetry,
  refineDeliveryOrderPricingFromOsrm,
};
