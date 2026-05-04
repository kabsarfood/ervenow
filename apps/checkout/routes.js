const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { routeKmWithRoughFallback } = require("../../shared/utils/routeDistance");
const {
  allocateUniqueOrderNumber,
  allocateUniqueServiceOrderNumber,
} = require("../../shared/utils/generateOrderNumber");
const { perfLog } = require("../../shared/utils/perfLog");
const { checkoutLimiter } = require("../../shared/middleware/apiRateLimits");
const { normalizeIdempotencyKey } = require("../../shared/utils/idempotency");
const {
  claimOrReplayCheckout,
  finalizeCheckoutIdempotency,
  releaseCheckoutIdempotency,
} = require("../../shared/utils/checkoutIdempotency");
const { logger } = require("../../shared/utils/logger");
const { normalizeOrderFinancialsForInsert } = require("../../shared/utils/orderTotals");

const router = express.Router();

/**
 * ============================================================
 * ERVENOW CHECKOUT FLOW — SYSTEM SEPARATION (مهم جدًا)
 * ============================================================
 *
 * لدينا نظامين مختلفين للطلبات:
 *
 * 1) orders (مطاعم / متاجر / منتجات)
 *    - restaurant
 *    - store
 *    - supermarket
 *    - pharmacy
 *
 *    👉 هذه تذهب إلى جدول: orders
 *    👉 مرتبطة بالتوصيل (drivers)
 *
 *
 * 2) services (الخدمات + كداد)
 *    - service
 *    - plumber
 *    - electrician
 *    - vehicle_transfer
 *    - internal_delivery
 *    - pickup_truck
 *    - furniture_move
 *    - gas_delivery
 *
 *    👉 هذه تذهب إلى جدول: service_bookings
 *    👉 مرتبطة بمزودي الخدمة (service providers)
 *
 *
 * ❗ ملاحظة مهمة:
 * internal_delivery يعتبر "خدمة" وليس "توصيل مطعم"
 * لذلك لا يدخل في orders ولا نظام drivers
 *
 *
 * 🎯 الهدف من هذا الفصل:
 * - منع تعارض الأنظمة
 * - وضوح في التقارير
 * - سهولة التوسع مستقبلاً
 *
 *
 * ❗ أي تعديل على التصنيف يجب أن يراعي هذا الفصل
 * ============================================================
 */
function normalizedGroup(typeRaw) {
  const type = String(typeRaw || "")
    .trim()
    .toLowerCase();
  if (type === "restaurant") return "restaurant";
  if (type === "delivery") return "delivery";
  if (
    [
      "store",
      "supermarket",
      "pharmacy",
      "vegetables",
      "flowers_gifts",
      "sweets",
      "home_business",
      "minimarket",
      "butcher",
      "fish",
      "other",
    ].includes(type)
  ) {
    return "store";
  }
  if (
    [
      "service",
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
    ].includes(type)
  ) {
    return "service";
  }
  return null;
}

function normalizeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
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

