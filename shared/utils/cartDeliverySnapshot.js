/**
 * ERVENOW DELIVERY ENGINE 1.0 — snapshot التوصيل داخل item.data والسلة.
 */

const { roundMoney } = require("./platformCommission");

function isDeliveryEngineCartData(d) {
  return !!(d && d.delivery_snapshot_version === 1);
}

function cartHasStoreProducts(cart) {
  return (cart || []).some(function (i) {
    const d = i && i.data;
    return d && d.store_id && d.product_id != null;
  });
}

/** رسوم توصيل واحدة لكل السلة (أول سطر يحمل quote؛ عند التعدد نأخذ الأعلى إن اختلفت) */
function resolveCartDeliveryFeeFromItems(cart) {
  var fee = 0;
  var seen = false;
  (cart || []).forEach(function (it) {
    var d = it && it.data;
    if (!d || !d.store_id) return;
    if (d.fulfillment_mode === "pickup") return;
    if (d.delivery_free || d.includes_delivery) {
      seen = true;
      fee = 0;
      return;
    }
    if (Number.isFinite(Number(d.delivery_fee))) {
      seen = true;
      fee = Math.max(fee, roundMoney(Number(d.delivery_fee)));
    }
  });
  if (!seen && cartHasStoreProducts(cart)) return undefined;
  return fee;
}

function primaryDeliverySnapshot(cart) {
  for (var i = 0; i < (cart || []).length; i++) {
    var d = cart[i] && cart[i].data;
    if (d && d.store_id && d.delivery_snapshot_version === 1) return d;
  }
  return null;
}

function fulfillmentLabelAr(mode) {
  var m = String(mode || "").toLowerCase();
  if (m === "pickup") return "استلام من المتجر";
  if (m === "store_delivery") return "توصيل بواسطة المتجر";
  if (m === "ervenow_delivery") return "توصيل بواسطة ERVENOW";
  return "—";
}

function buildCartLineDeliveryHtml(d) {
  if (!d || !d.store_id) return "";
  var parts = [];
  parts.push("<div class=\"lp-cart-line__delivery\">");
  parts.push(
    '<span class="lp-cart-line__delivery-row">🚚 ' +
      fulfillmentLabelAr(d.fulfillment_mode) +
      "</span>"
  );
  if (d.fulfillment_mode !== "pickup") {
    if (d.drop_address) {
      parts.push('<span class="lp-cart-line__delivery-row">📍 ' + escapeHtml(d.drop_address) + "</span>");
    }
    if (Number.isFinite(Number(d.distance_km))) {
      parts.push(
        '<span class="lp-cart-line__delivery-row">📏 ' +
          Number(d.distance_km).toFixed(1) +
          " كم</span>"
      );
    }
    if (d.eta_minutes != null && Number.isFinite(Number(d.eta_minutes))) {
      parts.push('<span class="lp-cart-line__delivery-row">⏱️ ' + Number(d.eta_minutes) + " دقيقة</span>");
    }
    if (d.delivery_free || d.includes_delivery) {
      parts.push('<span class="lp-cart-line__delivery-row lp-cart-line__delivery-row--free">🎁 التوصيل مجاني</span>');
    } else if (Number.isFinite(Number(d.delivery_fee))) {
      parts.push(
        '<span class="lp-cart-line__delivery-row">💰 رسوم التوصيل: ' +
          Number(d.delivery_fee).toFixed(2) +
          " ر.س</span>"
      );
    }
  }
  parts.push("</div>");
  return parts.join("");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function assertCompatibleDeliverySnapshot(existingCart, newSnapshot) {
  var snap = newSnapshot || {};
  if (!existingCart || !existingCart.length) return { ok: true };
  var sid = String(snap.store_id || "");
  for (var i = 0; i < existingCart.length; i++) {
    var d = existingCart[i] && existingCart[i].data;
    if (!d || !d.store_id) continue;
    if (String(d.store_id) !== sid) {
      return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين" };
    }
    if (d.delivery_snapshot_version === 1 && snap.delivery_snapshot_version === 1) {
      if (d.fulfillment_mode !== snap.fulfillment_mode) {
        return { ok: false, message: "نوع الاستلام/التوصيل يجب أن يكون موحّداً لكل المنتجات" };
      }
      if (
        d.fulfillment_mode !== "pickup" &&
        snap.fulfillment_mode !== "pickup" &&
        (Math.abs(Number(d.drop_lat) - Number(snap.drop_lat)) > 0.0001 ||
          Math.abs(Number(d.drop_lng) - Number(snap.drop_lng)) > 0.0001)
      ) {
        return { ok: false, message: "موقع التوصيل يجب أن يكون واحداً لكل المنتجات في السلة" };
      }
    }
  }
  return { ok: true };
}

module.exports = {
  isDeliveryEngineCartData,
  cartHasStoreProducts,
  resolveCartDeliveryFeeFromItems,
  primaryDeliverySnapshot,
  fulfillmentLabelAr,
  buildCartLineDeliveryHtml,
  assertCompatibleDeliverySnapshot,
};
