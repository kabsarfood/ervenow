const { routeKmWithRoughFallback } = require("../../shared/utils/routeDistance");
const {
  allocateUniqueOrderNumber,
} = require("../../shared/utils/generateOrderNumber");
const { normalizeOrderFinancialsForInsert } = require("../../shared/utils/orderTotals");
const { enqueueDeliveryJob } = require("../../queues/deliveryQueue");
const { logger } = require("../../shared/utils/logger");
const { runStoreCheckoutSideEffects } = require("../../shared/utils/storeOrderPostCheckout");
const { isOrderPaymentGateRequired } = require("../../shared/utils/orderPaymentGate");
const { isPaidFromRequestBody, normalizeOrderPaymentMethod } = require("../delivery/service");
const { insertOrdersResilient } = require("../../shared/utils/idempotency");
const {
  isIdempotencyKeyUniqueViolation,
  fetchOrderByCustomerIdempotencyKey,
  findRecentSimilarDeliveryOrder,
} = require("../../shared/utils/orderDedup");
const { createServiceOrder } = require("../../shared/services/serviceOrderCreate");
const { canPlaceOrders, driverOrderPlacementError } = require("../../shared/utils/platformAccessPolicy");
const {
  applyErvenowPayForCheckoutOrders,
  isErvenowPayMethod,
} = require("../../shared/services/ervenowPayCheckout");
const { createNotification } = require("../../shared/services/notificationService");
const { computePlatformCommission } = require("../../shared/utils/platformCommission");
const {
  useCartDeliverySnapshot,
  resolveStoreCheckoutFromCartSnapshot,
} = require("../../shared/utils/checkoutDeliveryEngine");

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
  /* pickup_truck / furniture_move: تبقى للتوافق مع سلات قديمة؛ الواجهة العامة تستخدم /delivery-services.html */
  if (
    [
      "service",
      "plumber",
      "electrician",
      "nursery",
      "ac_technician",
      "cleaning",
      "vehicle_transfer",
      "car_transport",
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
    car_transport: "نقل مركبات",
    internal_delivery: "توصيل داخلي",
    pickup_truck: "ونيت",
    furniture_move: "نقل أثاث",
    gas_delivery: "تبديل غاز",
    service: "خدمة عامة",
  };
  return map[type] || type || "خدمة";
}

const GEO_DELIVERY_SERVICE_TYPES = new Set(["car_transport", "vehicle_transfer", "pickup_truck"]);

function cartItemHasGeoCoords(data) {
  const d = data || {};
  return (
    Number.isFinite(Number(d.pickup_lat)) &&
    Number.isFinite(Number(d.pickup_lng)) &&
    Number.isFinite(Number(d.drop_lat)) &&
    Number.isFinite(Number(d.drop_lng))
  );
}

/**
 * منطق إدراج طلبات السلة (نفس POST /api/checkout) مع خيار ربط الدفع بالـ delivery_status.
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {{ applyPaymentGate?: boolean }} [options]
 * @returns {Promise<{ ok: true, orders: any[] } | { ok: false, message: string, status?: number }>}
 */
