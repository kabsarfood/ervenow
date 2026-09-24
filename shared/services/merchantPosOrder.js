/**
 * طلب كاشير يسجّله موظف المتجر داخل جدول orders نفسه.
 * المصدر pos. لا يفتح دورة مندوب ولا يمس المحفظة.
 */

const { applyPortalTypeToOrderRow } = require("../utils/orderPortalRouting");
const { normalizeOrderFinancialsForInsert } = require("../utils/orderTotals");
const { parseMissingOrdersColumnFromError } = require("../utils/idempotency");

const VAT_RATE = 0.15;

const FULFILLMENTS = Object.freeze({
  local: "محلي",
  pickup: "استلام",
  delivery: "توصيل",
});

const PAYMENTS = Object.freeze({
  cash: Object.freeze({ method: "cash", label: "نقدي" }),
  network: Object.freeze({ method: "mada", label: "شبكة" }),
  electronic: Object.freeze({ method: "ew_pay", label: "دفع إلكتروني" }),
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function unitPrice(product) {
  const price = Number(product && product.price);
  const offer = Number(product && product.offer_price);
  if (!Number.isFinite(price) || price < 0) return null;
  if (Number.isFinite(offer) && offer > 0 && offer < price) return round2(offer);
  return round2(price);
}

function preparePosTicket(opts) {
  const input = opts && typeof opts === "object" ? opts : {};
  const fulfillment = String(input.fulfillment || "")
    .trim()
    .toLowerCase();
  if (!FULFILLMENTS[fulfillment]) return { ok: false, status: 400, message: "نوع الطلب غير صالح" };

  const payKey = String(input.payment || "")
    .trim()
    .toLowerCase();
  const pay = PAYMENTS[payKey];
  if (!pay) return { ok: false, status: 400, message: "طريقة الدفع غير صالحة" };

  const products = Array.isArray(input.products) ? input.products : [];
  const byId = {};
  products.forEach(function (product) {
    if (product && product.id != null) byId[String(product.id)] = product;
  });

  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) return { ok: false, status: 400, message: "الطلب فارغ" };

  const qtyById = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || {};
    const id = String(line.product_id || line.id || "").trim();
    const qty = Math.round(Number(line.qty));
    if (!id || !Number.isFinite(qty) || qty < 1 || qty > 99) {
      return { ok: false, status: 400, message: "كمية غير صالحة" };
    }
    qtyById[id] = (qtyById[id] || 0) + qty;
    if (qtyById[id] > 99) return { ok: false, status: 400, message: "كمية غير صالحة" };
  }

  const items = [];
  const ids = Object.keys(qtyById);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const product = byId[id];
    if (!product || product.active === false) {
      return { ok: false, status: 400, message: "منتج غير متاح في كتالوج المتجر" };
    }
    const unit = unitPrice(product);
    if (unit == null) return { ok: false, status: 400, message: "سعر المنتج غير صالح" };
    const qty = qtyById[id];
    items.push({
      product_id: id,
      name: String(product.name || "").trim() || "منتج",
      qty: qty,
      unit_price: unit,
      line_total: round2(unit * qty),
    });
  }

  const subtotal = round2(items.reduce(function (sum, item) {
    return sum + item.line_total;
  }, 0));
  const vat = round2(subtotal * VAT_RATE);
  return {
    ok: true,
    items: items,
    subtotal: subtotal,
    vat: vat,
    total: round2(subtotal + vat),
    fulfillment: fulfillment,
    payment_method: pay.method,
    payment_channel: payKey,
  };
}

function buildPosInsertRow(appUser, store, ticket, snapshot) {
  const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
  const address =
    String(snap.store_address || store.address || store.location_text || store.name || "داخل المتجر").trim() ||
    "داخل المتجر";
  const orderType = String(store.type || "").toLowerCase() === "restaurant" ? "restaurant" : "store";
  return {
    customer_id: appUser.id,
    customer_phone: appUser.phone || store.phone || "",
    pickup_address: address,
    drop_address: address,
    notes: "طلب كاشير",
    delivery_status: "delivered",
    delivery_fee: 0,
    platform_fee: 0,
    driver_earning: 0,
    order_total: ticket.subtotal,
    vat_amount: ticket.vat,
    total_with_vat: ticket.total,
    total_amount: ticket.total,
    payment_status: "paid",
    payment_method: ticket.payment_method,
    series_source: "pos",
    order_type: orderType,
    store_id: store.id,
    store_name: snap.store_name || store.name || null,
    store_address: snap.store_address || address,
    breakdown: { items: ticket.items },
    data: {
      order_source: "pos",
      fulfillment: ticket.fulfillment,
      payment_channel: ticket.payment_channel,
      items: ticket.items,
      breakdown: { items: ticket.items },
    },
  };
}

async function insertPosOrder(sb, appUser, store, ticket) {
  const { buildNextDeliveryOrderNumber, resolveStoreSnapshotForOrder } = require("../../apps/delivery/service");
  const { broadcastStoreOrderEvent, orderPatchFromRow } = require("../lib/trackingSocket");
  const snapshot = await resolveStoreSnapshotForOrder(sb, store.id);
  const base = buildPosInsertRow(appUser, store, ticket, snapshot);
  let row = Object.assign({}, base);
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    row.order_number = await buildNextDeliveryOrderNumber(sb);
    const insertRow = applyPortalTypeToOrderRow(normalizeOrderFinancialsForInsert(row));
    const ins = await sb.from("orders").insert(insertRow).select("*").maybeSingle();
    if (!ins.error && ins.data) {
      try {
        const patch = orderPatchFromRow(ins.data);
        broadcastStoreOrderEvent(String(store.id), {
          orderId: String(ins.data.id),
          store_id: store.id,
          series_source: "pos",
          patch: Object.assign({}, patch, {
            series_source: "pos",
            delivery_status: ins.data.delivery_status,
            order_total: ins.data.order_total,
          }),
        });
      } catch (_) {
        /* البث لا يلغي حفظ الطلب */
      }
      return ins.data;
    }
    lastError = ins.error || new Error("تعذر حفظ طلب الكاشير");
    const missing = parseMissingOrdersColumnFromError(lastError);
    const dup = String(lastError.code || "") === "23505" || /duplicate key|unique constraint/i.test(String(lastError.message || ""));
    if (missing && Object.prototype.hasOwnProperty.call(row, missing)) {
      delete row[missing];
      if (missing === "data" && row.notes) row.notes = "طلب كاشير";
      continue;
    }
    if (dup) continue;
    break;
  }

  const err = new Error((lastError && lastError.message) || "تعذر حفظ طلب الكاشير");
  err.cause = lastError;
  throw err;
}

module.exports = {
  VAT_RATE,
  FULFILLMENTS,
  PAYMENTS,
  unitPrice,
  preparePosTicket,
  buildPosInsertRow,
  insertPosOrder,
};
