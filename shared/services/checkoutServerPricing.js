/**
 * P0-04 — تسعير السلة من الخادم فقط.
 * يُتجاهل item.price / subtotal / discount / delivery_fee القادمة من العميل.
 */

const { computePlatformCommission, roundMoney } = require("../utils/platformCommission");
const { getOsrmRouteKmOrHaversine } = require("../utils/osrmClient");
const { isHomeServiceType, computeHomeServiceTotal, normalizeServiceType } = require("../utils/homeServicePricing");
const { computeCarPolishingBreakdown, carPolishingFromPayload } = require("../utils/carPolishingPricing");
const { computeGasTotal } = require("../utils/gasDeliveryPricing");

function normalizeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.min(99, Math.floor(n)));
}

function effectiveCatalogUnitPrice(row) {
  const price = Number(row && row.price);
  const offer = Number(row && row.offer_price);
  if (Number.isFinite(offer) && offer > 0 && Number.isFinite(price) && offer < price) {
    return roundMoney(offer);
  }
  if (Number.isFinite(price) && price >= 0) return roundMoney(price);
  return null;
}

function isProductActive(row) {
  if (!row) return false;
  if (row.active === false || row.active === "false" || row.active === 0) return false;
  return true;
}

/**
 * Business rule: السعر الحالي في الكتالوج (بما فيه offer_price إن وُجد وأقل من السعر).
 * التلاعب بـ item.price لا يغيّر الإجمالي.
 */
async function repriceStoreCartItems(sb, storeId, groupItems) {
  const sid = String(storeId || "").trim();
  if (!sid) return { ok: false, message: "متجر غير محدد", status: 400 };
  const items = Array.isArray(groupItems) ? groupItems : [];
  const productIds = [];
  for (const it of items) {
    const pid = String((it && it.data && it.data.product_id) || it.product_id || "").trim();
    if (!pid) {
      return { ok: false, message: "منتج غير صالح في السلة — حدّث السلة", status: 400 };
    }
    productIds.push(pid);
  }
  const uniqueIds = [...new Set(productIds)];
  const catalogSelectWithDelivery = "id, store_id, price, offer_price, active, name, includes_delivery";
  const catalogSelectCore = "id, store_id, price, offer_price, active, name";
  let { data, error } = await sb
    .from("store_products")
    .select(catalogSelectWithDelivery)
    .eq("store_id", sid)
    .in("id", uniqueIds);

  if (error && /includes_delivery/i.test(String(error.message || ""))) {
    ({ data, error } = await sb
      .from("store_products")
      .select(catalogSelectCore)
      .eq("store_id", sid)
      .in("id", uniqueIds));
  }

  if (error) {
    return { ok: false, message: error.message || "تعذر تحميل أسعار المنتجات", status: 400 };
  }

  const byId = new Map();
  for (const row of data || []) {
    byId.set(String(row.id), row);
  }

  const pricedItems = [];
  let goodsTotal = 0;
  let includesDelivery = false;

  for (const it of items) {
    const dataObj = it && typeof it.data === "object" && it.data ? { ...it.data } : {};
    const pid = String(dataObj.product_id || it.product_id || "").trim();
    const row = byId.get(pid);
    if (!row || String(row.store_id) !== sid) {
      return { ok: false, message: "منتج غير متاح — حدّث السلة", status: 400 };
    }
    if (!isProductActive(row)) {
      return { ok: false, message: "منتج غير متاح للطلب حالياً", status: 400 };
    }
    const unit = effectiveCatalogUnitPrice(row);
    if (unit == null) {
      return { ok: false, message: "سعر المنتج غير صالح", status: 400 };
    }
    const qty = normalizeQty(dataObj.qty != null ? dataObj.qty : it.qty);
    const lineTotal = roundMoney(unit * qty);
    goodsTotal = roundMoney(goodsTotal + lineTotal);
    if (row.includes_delivery) includesDelivery = true;
    dataObj.qty = qty;
    dataObj.product_id = pid;
    dataObj.store_id = sid;
    dataObj.unit_price = unit;
    dataObj.line_total = lineTotal;
    dataObj.price_source = "server_catalog";
    if (row.includes_delivery) dataObj.includes_delivery = true;
    pricedItems.push({
      type: it.type,
      title: it.title || row.name || "",
      price: lineTotal,
      data: dataObj,
    });
  }

  return {
    ok: true,
    goodsTotal,
    pricedItems,
    includesDelivery,
  };
}