async function runCheckoutInsert(sb, appUser, body, options) {
  if (!canPlaceOrders(appUser && appUser.role)) {
    return { ok: false, message: driverOrderPlacementError(), status: 403 };
  }
  const opts = options && typeof options === "object" ? options : {};
  const checkoutIdempotencyKey =
    opts.checkoutIdempotencyKey != null && String(opts.checkoutIdempotencyKey).trim() !== ""
      ? String(opts.checkoutIdempotencyKey).trim().slice(0, 256)
      : null;
  const usePaymentGate = Boolean(opts.applyPaymentGate) && isOrderPaymentGateRequired();
  const paymentConfirmed = useErvenowPay ? false : usePaymentGate ? isPaidFromRequestBody(body) : false;
  const allowDispatchPipeline = useErvenowPay ? true : usePaymentGate ? paymentConfirmed : true;
  const openDeliveryStatus = allowDispatchPipeline ? "pending" : "draft";
  const payment_status = useErvenowPay ? "pending" : paymentConfirmed ? "paid" : "pending";
  const payment_method = normalizeOrderPaymentMethod(body);
  const useErvenowPay = isErvenowPayMethod(payment_method);

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return { ok: false, message: "cart empty", status: 400 };
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
      const { runUnifiedDeliveryOnlyCreate } = require("../order/deliveryOrderCreateShared");
      for (let svcIdx = 0; svcIdx < groupItems.length; svcIdx += 1) {
        const it = groupItems[svcIdx];
        const data = it && typeof it.data === "object" && it.data ? it.data : {};
        const serviceType = String(it.type || "service").trim().toLowerCase();
        const total = Number(it.price) || Number(data.total_amount) || 0;
        const svcPaymentStatus = paymentConfirmed
          ? "paid"
          : String(data.payment_status || "").toLowerCase() === "paid"
            ? "paid"
            : "unpaid";

        if (GEO_DELIVERY_SERVICE_TYPES.has(serviceType) && cartItemHasGeoCoords(data)) {
          const unifiedType = serviceType === "vehicle_transfer" ? "car_transport" : serviceType;
          const unified = await runUnifiedDeliveryOnlyCreate({
            sb,
            appUser,
            body: {
              service_type: unifiedType,
              payload: {
                vehicle_category: data.vehicle_category,
                vehicle_condition: data.vehicle_condition,
                transfer_mode: data.transfer_mode,
                pickup_lat: Number(data.pickup_lat),
                pickup_lng: Number(data.pickup_lng),
                drop_lat: Number(data.drop_lat),
                drop_lng: Number(data.drop_lng),
                pickup_district_label: data.pickup_district_label,
                drop_district_label: data.drop_district_label,
                from_city: data.from_city,
                to_city: data.to_city,
                notes_extra: data.notes_extra,
              },
              customer_phone: String(data.customer_phone || appUser.phone || "").trim(),
              payment_status: svcPaymentStatus,
              paid: paymentConfirmed,
            },
            idempotencyKey: checkoutIdempotencyKey
              ? `${checkoutIdempotencyKey}:svc:${svcIdx}:${String(it.id || it.type || "item").slice(0, 32)}`
              : null,
            entryPoint: "order",
          });
          if (!unified.ok) {
            return { ok: false, message: unified.message, status: unified.status || 400 };
          }
          results.push(unified.order);
          continue;
        }

        const created = await createServiceOrder(sb, appUser, {
          order_type: "service",
          service_type: serviceType,
          service_name: String(it.title || labelByType(serviceType)).trim(),
          district: String(data.district || "").trim(),
          location: String(data.location || data.to || "").trim(),
          qty: normalizeQty(data.qty || 1),
          gas_mode: data.gas_mode || null,
          gas_liters: data.gas_liters != null ? Number(data.gas_liters) : null,
          total_amount: total,
          payment_status: svcPaymentStatus,
          data,
        });
        if (!created.ok) {
          return { ok: false, message: created.message, status: created.status || 400 };
        }
        results.push(created.order);
      }
      continue;
    }

    const total = groupItems.reduce((sum, i) => sum + (Number(i && i.price) || 0), 0);

    const storeIds = new Set(
      groupItems.map((i) => String((i.data && i.data.store_id) || "").trim()).filter(Boolean)
    );
    if (storeIds.size > 1) {
      return { ok: false, message: "يجب أن تكون منتجات السلة من متجر واحد", status: 400 };
    }
    const singleStoreId = storeIds.size === 1 ? [...storeIds][0] : null;
    let storeRowForCheckout = null;

    const orderPrefix = type === "store" ? "ES" : "ED";

    const row = {
      series_source: "ERVENOW",
      delivery_status: openDeliveryStatus,
      order_type: type === "store" ? "store" : type === "restaurant" ? "restaurant" : "delivery",
      order_total: total,
      total_amount: total,
      customer_id: appUser.id,
      customer_phone: String(
        appUser.phone || groupItems[0]?.data?.customer_phone || groupItems[0]?.customer_phone || ""
      ).trim(),
      breakdown: {
        items: groupItems,
        type,
        total,
      },
      notes: `Checkout group: ${type}`,
      payment_status,
      ...(payment_method ? { payment_method } : {}),
    };

    if (checkoutIdempotencyKey) {
      row.idempotency_key = `${checkoutIdempotencyKey}:${type}`;
    }

    let storeDispatchOverride = null;

    if (singleStoreId) {
      const { data: storeRow, error: storeErr } = await sb
        .from("stores")
        .select("*")
        .eq("id", singleStoreId)
        .eq("status", "approved")
        .maybeSingle();
      if (storeErr || !storeRow || storeRow.lat == null || storeRow.lng == null) {
        return { ok: false, message: "متجر غير متاح أو بلا موقع مسجّل", status: 400 };
      }

      if (useCartDeliverySnapshot(groupItems)) {
        const resolved = await resolveStoreCheckoutFromCartSnapshot(sb, groupItems, storeRow, total);
        if (!resolved.ok) {
          return { ok: false, message: resolved.message, status: resolved.status || 400 };
        }
        Object.assign(row, resolved.patch);
        row.platform_fee = computePlatformCommission(total);
        row.notes = `متجر: ${storeRow.name || singleStoreId}`;
        row.store_id = singleStoreId;
        row.store_name = String(storeRow.name || "").trim() || null;
        row.store_address = String(storeRow.address || storeRow.location_text || "").trim() || null;
        storeRowForCheckout = storeRow;
        storeDispatchOverride = resolved.shouldDispatch;
      } else {
        const custLat = Number(body.customer_lat);
        const custLng = Number(body.customer_lng);
        if (!Number.isFinite(custLat) || !Number.isFinite(custLng)) {
          return { ok: false, message: "حدد موقع التوصيل (GPS) لطلبات المتجر", status: 400 };
        }
        const slat = Number(storeRow.lat);
        const slng = Number(storeRow.lng);
        const km = await routeKmWithRoughFallback(slat, slng, custLat, custLng);
        const radius = Number(storeRow.delivery_radius_km) > 0 ? Number(storeRow.delivery_radius_km) : 5;
        if (!Number.isFinite(km) || km > radius) {
          return { ok: false, message: "هذا المتجر لا يغطي منطقتك", status: 400 };
        }
        const deliveryFee = Math.round(km * 2.3 * 100) / 100;
        const dropAddress =
          String(
            body.customer_address ||
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
        row.platform_fee = computePlatformCommission(total);
        row.notes = `متجر: ${storeRow.name || singleStoreId}`;
        row.store_id = singleStoreId;
        row.store_name = String(storeRow.name || "").trim() || null;
        row.store_address = String(storeRow.address || storeRow.location_text || "").trim() || null;
        storeRowForCheckout = storeRow;
        storeDispatchOverride = true;
      }
    } else if (type === "delivery") {
      const d0 =
        groupItems[0] && typeof groupItems[0].data === "object" && groupItems[0].data
          ? groupItems[0].data
          : {};
      const plat = Number(d0.pickup_lat);
      const plng = Number(d0.pickup_lng);
      const dlat = Number(d0.drop_lat);
      const dlng = Number(d0.drop_lng);
      if (Number.isFinite(plat) && Number.isFinite(plng) && Number.isFinite(dlat) && Number.isFinite(dlng)) {
        const deliveryFee =
          Number(d0.delivery_fee) >= 0 ? Number(d0.delivery_fee) : total;
        const isMapsLike = (s) =>
          /^(https?:\/\/)/i.test(String(s || "").trim()) ||
          /google\.com\/maps|maps\.app\.goo|goo\.gl\/maps/i.test(String(s || ""));
        const pickupLabel =
          String(d0.pickup_district_label || "").trim() ||
          (() => {
            const raw = String(d0.pickup_address || d0.from || "").trim();
            return raw && !isMapsLike(raw) ? raw : "";
          })();
        const dropLabel =
          String(d0.drop_district_label || "").trim() ||
          (() => {
            const raw = String(d0.drop_address || d0.to || d0.location || "").trim();
            return raw && !isMapsLike(raw) ? raw : "";
          })();
        row.pickup_address = pickupLabel || "موقع الاستلام";
        row.drop_address = dropLabel || "موقع التسليم";
        row.pickup_lat = plat;
        row.pickup_lng = plng;
        row.drop_lat = dlat;
        row.drop_lng = dlng;
        row.delivery_fee = Math.round(deliveryFee * 100) / 100;
        row.distance_km =
          Number(d0.distance_km) >= 0
            ? Math.round(Number(d0.distance_km) * 100) / 100
            : null;
        row.platform_fee =
          Number(d0.platform_fee) >= 0
            ? Math.round(Number(d0.platform_fee) * 100) / 100
            : computePlatformCommission(deliveryFee);
        row.driver_earning =
          Number(d0.driver_earning) >= 0
            ? Math.round(Number(d0.driver_earning) * 100) / 100
            : Math.round((deliveryFee - row.platform_fee) * 100) / 100;
        row.order_total = Math.round(deliveryFee * 100) / 100;
        row.total_amount = row.order_total;
        row.vehicle_type = String(d0.vehicle_type || "").trim() || null;
        const productLabel = String(d0.product_label || "").trim();
        row.notes = productLabel
          ? `توصيل من الخريطة | ${productLabel}`
          : "توصيل من الخريطة";
        row.data = Object.assign({}, row.data && typeof row.data === "object" ? row.data : {}, {
          source: d0.source || "dashboard_map",
          pickup_district_label: pickupLabel || null,
          drop_district_label: dropLabel || null,
          pickup_maps_url: d0.pickup_maps_url || null,
          drop_maps_url: d0.drop_maps_url || null,
          product_category: d0.product_category || null,
          product_qty: d0.product_qty != null ? d0.product_qty : null,
          product_label: productLabel || null,
          distance_km: row.distance_km,
          delivery_fee: row.delivery_fee,
        });
      }
    }

    row.breakdown = Object.assign({}, row.breakdown, singleStoreId ? { store_id: singleStoreId } : {});

    if (row.idempotency_key && appUser.id) {
      try {
        const existing = await fetchOrderByCustomerIdempotencyKey(sb, appUser.id, row.idempotency_key);
        if (existing) {
          results.push(existing);
          continue;
        }
      } catch (e) {
        logger.warn({ err: e.message || String(e) }, "[checkout] idempotency lookup");
      }
    }

    try {
      const similar = await findRecentSimilarDeliveryOrder(sb, appUser.id, row);
      if (similar) {
        results.push(similar);
        continue;
      }
    } catch (e) {
      logger.warn({ err: e.message || String(e) }, "[checkout] recent-duplicate lookup");
    }

    let data = null;
    let insertErr = null;
    for (let insAttempt = 0; insAttempt < 5; insAttempt += 1) {
      row.order_number = await allocateUniqueOrderNumber(sb, orderPrefix);
      const insertRow = normalizeOrderFinancialsForInsert(row);
      const ins = await insertOrdersResilient(sb, insertRow);
      data = ins.data;
      insertErr = ins.error;
      if (!insertErr) break;
      const msg = String(insertErr.message || insertErr.details || "");
      const dup =
        String(insertErr.code || "") === "23505" ||
        /duplicate key|unique constraint/i.test(msg);
      if (isIdempotencyKeyUniqueViolation(insertErr) && row.idempotency_key && appUser.id) {
        const existing = await fetchOrderByCustomerIdempotencyKey(sb, appUser.id, row.idempotency_key);
        if (existing) {
          data = existing;
          insertErr = null;
          break;
        }
      }
      if (!dup || insAttempt === 4) throw insertErr;
    }
    if (insertErr) throw insertErr;
    results.push(data);

    if (type === "store" && data?.store_id && storeRowForCheckout) {
      try {
        await runStoreCheckoutSideEffects({ order: data, groupItems, storeRow: storeRowForCheckout });
      } catch (sideErr) {
        logger.error(
          { err: sideErr && (sideErr.message || String(sideErr)), orderId: data.id },
          "[checkout/service] store post-checkout"
        );
      }
      try {
        const digits = String(storeRowForCheckout.phone || "").replace(/\D/g, "");
        if (digits) {
          const { data: merchantUser } = await sb
            .from("users")
            .select("id, role")
            .eq("phone", digits)
            .maybeSingle();
          if (merchantUser && merchantUser.id) {
            await createNotification(sb, {
              recipient_type: "store",
              recipient_id: merchantUser.id,
              title: "طلب جديد",
              message: "لديك طلب جديد بانتظار المعالجة.",
              type: "order",
              source: "store",
              payload: {
                order_id: data.id,
                order_number: data.order_number || null,
                store_id: data.store_id || null,
              },
            });
          }
        }
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr.message || String(notifyErr), orderId: data.id },
          "[checkout/service] store notification"
        );
      }
    }

    const shouldDispatch =
      openDeliveryStatus === "pending" &&
      (type === "delivery" || (singleStoreId && storeDispatchOverride !== false));
    if (shouldDispatch) {
      try {
        await enqueueDeliveryJob("checkout-dispatch", {
          orderId: data.id,
          groupItems,
          total,
          appUserPhone: appUser?.phone || "",
        });
      } catch (queueErr) {
        logger.error(
          { err: queueErr && (queueErr.message || String(queueErr)), orderId: data.id },
          "[checkout/service] enqueue checkout-dispatch"
        );
      }
    }
  }

  if (useErvenowPay && results.length) {
    const payResult = await applyErvenowPayForCheckoutOrders(sb, appUser.id, results);
    if (!payResult.ok) {
      return {
        ok: false,
        message: payResult.message || "رصيد المحفظة غير كافٍ",
        status: payResult.reason === "insufficient_balance" ? 402 : 400,
        balance: payResult.balance,
        required: payResult.required,
      };
    }
    for (const order of results) {
      const oid = order && order.id;
      if (!oid) continue;
      try {
        await sb
          .from("orders")
          .update({
            payment_status: "paid",
            payment_method: "ew_pay",
            updated_at: new Date().toISOString(),
          })
          .eq("id", oid);
        order.payment_status = "paid";
        order.payment_method = "ew_pay";
      } catch (upErr) {
        logger.error(
          { err: upErr && (upErr.message || String(upErr)), orderId: oid },
          "[checkout] ew_pay payment_status update"
        );
      }
    }
  }

  return { ok: true, orders: results };
}

module.exports = { runCheckoutInsert, normalizedGroup };
