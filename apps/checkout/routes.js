const express = require("express");
const { optionalAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { pushToErvenow } = require("../../shared/utils/ervenowPush");

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

router.post("/", optionalAuth, async (req, res) => {
  try {
    const sb = req.supabase || createServiceClient();
    if (!sb) {
      return res.status(503).json({ ok: false, message: "database not configured" });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, message: "cart empty" });
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
    const now = Date.now();
    let seq = 0;

    for (const type of Object.keys(grouped)) {
      const groupItems = grouped[type];
      if (!groupItems.length) continue;

      if (type === "service") {
        for (const it of groupItems) {
          const data = it && typeof it.data === "object" && it.data ? it.data : {};
          const serviceType = String(it.type || "service").trim().toLowerCase();
          const total = Number(it.price) || Number(data.total_amount) || 0;
          const serviceOrderNumber = await buildNextServiceOrderNumber(sb);
          const serviceRow = {
            service_order_number: serviceOrderNumber,
            customer_id: req.appUser?.id || null,
            customer_phone:
              req.appUser?.phone ||
              String(data.customer_phone || it.customer_phone || "").trim(),
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

          const { data: serviceData, error: sErr } = await sb
            .from("service_bookings")
            .insert(serviceRow)
            .select()
            .single();
          if (sErr) throw sErr;
          results.push(serviceData);
        }
        continue;
      }

      const total = groupItems.reduce((sum, i) => sum + (Number(i && i.price) || 0), 0);
      seq += 1;

      const row = {
        order_number: "EW-" + now + "-" + seq,
        series_source: "ERVENOW",
        delivery_status: "pending",
        status: "new",
        order_total: total,
        total_amount: total,
        customer_id: req.appUser?.id || null,
        customer_phone:
          req.appUser?.phone ||
          String(groupItems[0]?.data?.customer_phone || groupItems[0]?.customer_phone || "").trim(),
        breakdown: {
          items: groupItems,
          type,
        },
        notes: `Checkout group: ${type}`,
      };

      const { data, error } = await sb.from("orders").insert(row).select().single();
      if (error) throw error;
      results.push(data);

      if (type === "delivery") {
        const orderData = (data && data.data && typeof data.data === "object" ? data.data : {});
        if (orderData.pushed_to_delivery) {
          console.log("ALREADY PUSHED");
          continue;
        }

        const firstItem = groupItems[0] || {};
        const firstData = (firstItem && typeof firstItem.data === "object" && firstItem.data) || {};
        const itemsText = groupItems
          .map((it) => String((it && it.title) || "طلب توصيل"))
          .join(" | ");
        try {
          await pushToErvenow({
            id: data.id,
            orderNumber: data.order_number,
            customerPhone:
              data.customer_phone ||
              req.appUser?.phone ||
              String(firstData.customer_phone || "").trim(),
            address: String(firstData.to || firstData.drop_address || firstData.location || "").trim(),
            lat: firstData.drop_lat,
            lng: firstData.drop_lng,
            items: groupItems,
            itemsText,
            total: total,
          });
          await sb
            .from("orders")
            .update({
              data: {
                ...orderData,
                pushed_to_delivery: true,
                pushed_to_delivery_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", data.id);
          console.log("PUSHED ONCE ONLY");
        } catch (e) {
          console.error("PUSH ERROR:", e && (e.message || e));
          try {
            await sb.from("ervenow_push_queue").insert({
              payload: {
                id: data.id,
                orderNumber: data.order_number,
                customerPhone:
                  data.customer_phone ||
                  req.appUser?.phone ||
                  String(firstData.customer_phone || "").trim(),
                address: String(firstData.to || firstData.drop_address || firstData.location || "").trim(),
                items: groupItems,
                total,
              },
              target_url: "delivery",
              status: "pending",
            });
          } catch (qErr) {
            console.error("PUSH QUEUE ERROR:", qErr && (qErr.message || qErr));
          }
        }
      }
    }

    return res.json({ ok: true, orders: results });
  } catch (e) {
    console.error("CHECKOUT ERROR:", e);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