function repriceServiceCartItem(item) {
  const it = item && typeof item === "object" ? item : {};
  const data = it.data && typeof it.data === "object" ? it.data : {};
  const serviceType = normalizeServiceType(it.type || data.service_type || "service");
  const qty = normalizeQty(data.qty || data.service_qty || 1);

  if (serviceType === "car_polishing") {
    const input = carPolishingFromPayload({ ...it, data });
    const br = computeCarPolishingBreakdown(input);
    if (!(br.total > 0) || !br.vehicle_type) {
      return { ok: false, message: "بيانات تلميع المركبة غير مكتملة", status: 400 };
    }
    return { ok: true, total: br.total, serviceType, data: { ...data, ...input, qty, price_source: "server_catalog" } };
  }

  if (serviceType === "gas_delivery") {
    const total = computeGasTotal(data.gas_mode, data.qty || data.service_qty || qty, data.gas_liters);
    if (!(total > 0)) {
      return { ok: false, message: "تعذر تسعير طلب الغاز", status: 400 };
    }
    return { ok: true, total, serviceType, data: { ...data, qty, price_source: "server_catalog" } };
  }

  if (isHomeServiceType(serviceType)) {
    const unit = computeHomeServiceTotal(serviceType);
    const total = roundMoney(unit * qty);
    return { ok: true, total, serviceType, data: { ...data, qty, price_source: "server_catalog" } };
  }

  return { ok: false, message: "نوع خدمة غير مدعوم للتسعير", status: 400 };
}

function calcDeliveryBaseFeeLocal(distanceKm, vehicleType) {
  const km = Number(distanceKm) || 0;
  const s = String(vehicleType || "")
    .trim()
    .toLowerCase();
  const isBike = ["bike", "bicycle", "motorbike", "motorcycle", "دراجة", "دباب"].includes(s);
  if (km <= 7) return isBike ? 15 : 22;
  return roundMoney(km * 2.3);
}

async function repriceDeliveryOnlyFromCoords(data) {
  const d = data && typeof data === "object" ? data : {};
  const plat = Number(d.pickup_lat);
  const plng = Number(d.pickup_lng);
  const dlat = Number(d.drop_lat);
  const dlng = Number(d.drop_lng);
  if (![plat, plng, dlat, dlng].every(Number.isFinite)) {
    return { ok: false, message: "إحداثيات التوصيل ناقصة", status: 400 };
  }
  const km = await getOsrmRouteKmOrHaversine({ lat: plat, lng: plng }, { lat: dlat, lng: dlng });
  if (!Number.isFinite(km) || km < 0) {
    return { ok: false, message: "تعذر حساب مسافة التوصيل", status: 400 };
  }
  const deliveryFee = calcDeliveryBaseFeeLocal(km, d.vehicle_type);
  const platformFee = computePlatformCommission(deliveryFee);
  const driverEarning = roundMoney(Math.max(0, deliveryFee - platformFee));
  return {
    ok: true,
    distance_km: roundMoney(km),
    delivery_fee: deliveryFee,
    platform_fee: platformFee,
    driver_earning: driverEarning,
    order_total: deliveryFee,
  };
}

module.exports = {
  normalizeQty,
  effectiveCatalogUnitPrice,
  repriceStoreCartItems,
  repriceServiceCartItem,
  repriceDeliveryOnlyFromCoords,
  calcDeliveryBaseFeeLocal,
};
