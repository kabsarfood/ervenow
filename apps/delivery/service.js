const { isValidDeliveryTransition, deliveryLifecycleIndex } = require("../../shared/utils/helpers");
const { onDeliveryDelivered } = require("../finance/hooks");

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
  const platformFee = calcPlatformFee(orderTotal);

  let distanceKm = null;
  let deliveryFee = 0;
  if (pickup_lat != null && pickup_lng != null && drop_lat != null && drop_lng != null) {
    distanceKm = await getRoadDistanceKm(pickup_lat, pickup_lng, drop_lat, drop_lng);
    deliveryFee = calcDeliveryFee(distanceKm);
  } else if (b.delivery_fee != null && b.delivery_fee !== "") {
    deliveryFee = Math.max(0, Math.round(Number(b.delivery_fee) * 100) / 100);
  }

  const extId =
    b.external_order_id != null && String(b.external_order_id).trim() !== ""
      ? String(b.external_order_id).trim().slice(0, 200)
      : null;
  const srcSeries =
    b.series_source != null && String(b.series_source).trim() !== ""
      ? String(b.series_source).trim().slice(0, 64)
      : "ervenow";
  const driverEarning = calcDriverEarning(deliveryFee);

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
      console.error("VAT UPSERT ERROR:", error.message || String(error));
    }
  } catch (e) {
    console.error("VAT UPSERT ERROR:", e && e.message != null ? e.message : String(e));
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

async function listOrders(sb, appUser) {
  if (appUser.role === "admin") {
    return sb.from("orders").select("*").order("created_at", { ascending: false });
  }
  if (appUser.role === "driver") {
    /* المندوب: pending المتاحة + طلباته المقبولة/قيد التوصيل */
    return sb
      .from("orders")
      .select("*")
      .or(
        `and(driver_id.is.null,delivery_status.eq.pending),and(driver_id.eq.${appUser.id},delivery_status.in.(pending,accepted,delivering))`
      )
      .order("created_at", { ascending: false });
  }
  return sb
    .from("orders")
    .select("*")
    .eq("customer_id", appUser.id)
    .order("created_at", { ascending: false });
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
    onDeliveryDelivered(sb, data).catch((err) => console.error("[ERVENOW] finance hook:", err.message || err));
    sb.rpc("ervenow_credit_driver_for_delivery", { p_order_id: data.id }).then(({ error: rpcErr }) => {
      if (rpcErr) console.error("[ervenow] ervenow_credit_driver_for_delivery:", rpcErr.message || rpcErr);
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
  if (appUser.role !== "customer" || order.customer_id !== appUser.id) {
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

module.exports = {
  listOrders,
  acceptOrder,
  setStatus,
  saveLocation,
  reportGpsError,
  rateOrder,
  getRoadDistanceKm,
  calcDeliveryFee,
  calcPlatformFee,
  calcDriverEarning,
  calcVAT,
  getRiyadhDate,
  buildInvoiceNumber,
  createDeliveryOrderFromBody,
  buildNextDeliveryOrderNumber,
  insertDeliveryOrderWithRetry,
};