router.post("/", requireAuth, checkoutLimiter, async (req, res) => {
  const perfStart = Date.now();
  const idemKey = normalizeIdempotencyKey(req);
  let idemClaimed = false;
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) {
      return res.status(503).json({ ok: false, message: "database not configured" });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, message: "cart empty" });
    }

    if (idemKey) {
      try {
        const idem = await claimOrReplayCheckout(sb, req.appUser.id, idemKey);
        if (idem.replay) return res.json(idem.replay);
        if (idem.conflict) {
          return res.status(409).json({ ok: false, message: "checkout already in progress for this key" });
        }
        idemClaimed = Boolean(idem.claimed);
      } catch (idemErr) {
        logger.error({ err: idemErr && (idemErr.message || String(idemErr)) }, "[checkout] idempotency");
        return res.status(503).json({ ok: false, message: "idempotency unavailable" });
      }
    }

    const grouped = {
      restaurant: [],
      service: [],
      delivery: [],
      store: [],
    };

    items.forEach((i) => {
      const g = normalizedGroup(i && i.type);
      if (g && grouped[g]) grouped[g].push(i);
    });

    const results = [];

    for (const type of Object.keys(grouped)) {
      const groupItems = grouped[type];
      if (!groupItems.length) continue;

      if (type === "service") {
        for (const it of groupItems) {
          const data = it && typeof it.data === "object" && it.data ? it.data : {};
          const serviceType = String(it.type || "service").trim().toLowerCase();
          const total = Number(it.price) || Number(data.total_amount) || 0;
          const serviceRow = {
            service_order_number: null,
            customer_id: req.appUser.id,
            customer_phone: String(req.appUser.phone || data.customer_phone || it.customer_phone || "").trim(),
            service_type: serviceType,
            service_name: String(it.title || labelByType(serviceType)).trim(),
            district: String(data.district || "").trim(),
            location: String(data.location || data.to || "").trim(),
            qty: normalizeQty(data.qty || 1),
            total_amount: total,
            payment_status: "paid",
            platform_commission: Math.round(total * 0.12 * 100) / 100,
            status: "new",
          };

          let serviceData = null;
          let sErr = null;
          for (let insAttempt = 0; insAttempt < 5; insAttempt += 1) {
            serviceRow.service_order_number = await allocateUniqueServiceOrderNumber(sb, "SV");
            const ins = await sb.from("service_bookings").insert(serviceRow).select().single();
            serviceData = ins.data;
            sErr = ins.error;
            if (!sErr) break;
            const msg = String(sErr.message || sErr.details || "");
            const dup =
              String(sErr.code || "") === "23505" ||
              /duplicate key|unique constraint/i.test(msg);
            if (!dup || insAttempt === 4) throw sErr;
          }
          if (sErr) throw sErr;
          results.push(serviceData);
        }
        continue;
      }

      const total = groupItems.reduce((sum, i) => sum + (Number(i && i.price) || 0), 0);

      const storeIds = new Set(
        groupItems.map((i) => String((i.data && i.data.store_id) || "").trim()).filter(Boolean)
      );
      if (storeIds.size > 1) {
        return res.status(400).json({ ok: false, message: "يجب أن تكون منتجات السلة من متجر واحد" });
      }
      const singleStoreId = storeIds.size === 1 ? [...storeIds][0] : null;

      const orderPrefix = type === "store" ? "ES" : "ED";

      const row = {
        series_source: "ERVENOW",
        delivery_status: "pending",
        status: "new",
        order_total: total,
        total_amount: total,
        customer_id: req.appUser.id,
        customer_phone: String(
          req.appUser.phone ||
            groupItems[0]?.data?.customer_phone ||
            groupItems[0]?.customer_phone ||
            ""
        ).trim(),
        breakdown: {
          items: groupItems,
          type,
        },
        notes: `Checkout group: ${type}`,
      };

      if (singleStoreId) {
        const custLat = Number(req.body.customer_lat);
        const custLng = Number(req.body.customer_lng);
        if (!Number.isFinite(custLat) || !Number.isFinite(custLng)) {
          return res.status(400).json({ ok: false, message: "حدد موقع التوصيل (GPS) لطلبات المتجر" });
        }
        const { data: storeRow, error: storeErr } = await sb
          .from("stores")
          .select("*")
          .eq("id", singleStoreId)
          .eq("status", "approved")
          .maybeSingle();
        if (storeErr || !storeRow || storeRow.lat == null || storeRow.lng == null) {
          return res.status(400).json({ ok: false, message: "متجر غير متاح أو بلا موقع مسجّل" });
        }
        const slat = Number(storeRow.lat);
        const slng = Number(storeRow.lng);
        const km = await routeKmWithRoughFallback(slat, slng, custLat, custLng);
        const radius = Number(storeRow.delivery_radius_km) > 0 ? Number(storeRow.delivery_radius_km) : 5;
        if (!Number.isFinite(km) || km > radius) {
          return res.status(400).json({ ok: false, message: "هذا المتجر لا يغطي منطقتك" });
        }
        const deliveryFee = Math.round(km * 2.3 * 100) / 100;
        const dropAddress =
          String(
            req.body.customer_address ||
              groupItems[0]?.data?.drop_address ||
              groupItems[0]?.data?.location ||
              ""
          ).trim() || "عنوان التوصيل";
        row.pickup_address = String(storeRow.address || storeRow.name || "").trim() || String(storeRow.name || "");
        row.pickup_lat = slat;
        row.pickup_lng = slng;
        row.drop_address = dropAddress;
        row.drop_lat = custLat;
        row.drop_lng = custLng;
        row.delivery_fee = deliveryFee;
        row.distance_km = Math.round(km * 100) / 100;
        row.order_total = total;
        row.total_amount = Math.round((total + deliveryFee) * 100) / 100;
        row.driver_earning = deliveryFee;
        row.platform_fee = Math.round(total * 0.12 * 100) / 100;
        row.notes = `متجر: ${storeRow.name || singleStoreId}`;
        row.store_id = singleStoreId;
      }

      let data = null;
      let insertErr = null;
      for (let insAttempt = 0; insAttempt < 5; insAttempt += 1) {
        row.order_number = await allocateUniqueOrderNumber(sb, orderPrefix);
        const insertRow = normalizeOrderFinancialsForInsert(row);
        const ins = await sb.from("orders").insert(insertRow).select().single();
        data = ins.data;
        insertErr = ins.error;
        if (!insertErr) break;
        const msg = String(insertErr.message || insertErr.details || "");
        const dup =
          String(insertErr.code || "") === "23505" ||
          /duplicate key|unique constraint/i.test(msg);
        if (!dup || insAttempt === 4) throw insertErr;
      }
      if (insertErr) throw insertErr;
      results.push(data);

      if (type === "delivery" || singleStoreId) {
        try {
          await enqueueDeliveryJob("checkout-dispatch", {
            orderId: data.id,
            groupItems,
            total,
            appUserPhone: req.appUser?.phone || "",
          });
        } catch (queueErr) {
          logger.error(
            { err: queueErr && (queueErr.message || String(queueErr)), orderId: data.id },
            "[checkout] enqueue checkout-dispatch"
          );
        }
      }
    }

    perfLog("checkout", {
      routeTime: Date.now() - perfStart,
      osrmStatus: "queued_dispatch",
      ordersCount: results.length,
    });
    const responseBody = { ok: true, orders: results };
    if (idemKey) {
      try {
        await finalizeCheckoutIdempotency(sb, req.appUser.id, idemKey, responseBody);
      } catch (finErr) {
        logger.error({ err: finErr && (finErr.message || String(finErr)) }, "[checkout] idempotency finalize");
      }
    }
    return res.json(responseBody);
  } catch (e) {
    logger.error({ err: e && (e.message || String(e)) }, "CHECKOUT_ERROR");
    try {
      const sb = req.supabase || createServiceClient();
      if (idemKey && idemClaimed && sb) {
        await releaseCheckoutIdempotency(sb, req.appUser.id, idemKey);
      }
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
});

module.exports = router;
