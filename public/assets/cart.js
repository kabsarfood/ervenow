var CART_STORE_VERSION = 2;
var ERV_DELIVERY_LOC_KEY = "ervenow:delivery-location";
var ERV_CART_PAYMENT_KEY = "erv_cart_payment_method";
var __ervCartStoreCache = null;

function emptyCartStore() {
  return { version: CART_STORE_VERSION, items: [], delivery: {}, payment: {}, totals: {} };
}

function readLegacyDeliveryLocRaw() {
  try {
    var raw = localStorage.getItem(ERV_DELIVERY_LOC_KEY);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    var lat = Number(o.lat);
    var lng = Number(o.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat: lat,
      lng: lng,
      address: String(o.address || o.drop_address || "").trim(),
      fulfillment_mode: o.fulfillment_mode || null,
      store_id: o.store_id || null,
      maps_url: o.maps_url || o.drop_maps_url || null,
      saved_at: o.saved_at || Date.now(),
    };
  } catch (_e) {
    return null;
  }
}

function deliveryLocToStore(loc) {
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return {};
  return {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    address: String(loc.address || loc.drop_address || "").trim(),
    fulfillment_mode: loc.fulfillment_mode || null,
    store_id: loc.store_id || null,
    maps_url: loc.maps_url || loc.drop_maps_url || null,
    saved_at: loc.saved_at || Date.now(),
  };
}

function deliveryStoreToLoc(d) {
  if (!d || typeof d !== "object" || !Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lng))) return null;
  return {
    lat: Number(d.lat),
    lng: Number(d.lng),
    address: String(d.address || "").trim(),
    fulfillment_mode: d.fulfillment_mode || null,
    store_id: d.store_id || null,
    maps_url: d.maps_url || null,
  };
}

function migrateLegacyCartToStore(parsed) {
  var store = emptyCartStore();
  if (Array.isArray(parsed)) {
    store.items = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
    store.items = parsed.items.slice();
    if (parsed.delivery && typeof parsed.delivery === "object") store.delivery = parsed.delivery;
    if (parsed.payment && typeof parsed.payment === "object") store.payment = parsed.payment;
    if (parsed.totals && typeof parsed.totals === "object") store.totals = parsed.totals;
    return store;
  }
  var leg = readLegacyDeliveryLocRaw();
  if (leg) store.delivery = deliveryLocToStore(leg);
  try {
    var pay = localStorage.getItem(ERV_CART_PAYMENT_KEY);
    if (pay) store.payment = { method: String(pay) };
  } catch (_e2) {}
  if (
    typeof window !== "undefined" &&
    typeof window.__ervCartDeliveryFee === "number" &&
    Number.isFinite(window.__ervCartDeliveryFee)
  ) {
    store.totals.deliveryFee = window.__ervCartDeliveryFee;
  }
  return store;
}

function readCartStore() {
  if (__ervCartStoreCache) return __ervCartStoreCache;
  try {
    var raw = localStorage.getItem("cart");
    if (!raw) {
      __ervCartStoreCache = emptyCartStore();
      return __ervCartStoreCache;
    }
    var parsed = JSON.parse(raw);
    if (parsed && parsed.version === CART_STORE_VERSION && Array.isArray(parsed.items)) {
      __ervCartStoreCache = parsed;
      return __ervCartStoreCache;
    }
    __ervCartStoreCache = migrateLegacyCartToStore(parsed);
    writeCartStore(__ervCartStoreCache);
    return __ervCartStoreCache;
  } catch (_e3) {
    __ervCartStoreCache = emptyCartStore();
    return __ervCartStoreCache;
  }
}

function writeCartStore(store) {
  __ervCartStoreCache = store;
  try {
    localStorage.setItem("cart", JSON.stringify(store));
  } catch (_e4) {}
  updateCartCount();
}

function clearCartStoreCompletely() {
  __ervCartStoreCache = null;
  writeCartStore(emptyCartStore());
  try {
    localStorage.removeItem(ERV_DELIVERY_LOC_KEY);
  } catch (_e5) {}
  try {
    localStorage.removeItem(ERV_CART_PAYMENT_KEY);
  } catch (_e6) {}
  delete window.__ervCartDeliveryFee;
  delete window.__ervCartPendingGeo;
  delete window.__ervCartSelectedPayment;
}

function getCart() {
  return readCartStore().items.slice();
}

function saveCart(cart) {
  var store = readCartStore();
  store.items = cart;
  writeCartStore(store);
}

/** معرفات المتاجر الموجودة في السلة (سلة واحدة — لا خلط بين متاجر) */
function getCartStoreIds() {
  const ids = new Set();
  getCart().forEach(function (i) {
    var sid = i && i.data && i.data.store_id;
    if (sid) ids.add(String(sid));
  });
  return ids;
}

function findStoreProductLineIndex(cart, storeId, productId) {
  return cart.findIndex(function (i) {
    var d = i && i.data;
    return (
      d &&
      String(d.store_id) === String(storeId) &&
      d.product_id != null &&
      String(d.product_id) === String(productId)
    );
  });
}

function isMapDeliveryCartItem(item) {
  var d = item && item.data;
  if (!d || typeof d !== "object") return false;
  if (String(d.source || "") === "dashboard_map") return true;
  return (
    String(item.type || "") === "delivery" &&
    Number.isFinite(Number(d.pickup_lat)) &&
    Number.isFinite(Number(d.drop_lat))
  );
}

function addToCart(item) {
  const cart = getCart();
  if (isMapDeliveryCartItem(item)) {
    for (var mi = cart.length - 1; mi >= 0; mi -= 1) {
      if (isMapDeliveryCartItem(cart[mi])) cart.splice(mi, 1);
    }
  }
  var newSid = item && item.data && item.data.store_id ? String(item.data.store_id).trim() : "";
  if (newSid) {
    var existingIds = getCartStoreIds();
    if (existingIds.size > 0 && !existingIds.has(newSid)) {
      alert("لا يمكن خلط منتجات من متجرين مختلفين. أفرغ السلة أو أتمّم الطلب أولاً.");
      return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين" };
    }
  }

  var pid = item && item.data && item.data.product_id;
  if (newSid && pid != null && pid !== "") {
    var idx = findStoreProductLineIndex(cart, newSid, pid);
    if (idx >= 0) {
      var cur = cart[idx];
      var addQty = Math.max(1, Math.min(99, Number(item.data && item.data.qty) || 1));
      var unit =
        Number(item.data && item.data.unit_price) ||
        Number(cur.data && cur.data.unit_price) ||
        (Number(cur.price) || 0) / Math.max(1, Number(cur.data && cur.data.qty) || 1);
      if (!Number.isFinite(unit) || unit < 0) unit = 0;
      var newQty = Math.min(99, (Number(cur.data && cur.data.qty) || 1) + addQty);
      cart[idx] = Object.assign({}, cur, {
        price: unit * newQty,
        data: Object.assign({}, cur.data || {}, item.data || {}, { qty: newQty, unit_price: unit }),
      });
      saveCart(cart);
      var mergedLoc = locationFromCartItemData(cart[idx].data);
      if (mergedLoc) saveDeliveryLocation(mergedLoc);
      return { ok: true };
    }
  }

  const exists = cart.find(
    (i) =>
      i.type === item.type &&
      i.title === item.title &&
      JSON.stringify(i.data || {}) === JSON.stringify(item.data || {})
  );
  if (exists) {
    alert("تمت إضافة هذا العنصر مسبقًا");
    return { ok: false, message: "تمت إضافة هذا العنصر مسبقًا" };
  }
  var dataIn = item.data && typeof item.data === "object" ? Object.assign({}, item.data) : {};
  var initQty = 1;
  if (isMapDeliveryCartItem(item)) {
    initQty = 1;
    if (dataIn.product_qty == null && dataIn.qty != null) {
      dataIn.product_qty = dataIn.qty;
    }
    dataIn.qty = 1;
  } else {
    initQty = Math.max(1, Math.min(99, Number(dataIn.qty) || 1));
  }
  var unitFromItem =
    Number(dataIn.unit_price) ||
    (Number(item.price) && initQty > 0 ? Number(item.price) / initQty : 0);
  var line = {
    id: Date.now(),
    type: item.type,
    title: item.title,
    price: Number(item.price) || 0,
    data: Object.assign({}, dataIn, {
      qty: initQty,
      unit_price: Number.isFinite(unitFromItem) && unitFromItem > 0 ? unitFromItem : undefined,
    }),
  };
  if (item.customer_phone) line.customer_phone = String(item.customer_phone).trim();
  if (item.payment_status) line.payment_status = item.payment_status;
  cart.push(line);
  saveCart(cart);
  var addedLoc = locationFromCartItemData(line.data);
  if (addedLoc) saveDeliveryLocation(addedLoc);
  return { ok: true };
}

function removeFromCart(id) {
  const cart = getCart().filter((i) => String(i.id) !== String(id));
  saveCart(cart);
}

function updateCartCount() {
  const el = document.getElementById("cartCount");
  const cart = getCart();
  const n = cart.reduce(function (sum, i) {
    return sum + (Number(i.data && i.data.qty) || 1);
  }, 0);
  if (el) el.textContent = String(n);
  try {
    renderHeaderCartPreview();
  } catch (e) {}
  try {
    if (
      (document.getElementById("cartList") || document.getElementById("lpCartLines")) &&
      typeof renderCartPage === "function"
    )
      renderCartPage();
  } catch (e2) {}
}

/** أنواع طلبات التوصيل في السلة (browse) */
var ERV_DELIVERY_TYPES = {
  delivery: 1,
  vehicle_transfer: 1,
  car_transport: 1,
  internal_delivery: 1,
  pickup_truck: 1,
  furniture_move: 1,
  gas_delivery: 1,
  car_polishing: 1,
};

function cartLineKind(item) {
  var d = item && item.data;
  if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return "product";
  var t = String((item && item.type) || "");
  if (ERV_DELIVERY_TYPES[t]) return "delivery";
  return "service";
}

function escCartHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function cartItemQty(item) {
  if (isMapDeliveryCartItem(item)) return 1;
  return Math.max(1, Math.min(99, Number(item.data && item.data.qty) || 1));
}

function shortMapsLabel(urlOrText) {
  var s = String(urlOrText || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      var u = new URL(s);
      if (u.searchParams.get("q")) return "خريطة: " + u.searchParams.get("q").slice(0, 48);
      return "رابط خريطة";
    } catch (e) {
      return "رابط خريطة";
    }
  }
  return s.length > 56 ? s.slice(0, 53) + "…" : s;
}

function cartTotalPieceCount(cart) {
  return (cart || []).reduce(function (sum, i) {
    return sum + cartItemQty(i);
  }, 0);
}

function cartLineImageUrl(item) {
  var d = (item && item.data) || {};
  var u = d.image_url || d.thumb_url || d.product_image || "";
  if (!u && Array.isArray(d.image_urls) && d.image_urls.length) u = d.image_urls[0];
  u = String(u || "").trim();
  if (u && w.PlatformAPI && typeof w.PlatformAPI.mediaUrl === "function") {
    u = w.PlatformAPI.mediaUrl(u);
  }
  return u;
}

function cartLineThumbInner(item, kind) {
  var url = cartLineImageUrl(item);
  if (url) {
    return (
      '<img class="lp-cart-line__thumb-img" src="' +
      escCartHtml(url) +
      '" alt="" loading="lazy" decoding="async" />'
    );
  }
  var thumbIcon = { product: "🛍", delivery: "🚚", service: "⚡" };
  return (
    '<span class="lp-cart-line__thumb-icon" aria-hidden="true">' + (thumbIcon[kind] || "📦") + "</span>"
  );
}

/** سطر واحد — يُستخدم في لوحة الهيدر وصفحة السلة (ERVENOW CART UX 2.0) */
function renderCartLineHtml(item) {
  var kind = cartLineKind(item);
  var kindLabel = { product: "منتج", delivery: "توصيل", service: "خدمة" };
  var data = item.data || {};
  var qty = cartItemQty(item);
  var metaBits = [];
  if (kind === "product") {
    if (data.unit_price != null && Number.isFinite(Number(data.unit_price)))
      metaBits.push("الوحدة: " + Number(data.unit_price).toFixed(2) + " ر.س");
  } else {
    if (data.product_label) {
      metaBits.push("المحتوى: " + escCartHtml(data.product_label));
    } else if (data.product_category) {
      var pq = data.product_qty != null ? data.product_qty : data.qty;
      metaBits.push(
        "المحتوى: " +
          escCartHtml(String(data.product_category)) +
          (pq ? " × " + escCartHtml(String(pq)) : "")
      );
    }
    if (data.pickup_maps_url || data.drop_maps_url) {
      if (data.pickup_maps_url)
        metaBits.push("الاستلام: " + escCartHtml(shortMapsLabel(data.pickup_maps_url)));
      if (data.drop_maps_url)
        metaBits.push("التسليم: " + escCartHtml(shortMapsLabel(data.drop_maps_url)));
    } else if (data.from && data.to) {
      metaBits.push(
        "من " + escCartHtml(shortMapsLabel(data.from)) + " → " + escCartHtml(shortMapsLabel(data.to))
      );
    } else if (data.district) metaBits.push("الحي: " + escCartHtml(data.district));
    if (data.location && !data.drop_maps_url) metaBits.push("تفاصيل: " + escCartHtml(data.location));
    if (data.distance_km != null && Number.isFinite(Number(data.distance_km))) {
      metaBits.push("المسافة: " + escCartHtml(Number(data.distance_km).toFixed(2)) + " كم");
    }
  }
  var priceStr = ervFmtMoney(Number(item.price) || 0);
  var titleText = item.title || "طلب";
  if (document.body.classList.contains("cart-checkout-v3")) {
    titleText = qty + " × " + titleText;
  }
  var idAttr = escCartHtml(String(item.id));
  var qtyBlock =
    kind === "product"
      ? '<div class="lp-cart-line__qty" role="group" aria-label="الكمية">' +
        '<button type="button" class="lp-cart-line__qty-btn" data-cart-qty-delta="-1" data-cart-id="' +
        idAttr +
        '" aria-label="إنقاص الكمية">−</button>' +
        '<span class="lp-cart-line__qty-val" aria-live="polite">' +
        qty +
        "</span>" +
        '<button type="button" class="lp-cart-line__qty-btn" data-cart-qty-delta="1" data-cart-id="' +
        idAttr +
        '" aria-label="زيادة الكمية">+</button>' +
        "</div>"
      : '<span class="lp-cart-line__qty-static">' +
        (isMapDeliveryCartItem(item) && data.product_qty
          ? "عدد القطع: " + escCartHtml(String(data.product_qty))
          : "× " + qty) +
        "</span>";
  var vendor =
    kind === "product" && (data.store_name || data.merchant_name)
      ? String(data.store_name || data.merchant_name)
      : "";
  var availBadge =
    kind === "product"
      ? '<span class="lp-cart-line__badge lp-cart-line__badge--avail">متاح</span>'
      : '<span class="lp-cart-line__badge lp-cart-line__badge--' + kind + '">' + kindLabel[kind] + "</span>";
  var lineClass =
    "lp-cart-line lp-cart-line--v2" + (document.body.classList.contains("cart-checkout-v3") ? " item" : "");
  return (
    '<article class="' +
    lineClass +
    '" data-cart-id="' +
    idAttr +
    '">' +
    '<div class="lp-cart-line__card">' +
    '<div class="lp-cart-line__thumb">' +
    cartLineThumbInner(item, kind) +
    "</div>" +
    '<div class="lp-cart-line__main">' +
    '<div class="lp-cart-line__head">' +
    availBadge +
    '<strong class="lp-cart-line__title">' +
    escCartHtml(titleText) +
    "</strong>" +
    "</div>" +
    (vendor ? '<p class="lp-cart-line__vendor">' + escCartHtml(vendor) + "</p>" : "") +
    buildCartLineDeliveryHtml(data) +
    (metaBits.length ? '<p class="lp-cart-line__meta">' + metaBits.join(" · ") + "</p>" : "") +
    '<div class="lp-cart-line__foot">' +
    '<div class="lp-cart-line__controls">' +
    qtyBlock +
    '<button type="button" class="lp-cart-line__remove" data-cart-remove="' +
    idAttr +
    '" aria-label="حذف من السلة">' +
    '<span class="lp-cart-line__remove-icon" aria-hidden="true">🗑</span></button>' +
    "</div>" +
    '<span class="lp-cart-line__price">' +
    priceStr +
    ' <small class="lp-cart-line__cur">ر.س</small></span>' +
    "</div>" +
    "</div>" +
    "</div>" +
    "</article>"
  );
}

function adjustCartQty(id, delta) {
  var cart = getCart();
  var idx = cart.findIndex(function (i) {
    return String(i.id) === String(id);
  });
  if (idx < 0) return;
  var item = cart[idx];
  if (cartLineKind(item) !== "product") return;
  var cur = cart[idx];
  var unit =
    Number(cur.data && cur.data.unit_price) ||
    (Number(cur.price) || 0) / Math.max(1, cartItemQty(cur));
  if (!Number.isFinite(unit) || unit < 0) unit = 0;
  var next = cartItemQty(cur) + delta;
  if (next < 1) {
    removeFromCart(id);
    return;
  }
  cart[idx] = Object.assign({}, cur, {
    price: unit * next,
    data: Object.assign({}, cur.data || {}, { qty: next, unit_price: unit }),
  });
  saveCart(cart);
  if (typeof window.renderCartPage === "function") window.renderCartPage();
}

function setLpCartPayStep(active) {
  var panel = document.getElementById("lpCartPanel");
  if (panel) panel.classList.toggle("lp-cart-panel--pay-step", !!active);
}

function getCartGrandTotalForPay() {
  var cart = getCart();
  if (!cart.length) return 0;
  var b = computeErvCartBreakdown(cart, resolveCartDeliveryFeeArg(cart));
  if (b.deliveryPending) return null;
  return b.grandTotal;
}

var __ervEwPayBalanceCache = null;

function cartCheckoutBlockedByEwPay() {
  if (window.__ervCartSelectedPayment !== "ew_pay") return false;
  var grand = getCartGrandTotalForPay();
  /* التحقق من التوصيل/الرصيد عند النقر — لا نعطّل الزر أثناء التحميل أو قبل GPS */
  if (grand == null) return false;
  if (__ervEwPayBalanceCache == null || !Number.isFinite(__ervEwPayBalanceCache)) return false;
  return roundMoney(__ervEwPayBalanceCache) < roundMoney(grand);
}

function getCartCheckoutButtonEl() {
  return document.getElementById("checkoutBtn") || document.getElementById("lpCartCheckoutBtn");
}

function syncCartCheckoutButtonState(btn, labelDefault) {
  if (!btn) return;
  var hasItems = !!getCart().length;
  var blocked = !hasItems || cartCheckoutBlockedByEwPay();
  btn.disabled = blocked;
  btn.textContent = labelDefault;
  if (hasItems && window.__ervCartSelectedPayment === "ew_pay" && cartCheckoutBlockedByEwPay()) {
    btn.setAttribute("aria-disabled", "true");
  } else {
    btn.removeAttribute("aria-disabled");
  }
}

function syncLpCartCheckoutBtn() {
  syncCartCheckoutButtonState(document.getElementById("lpCartCheckoutBtn"), "إتمام العملية");
}

function formatCheckoutOrderPreviewRef() {
  var key = "";
  try {
    key = sessionStorage.getItem("ervenow:checkout-idem") || "";
  } catch (_e) {}
  if (key && String(key).trim()) {
    var short = String(key).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 16).toUpperCase();
    return "#EW-" + short;
  }
  var d = new Date();
  var pad = function (n) {
    return String(n).padStart(2, "0");
  };
  return "#EW-" + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + "-جديد";
}

function syncCheckoutV3Chrome(cart, breakdown) {
  if (!document.body.classList.contains("cart-checkout-v3")) return;
  cart = cart || getCart();
  var header = document.getElementById("cartCheckoutHeader");
  var storeCard = document.getElementById("cartCheckoutStoreCard");
  var deliveryCard = document.getElementById("cartCheckoutDeliveryCard");
  var orderRef = document.getElementById("cartCheckoutOrderRef");
  var hasItems = !!cart.length;
  if (header) header.hidden = !hasItems;
  if (storeCard) storeCard.hidden = !hasItems;
  if (deliveryCard) deliveryCard.hidden = !hasItems;
  if (orderRef && hasItems) orderRef.textContent = formatCheckoutOrderPreviewRef();
  var nameEl = document.getElementById("cartStoreName");
  var metaEl = document.getElementById("cartStoreMeta");
  if (!hasItems) return;
  var storeName = "";
  var storeIcon = "🏪";
  var eta = null;
  cart.forEach(function (it) {
    var d = (it && it.data) || {};
    if (!storeName && (d.store_name || d.merchant_name)) {
      storeName = String(d.store_name || d.merchant_name);
      var st = String(d.store_type || "").toLowerCase();
      if (st === "restaurant" || /مطعم|مأكولات|restaurant/i.test(storeName)) storeIcon = "🍽️";
    }
    if (eta == null && d.eta_minutes != null && Number.isFinite(Number(d.eta_minutes))) {
      eta = Number(d.eta_minutes);
    }
  });
  if (!storeName) {
    var hasDelivery = cart.some(function (it) {
      return cartLineKind(it) === "delivery";
    });
    var hasService = cart.some(function (it) {
      return cartLineKind(it) === "service";
    });
    storeName = hasDelivery ? "طلب توصيل ERVENOW" : hasService ? "طلب خدمة ERVENOW" : "طلب ERVENOW";
    storeIcon = hasDelivery ? "🚚" : "📦";
  }
  if (nameEl) nameEl.textContent = storeIcon + " " + storeName;
  var metaParts = [];
  var mode = getCartFulfillmentMode(cart);
  if (mode) metaParts.push("🚚 " + fulfillmentLabelAr(mode));
  if (eta != null) metaParts.push("⏱️ " + eta + " دقيقة");
  if (metaEl) metaEl.textContent = metaParts.length ? metaParts.join(" • ") : "—";
  var typeEl = document.getElementById("cartDeliveryTypeLabel");
  if (typeEl) typeEl.textContent = mode ? fulfillmentLabelAr(mode) : "—";
  if (breakdown) {
    var feeEl = document.getElementById("cartDeliveryFeeDisplay");
    if (feeEl) {
      feeEl.innerHTML = breakdown.deliveryPending
        ? '<span class="lp-cart-panel__pending">—</span>'
        : ervMoneyCellHtml(breakdown.delivery);
    }
  }
}

function syncCartPageCheckoutBtn() {
  var btn = getCartCheckoutButtonEl();
  if (btn && document.body.classList.contains("cart-checkout-v3")) {
    var hasItems = !!getCart().length;
    var blocked = !hasItems || cartCheckoutBlockedByEwPay();
    btn.disabled = blocked;
    if (hasItems) {
      var b = computeErvCartBreakdown(getCart(), resolveCartDeliveryFeeArg(getCart()));
      var amt = b.deliveryPending ? "…" : ervFmtMoney(b.grandTotal) + " ر.س";
      btn.textContent = "تأكيد الطلب • " + amt;
    } else {
      btn.textContent = "تأكيد الطلب";
    }
    if (hasItems && window.__ervCartSelectedPayment === "ew_pay" && cartCheckoutBlockedByEwPay()) {
      btn.setAttribute("aria-disabled", "true");
    } else {
      btn.removeAttribute("aria-disabled");
    }
  } else {
    syncCartCheckoutButtonState(btn, "إتمام الطلب");
  }
  syncCartCheckoutButtons();
}

function resetLpCartPayStep() {
  setLpCartPayStep(false);
  syncLpCartCheckoutBtn();
}

function resetCartPagePayStep() {
  window.__cartCheckoutPayStep = false;
  syncCartPageCheckoutBtn();
}

window.resetLpCartPayStep = resetLpCartPayStep;
window.resetCartPagePayStep = resetCartPagePayStep;

function setCartPanelHasItems(hasItems) {
  var panel = document.getElementById("lpCartPanel");
  if (panel) panel.classList.toggle("lp-cart-panel--empty", !hasItems);
  ["lpCartSummary", "lpCartPayCard", "lpCartFooter"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.hidden = !hasItems;
  });
  syncLpCartUx2OpenState(hasItems);
  document.querySelectorAll(".lp-cart-accordion--fin").forEach(function (el) {
    if (!hasItems) el.removeAttribute("data-erv-fin-touched");
  });
  if (!hasItems) {
    resetLpCartPayStep();
    resetCartPagePayStep();
  }
  var finBox = document.getElementById("cartFinBox");
  if (finBox) finBox.hidden = !hasItems;
  var cartActionsPanel = document.getElementById("cartCheckoutActionsPanel");
  if (cartActionsPanel) cartActionsPanel.hidden = !hasItems;
  var checkoutCol = document.getElementById("cartCheckoutCol");
  if (checkoutCol) {
    checkoutCol.classList.toggle("cart-checkout-col--dim", !hasItems);
    checkoutCol.hidden = !hasItems;
  }
  var sidebar = document.querySelector(".cart-page-wrap .cart-sidebar-stack");
  if (sidebar) sidebar.hidden = !hasItems;
  var itemsCard = document.querySelector(".cart-page-wrap .cart-items-card");
  if (itemsCard) itemsCard.classList.toggle("cart-items-card--empty", !hasItems);
  var lpSummary = document.getElementById("lpCartSummary");
  var lpPayCard = document.getElementById("lpCartPayCard");
  var lpFooter = document.getElementById("lpCartFooter");
  if (lpSummary) lpSummary.hidden = !hasItems;
  if (lpPayCard) lpPayCard.hidden = !hasItems;
  if (lpFooter) lpFooter.hidden = !hasItems;
  var deliveryV3 = document.getElementById("cartCheckoutDeliveryCard");
  if (deliveryV3) deliveryV3.hidden = !hasItems;
  var lpPanel = document.getElementById("lpCartPageRoot") || document.getElementById("lpCartPanel");
  if (lpPanel) lpPanel.classList.toggle("lp-cart-panel--empty", !hasItems);
  document.body.classList.toggle("cart-page-is-empty", !hasItems);
  document.body.classList.toggle("cart-page-has-items", !!hasItems);
  syncCheckoutV3Chrome(hasItems ? getCart() : [], null);
}

function updateCartPanelHeader(cart) {
  var title = document.getElementById("lpCartDialogTitle");
  var sub = document.getElementById("lpCartPanelSub");
  if (title) {
    title.textContent = document.body.classList.contains("cart-checkout-v3") ? "🛒 إتمام الطلب" : "السلة";
  }
  if (sub) sub.hidden = true;
}

/** ضريبة القيمة المضافة وعمولة المنصة — نفس ترتيب checkout للمتاجر (ضريبة على البضاعة + التوصيل) */
var ERV_VAT_RATE = 0.15;
var ERV_PLATFORM_COMMISSION_RATE = 0.07;
var ERV_DELIVERY_SAR_PER_KM = 2.3;

function roundMoney(n) {
  var x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function persistCartDeliveryFee(fee) {
  var store = readCartStore();
  if (!store.totals) store.totals = {};
  if (fee === undefined || fee === null || !Number.isFinite(Number(fee))) {
    delete store.totals.deliveryFee;
    delete window.__ervCartDeliveryFee;
  } else {
    store.totals.deliveryFee = roundMoney(Number(fee));
    window.__ervCartDeliveryFee = store.totals.deliveryFee;
  }
  writeCartStore(store);
}

function persistCartPaymentMethod(method) {
  var store = readCartStore();
  if (!store.payment) store.payment = {};
  if (!method) {
    delete store.payment.method;
    window.__ervCartSelectedPayment = null;
  } else {
    store.payment.method = String(method);
    window.__ervCartSelectedPayment = store.payment.method;
  }
  writeCartStore(store);
}

function hydrateCartPaymentFromStore() {
  var store = readCartStore();
  if (store.payment && store.payment.method) {
    window.__ervCartSelectedPayment = store.payment.method;
  } else {
    try {
      var leg = localStorage.getItem(ERV_CART_PAYMENT_KEY);
      if (leg) {
        persistCartPaymentMethod(leg);
        try {
          localStorage.removeItem(ERV_CART_PAYMENT_KEY);
        } catch (_e) {}
      }
    } catch (_e2) {}
  }
  if (store.totals && Number.isFinite(Number(store.totals.deliveryFee))) {
    window.__ervCartDeliveryFee = roundMoney(Number(store.totals.deliveryFee));
  }
}

function cartSubtotal(cart) {
  return roundMoney(
    (cart || []).reduce(function (s, it) {
      return s + (Number(it && it.price) || 0);
    }, 0)
  );
}

function cartHasStoreProducts(cart) {
  return (cart || []).some(function (i) {
    var d = i && i.data;
    return cartLineKind(i) === "product" && d && d.store_id;
  });
}

function getFirstStoreCartLineData(cart) {
  for (var i = 0; i < (cart || []).length; i++) {
    var d = cart[i] && cart[i].data;
    if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return d;
  }
  return null;
}

function cartHasDeliverySnapshot(cart) {
  return (cart || []).some(function (i) {
    var d = i && i.data;
    if (!d || !d.store_id) return false;
    if (d.delivery_snapshot_version === 1) return true;
    if (d.fulfillment_mode) return true;
    return d.drop_lat != null && d.drop_lng != null;
  });
}

function getCartDeliveryContext(cart) {
  var d = getFirstStoreCartLineData(cart);
  if (!d || !cartHasDeliverySnapshot(cart)) return null;
  return {
    store_id: d.store_id,
    fulfillment_mode: d.fulfillment_mode || null,
    drop_lat: d.drop_lat != null ? Number(d.drop_lat) : null,
    drop_lng: d.drop_lng != null ? Number(d.drop_lng) : null,
    drop_address: String(d.drop_address || d.location || "").trim(),
    drop_maps_url: d.drop_maps_url || null,
    delivery_fee: Number.isFinite(Number(d.delivery_fee)) ? roundMoney(Number(d.delivery_fee)) : null,
    delivery_free: !!d.delivery_free,
    includes_delivery: !!d.includes_delivery,
  };
}

function readSavedDeliveryLocation() {
  var store = readCartStore();
  var fromStore = deliveryStoreToLoc(store.delivery);
  if (fromStore) return fromStore;
  var legacy = readLegacyDeliveryLocRaw();
  if (legacy) {
    store.delivery = deliveryLocToStore(legacy);
    writeCartStore(store);
    return deliveryStoreToLoc(store.delivery);
  }
  return null;
}

function saveDeliveryLocation(loc) {
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return;
  var store = readCartStore();
  store.delivery = deliveryLocToStore(loc);
  writeCartStore(store);
  syncPendingGeoFromLocation(loc);
}

function syncPendingGeoFromLocation(loc) {
  if (!loc) return;
  var addr = String(loc.address || loc.drop_address || "").trim();
  if (addr) {
    var addrEl = document.getElementById("customer_address");
    if (addrEl) addrEl.value = addr;
  }
}

function locationFromCartItemData(d) {
  if (!d || !d.store_id) return null;
  if (String(d.fulfillment_mode || "").toLowerCase() === "pickup") return null;
  var lat = Number(d.drop_lat);
  var lng = Number(d.drop_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: lat,
    lng: lng,
    address: String(d.drop_address || d.location || "").trim(),
    fulfillment_mode: d.fulfillment_mode || null,
    store_id: String(d.store_id),
    maps_url: d.drop_maps_url || null,
  };
}

function extractDeliveryLocationFromCart(cart) {
  cart = cart || getCart();
  for (var i = 0; i < cart.length; i += 1) {
    var loc = locationFromCartItemData(cart[i] && cart[i].data);
    if (loc) return loc;
  }
  return null;
}

function getCartFulfillmentMode(cart) {
  var ctx = getCartDeliveryContext(cart);
  if (ctx && ctx.fulfillment_mode) return String(ctx.fulfillment_mode).toLowerCase();
  cart = cart || getCart();
  for (var i = 0; i < cart.length; i += 1) {
    var d = cart[i] && cart[i].data;
    if (d && d.fulfillment_mode) return String(d.fulfillment_mode).toLowerCase();
  }
  return null;
}

function cartIsPickupOnly(cart) {
  return getCartFulfillmentMode(cart) === "pickup";
}

function cartNeedsDeliveryLocation(cart) {
  if (!cartHasStoreProducts(cart)) return false;
  return !cartIsPickupOnly(cart);
}

function patchCartItemsWithLocation(cart, loc) {
  if (!loc || !cart || !cart.length) return false;
  var changed = false;
  cart.forEach(function (it) {
    var d = it && it.data;
    if (!d || !d.store_id) return;
    if (String(d.fulfillment_mode || "").toLowerCase() === "pickup") return;
    if (!Number.isFinite(Number(d.drop_lat)) || !Number.isFinite(Number(d.drop_lng))) {
      d.drop_lat = loc.lat;
      d.drop_lng = loc.lng;
      if (loc.address && !d.drop_address) d.drop_address = loc.address;
      if (loc.maps_url && !d.drop_maps_url) d.drop_maps_url = loc.maps_url;
      if (!d.fulfillment_mode && loc.fulfillment_mode) d.fulfillment_mode = loc.fulfillment_mode;
      if (!d.delivery_snapshot_version) d.delivery_snapshot_version = 1;
      changed = true;
    }
  });
  return changed;
}

function hydrateDeliveryLocationForCart(cart) {
  cart = cart || getCart();
  var fromCart = extractDeliveryLocationFromCart(cart);
  if (fromCart) {
    saveDeliveryLocation(fromCart);
    if (patchCartItemsWithLocation(cart, fromCart)) saveCart(cart);
    return fromCart;
  }
  var saved = readSavedDeliveryLocation();
  if (saved) {
    syncPendingGeoFromLocation(saved);
    if (patchCartItemsWithLocation(cart, saved)) saveCart(cart);
    return saved;
  }
  return null;
}

function resolveEffectiveDeliveryLocation(cart) {
  cart = cart || getCart();
  var fromCart = extractDeliveryLocationFromCart(cart);
  if (fromCart) return fromCart;
  var saved = readSavedDeliveryLocation();
  if (saved) return saved;
  var g = getCartPendingGeo();
  if (Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
    var addrEl = document.getElementById("customer_address");
    return {
      lat: g.lat,
      lng: g.lng,
      address: addrEl ? addrEl.value.trim() : "",
    };
  }
  return null;
}

function resolveCartDeliveryFeeFromItems(cart) {
  var fee = 0;
  var seen = false;
  (cart || []).forEach(function (it) {
    var d = it && it.data;
    if (!d || !d.store_id) return;
    var mode = String(d.fulfillment_mode || "").toLowerCase();
    if (mode === "pickup") {
      seen = true;
      fee = 0;
      return;
    }
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
  if (seen) return fee;
  if (!cartHasStoreProducts(cart)) return 0;
  var ctx = getCartDeliveryContext(cart);
  if (!ctx) return undefined;
  if (String(ctx.fulfillment_mode || "").toLowerCase() === "pickup") return 0;
  if (ctx.delivery_free || ctx.includes_delivery) return 0;
  if (ctx.delivery_fee != null) return ctx.delivery_fee;
  return 0;
}

function getCartPendingGeo() {
  var loc = deliveryStoreToLoc(readCartStore().delivery);
  if (loc) return { lat: loc.lat, lng: loc.lng };
  return { lat: null, lng: null };
}

function cartNeedsStoreGeo(cart) {
  return (cart || []).some(function (i) {
    return i && i.data && i.data.store_id;
  });
}

function applyCartDeliveryContextFromItems(cart) {
  hydrateDeliveryLocationForCart(cart);
}

function fulfillmentLabelAr(mode) {
  var m = String(mode || "").toLowerCase();
  if (m === "pickup") return "الاستلام من المطعم";
  if (m === "store_delivery") return "توصيل بواسطة المتجر";
  if (m === "ervenow_delivery") return "توصيل المناديب";
  return "—";
}

function buildCartLineDeliveryHtml(d) {
  if (!d || !d.store_id) return "";
  var hasSnap =
    d.delivery_snapshot_version === 1 || d.fulfillment_mode || (d.drop_lat != null && d.drop_lng != null);
  if (!hasSnap) return "";
  var parts = ['<div class="lp-cart-line__delivery">'];
  parts.push(
    '<span class="lp-cart-line__delivery-row">🚚 ' + escCartHtml(fulfillmentLabelAr(d.fulfillment_mode)) + "</span>"
  );
  if (d.fulfillment_mode !== "pickup") {
    if (d.drop_address)
      parts.push('<span class="lp-cart-line__delivery-row">📍 ' + escCartHtml(d.drop_address) + "</span>");
    if (Number.isFinite(Number(d.distance_km)))
      parts.push(
        '<span class="lp-cart-line__delivery-row">📏 ' + Number(d.distance_km).toFixed(1) + " كم</span>"
      );
    if (d.eta_minutes != null && Number.isFinite(Number(d.eta_minutes)))
      parts.push('<span class="lp-cart-line__delivery-row">⏱️ ' + Number(d.eta_minutes) + " دقيقة</span>");
    if (d.delivery_free || d.includes_delivery)
      parts.push('<span class="lp-cart-line__delivery-row lp-cart-line__delivery-row--free">🎁 التوصيل مجاني</span>');
    else if (Number.isFinite(Number(d.delivery_fee)))
      parts.push(
        '<span class="lp-cart-line__delivery-row">💰 رسوم التوصيل: ' +
          Number(d.delivery_fee).toFixed(2) +
          " ر.س</span>"
      );
  }
  parts.push("</div>");
  return parts.join("");
}

/** أجرة توصيل المتجر = كم × 2.3 ر.س (كما في apps/checkout/service.js) */
function estimateStoreDeliveryFromKm(km) {
  var k = Number(km);
  if (!Number.isFinite(k) || k < 0) return 0;
  return roundMoney(k * ERV_DELIVERY_SAR_PER_KM);
}

/**
 * @param {*} deliveryFee - رقم معروف، أو undefined إن لم يُحسب بعد (سلة متجر بدون موقع)
 */
function cartGoodsSubtotal(cart) {
  return roundMoney(
    (cart || []).reduce(function (s, it) {
      if (cartLineKind(it) !== "product") return s;
      return s + (Number(it && it.price) || 0);
    }, 0)
  );
}

function computeErvCartBreakdown(cart, deliveryFee) {
  var sub = cartSubtotal(cart);
  var delKnown = Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) >= 0;
  var del = delKnown ? roundMoney(Number(deliveryFee)) : 0;
  var deliveryPending = cartHasStoreProducts(cart) && !delKnown;
  var vat = roundMoney((sub + del) * ERV_VAT_RATE);
  var goods = cartGoodsSubtotal(cart);
  var platformOnGoods = roundMoney(goods * ERV_PLATFORM_COMMISSION_RATE);
  var platformOnDelivery = delKnown ? roundMoney(del * ERV_PLATFORM_COMMISSION_RATE) : 0;
  var platformCommission = roundMoney(platformOnGoods + platformOnDelivery);
  var grandTotal = roundMoney(sub + del + vat);
  return {
    subtotal: sub,
    delivery: del,
    deliveryPending: deliveryPending,
    vat: vat,
    platformCommission: platformCommission,
    platformOnGoods: platformOnGoods,
    platformOnDelivery: platformOnDelivery,
    merchantNet: roundMoney(goods - platformOnGoods),
    driverNet: roundMoney(del - platformOnDelivery),
    grandTotal: grandTotal,
  };
}

/**
 * طبقة النية المالية الموحّدة — نفس الأرقام للعرض والطلب والتسوية.
 * @param {object[]} [cart]
 * @param {number|undefined} deliveryFee
 * @param {string} [paymentMethod]
 */
function buildFinancialIntent(cart, deliveryFee, paymentMethod) {
  var c = cart || getCart();
  var b = computeErvCartBreakdown(c, deliveryFee);
  var pay =
    String(paymentMethod || window.__ervCartSelectedPayment || "").trim() ||
    String((readCartStore().payment && readCartStore().payment.method) || "");
  return {
    subtotal: b.subtotal,
    delivery_fee: b.deliveryPending ? null : b.delivery,
    delivery_pending: b.deliveryPending,
    vat: b.vat,
    platform_fee: b.platformCommission,
    merchant_net: b.merchantNet,
    driver_net: b.driverNet,
    grand_total: b.deliveryPending ? null : b.grandTotal,
    payment_method: pay,
  };
}

function ervFmtMoney(n) {
  try {
    return roundMoney(n).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    return roundMoney(n).toFixed(2);
  }
}

function ervMoneyCellHtml(n) {
  return ervFmtMoney(n) + ' <small class="lp-cart-panel__cur">ر.س</small>';
}

function zeroCartFinancialsUi() {
  var ids = [
    "lpCartSub",
    "lpCartDel",
    "lpCartVat",
    "lpCartComm",
    "lpCartTotal",
    "cartFinSub",
    "cartFinDel",
    "cartFinVat",
    "cartFinComm",
    "cartFinGrand",
  ];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (id === "lpCartComm") el.textContent = ervFmtMoney(0);
    else el.innerHTML = ervMoneyCellHtml(0);
  });
  ["lpCartDelNote", "cartFinDelNote"].forEach(function (nid) {
    var n = document.getElementById(nid);
    if (n) n.hidden = true;
  });
  clearPaymentMethodIconContainers();
}

function syncLpCartAccordionMeta() {
  var itemsMeta = document.getElementById("lpCartItemsToggleMeta");
  if (itemsMeta) {
    var cart = getCart();
    if (!cart.length) itemsMeta.textContent = "السلة فارغة";
    else {
      var n = cartTotalPieceCount(cart);
      itemsMeta.textContent = "عدد المنتجات (" + n + ")";
    }
  }
  var finMeta = document.getElementById("lpCartFinToggleMeta");
  if (finMeta) {
    var cart2 = getCart();
    if (!cart2.length) {
      finMeta.textContent = "الإجمالي: ٠٫٠٠ ر.س";
    } else {
      var b = computeErvCartBreakdown(cart2, resolveCartDeliveryFeeArg(cart2));
      finMeta.textContent = "الإجمالي: " + ervFmtMoney(b.grandTotal) + " ر.س";
    }
  }
  var payMeta = document.getElementById("lpCartPayToggleMeta");
  if (payMeta) {
    var m = window.__ervCartSelectedPayment;
    payMeta.textContent = m ? "💳 " + payMethodLabelAr(m) : "اختر وسيلة";
  }
}

function syncLpCartUx2OpenState(hasItems) {
  var finAcc = document.querySelector(".lp-cart-accordion--fin");
  if (finAcc && hasItems && !finAcc.hasAttribute("data-erv-fin-touched")) {
    finAcc.setAttribute("open", "");
  }
}

function applyCartFinancialsToUi(b, opts) {
  opts = opts || {};
  var isEmpty = !!opts.empty;
  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function setMoney(id, val) {
    setHtml(id, ervMoneyCellHtml(val));
  }
  if (isEmpty) {
    zeroCartFinancialsUi();
    syncLpCartAccordionMeta();
    return;
  }
  setMoney("lpCartSub", b.subtotal);
  setMoney("cartFinSub", b.subtotal);
  function applyDel(id0, id1, note0, note1) {
    if (b.deliveryPending) {
      setHtml(id0, '<span class="lp-cart-panel__pending">—</span>');
      setHtml(id1, '<span class="lp-cart-panel__pending">—</span>');
      var n0 = document.getElementById(note0);
      var n1 = document.getElementById(note1);
      if (n0) n0.hidden = false;
      if (n1) n1.hidden = false;
    } else {
      setMoney(id0, b.delivery);
      setMoney(id1, b.delivery);
      var m0 = document.getElementById(note0);
      var m1 = document.getElementById(note1);
      if (m0) m0.hidden = true;
      if (m1) m1.hidden = true;
    }
  }
  applyDel("lpCartDel", "cartFinDel", "lpCartDelNote", "cartFinDelNote");
  var feeDisp = document.getElementById("cartDeliveryFeeDisplay");
  if (feeDisp) {
    feeDisp.innerHTML = b.deliveryPending
      ? '<span class="lp-cart-panel__pending">—</span>'
      : ervMoneyCellHtml(b.delivery);
  }
  setMoney("lpCartVat", b.vat);
  setMoney("cartFinVat", b.vat);
  setMoney("lpCartComm", b.platformCommission);
  setMoney("cartFinComm", b.platformCommission);
  setMoney("lpCartTotal", b.grandTotal);
  setMoney("cartFinGrand", b.grandTotal);
  if (window.__ervCartSelectedPayment === "ew_pay") refreshEwPayBalanceCards();
  syncLpCartAccordionMeta();
  syncCheckoutV3Chrome(getCart(), b);
  syncLpCartCheckoutBtn();
  syncCartPageCheckoutBtn();
}

window.computeErvCartBreakdown = computeErvCartBreakdown;
window.buildFinancialIntent = buildFinancialIntent;
window.estimateStoreDeliveryFromKm = estimateStoreDeliveryFromKm;
window.cartSubtotal = cartSubtotal;
window.cartHasStoreProducts = cartHasStoreProducts;
window.cartHasDeliverySnapshot = cartHasDeliverySnapshot;
window.getCartDeliveryContext = getCartDeliveryContext;
window.cartNeedsStoreGeo = cartNeedsStoreGeo;
window.cartNeedsDeliveryLocation = cartNeedsDeliveryLocation;
window.applyCartDeliveryContextFromItems = applyCartDeliveryContextFromItems;
window.resolveCartDeliveryFeeFromItems = resolveCartDeliveryFeeFromItems;
window.readSavedDeliveryLocation = readSavedDeliveryLocation;
window.saveDeliveryLocation = saveDeliveryLocation;
window.resolveEffectiveDeliveryLocation = resolveEffectiveDeliveryLocation;
window.hydrateDeliveryLocationForCart = hydrateDeliveryLocationForCart;
window.syncCartDeliveryLocationUi = syncCartDeliveryLocationUi;
window.refreshStoreDeliveryCard = syncCartDeliveryLocationUi;
window.refreshCartDeliveryFee = refreshCartDeliveryFee;
window.initCartDeliveryLocationUi = initCartDeliveryLocationUi;
window.cartGoodsSubtotal = cartGoodsSubtotal;

var ERV_PAYMENT_KEYS_ORDER = [
  "ew_pay",
  "mada",
  "visa",
  "mastercard",
  "apple_pay",
  "stc_pay",
  "cash_on_delivery",
  "tabby",
  "tamara",
];

var ERV_PAYMENT_BNPL = { tabby: true, tamara: true };

/** مخفية في بطاقة السلة فقط (تابي / تمارا) */
var ERV_CART_PAYMENT_HIDDEN = { tabby: true, tamara: true };

function filterCartPaymentMethodsOrdered(methods) {
  return ERV_PAYMENT_KEYS_ORDER.filter(function (key) {
    return methods[key] && ERV_PAY_ICON_SRC[key] && !ERV_CART_PAYMENT_HIDDEN[key];
  });
}

function cartPaymentMethodAllowed(methods, key) {
  return !!(methods[key] && !ERV_CART_PAYMENT_HIDDEN[key]);
}

var ERV_PAY_ICON_SRC = {
  ew_pay: "/assets/pay-ew.svg",
  mada: "/assets/pay-mada.svg",
  visa: "/assets/pay-visa.svg",
  mastercard: "/assets/pay-mastercard.svg",
  apple_pay: "/assets/pay-apple.svg",
  stc_pay: "/assets/pay-stcpay.svg",
  cash_on_delivery: "/assets/pay-cod.svg",
  tabby: "/assets/pay-tabby.svg",
  tamara: "/assets/pay-tamara.svg",
};

function payMethodLabelAr(k) {
  var map = {
    ew_pay: "ERVENOW PAY",
    mada: "مدى",
    visa: "Visa",
    mastercard: "Mastercard",
    apple_pay: "Apple Pay",
    stc_pay: "STC Pay",
    cash_on_delivery: "الدفع عند الوصول",
    tabby: "Tabby",
    tamara: "Tamara",
  };
  return map[k] || k;
}

function paymentCardDisplay(key) {
  var titles = {
    ew_pay: "ERVENOW PAY",
    mada: "mada",
    visa: "Visa",
    mastercard: "Mastercard",
    apple_pay: "Apple Pay",
    stc_pay: "STC Pay",
    cash_on_delivery: "Cash",
    tabby: "Tabby",
    tamara: "Tamara",
  };
  var hints = {
    ew_pay: "الرصيد المشحون في المحفظة",
    mada: "مدى السعودية",
    visa: "بطاقة ائتمان",
    mastercard: "بطاقة ائتمان",
    apple_pay: "Apple Wallet",
    stc_pay: "stc pay",
    cash_on_delivery: "الدفع عند الوصول",
    tabby: "قسّم على 4 دفعات",
    tamara: "قسّم بدون رسوم إضافية",
  };
  return { title: titles[key] || payMethodLabelAr(key), hint: hints[key] || "" };
}

function defaultPaymentMethodsAllTrue() {
  var o = {};
  ERV_PAYMENT_KEYS_ORDER.forEach(function (k) {
    o[k] = true;
  });
  return o;
}

function normalizePaymentMethodsClient(obj) {
  var o = defaultPaymentMethodsAllTrue();
  if (!obj || typeof obj !== "object") return o;
  ERV_PAYMENT_KEYS_ORDER.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = !!obj[k];
  });
  return o;
}

function intersectPaymentMethodsClient(platform, second) {
  var p = normalizePaymentMethodsClient(platform);
  var s = normalizePaymentMethodsClient(second);
  var out = {};
  ERV_PAYMENT_KEYS_ORDER.forEach(function (k) {
    out[k] = !!p[k] && !!s[k];
  });
  return out;
}

function apiUrl(path) {
  if (window.PlatformAPI && typeof window.PlatformAPI.apiUrl === "function") return window.PlatformAPI.apiUrl(path);
  return path;
}

function resolveCartPaymentMethodsForUi() {
  return fetch(apiUrl("/api/core/checkout-payment-methods"))
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      var plat = normalizePaymentMethodsClient(j && j.methods);
      var cart = getCart();
      if (!cartHasStoreProducts(cart)) return plat;
      var sid = null;
      cart.forEach(function (i) {
        var d = i && i.data;
        if (d && d.store_id && !sid) sid = String(d.store_id);
      });
      if (!sid) return plat;
      return fetch(apiUrl("/api/store/public/" + encodeURIComponent(sid)))
        .then(function (r2) {
          return r2.json();
        })
        .then(function (j2) {
          var sm = j2 && j2.store && j2.store.checkout_payment_methods;
          if (sm && typeof sm === "object") return intersectPaymentMethodsClient(plat, sm);
          return plat;
        });
    })
    .catch(function () {
      return defaultPaymentMethodsAllTrue();
    });
}

function clearPaymentMethodIconContainers() {
  ["lpCartPayIcons", "cartPayIcons"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  ["lpCartPaySelect", "cartPaySelect"].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.setAttribute("data-pay-placeholder", "1");
    ph.textContent = "— اختر وسيلة الدفع —";
    sel.appendChild(ph);
    var wrapId = payLuxeWrapId(id);
    var wrap = wrapId ? document.getElementById(wrapId) : null;
    if (wrap) wrap.innerHTML = "";
  });
  ["lpCartEwPayDetail", "cartEwPayDetail"].forEach(function (eid) {
    var e = document.getElementById(eid);
    if (e) e.hidden = true;
  });
  window.__ervCartSelectedPayment = null;
  window.__ervCartPayUiMounted = false;
  __ervEwPayBalanceCache = null;
}

var ERV_EW_PAY_DETAIL_IDS = [
  {
    detail: "lpCartEwPayDetail",
    avail: "lpCartEwPayAvail",
    order: "lpCartEwPayOrder",
    after: "lpCartEwPayAfter",
    insufficient: "lpCartEwPayInsufficient",
    topup: "lpCartEwPayTopup",
    balance: "lpCartEwPayBalance",
  },
];

function refreshEwPayBalanceCards() {
  var method = window.__ervCartSelectedPayment;
  var grand = getCartGrandTotalForPay();
  ERV_EW_PAY_DETAIL_IDS.forEach(function (ids) {
    var panel = document.getElementById(ids.detail);
    if (!panel) return;
    if (method !== "ew_pay") {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var availEl = document.getElementById(ids.avail);
    var orderEl = document.getElementById(ids.order);
    var afterEl = document.getElementById(ids.after);
    var warnEl = document.getElementById(ids.insufficient);
    var topupEl = document.getElementById(ids.topup);
    var orderTxt =
      grand == null
        ? "يُحسب بعد تحديد التوصيل"
        : ervFmtMoney(grand) + ' <small class="lp-cart-panel__cur">ر.س</small>';
    if (orderEl) orderEl.innerHTML = orderTxt;
    var bal = __ervEwPayBalanceCache;
    var balTxt =
      bal == null || !Number.isFinite(bal) ? "…" : ervFmtMoney(bal) + ' <small class="lp-cart-panel__cur">ر.س</small>';
    if (availEl) availEl.innerHTML = balTxt;
    if (ids.balance) {
      var balLegacy = document.getElementById(ids.balance);
      if (balLegacy) balLegacy.textContent = bal == null ? "—" : ervFmtMoney(bal);
    }
    var afterVal = null;
    if (grand != null && bal != null && Number.isFinite(bal)) {
      afterVal = roundMoney(bal - grand);
    }
    if (afterEl) {
      afterEl.innerHTML =
        afterVal == null
          ? "—"
          : ervFmtMoney(afterVal) + ' <small class="lp-cart-panel__cur">ر.س</small>';
    }
    var insufficient = grand != null && bal != null && Number.isFinite(bal) && roundMoney(bal) < roundMoney(grand);
    if (warnEl) warnEl.hidden = !insufficient;
    if (topupEl) topupEl.hidden = !insufficient;
    panel.classList.toggle("erv-ew-pay-card--insufficient", !!insufficient);
  });
  syncLpCartCheckoutBtn();
  syncCartPageCheckoutBtn();
}

function loadEwPayBalanceForCart() {
  __ervEwPayBalanceCache = null;
  refreshEwPayBalanceCards();
  return fetchWalletBalanceForCart().then(function (bal) {
    __ervEwPayBalanceCache = bal == null || !Number.isFinite(bal) ? null : roundMoney(bal);
    refreshEwPayBalanceCards();
    return __ervEwPayBalanceCache;
  });
}

function mountCartPaymentUiIfNeeded() {
  var icons = document.getElementById("lpCartPayIcons");
  if (!icons || !getCart().length) return;
  if (window.__ervCartPayUiMounted) return;
  window.__ervCartPayUiMounted = true;
  renderPaymentMethodCardsInto("lpCartPayIcons");
}

async function fetchWalletBalanceForCart() {
  if (!window.PlatformAPI || typeof window.PlatformAPI.getToken !== "function" || !window.PlatformAPI.getToken()) return null;
  try {
    var meRes = await fetch(apiUrl("/api/core/me"), {
      headers: { Authorization: "Bearer " + window.PlatformAPI.getToken() },
    });
    var me = await meRes.json().catch(function () {
      return {};
    });
    var role = String((me.profile && me.profile.role) || "").toLowerCase();
    if (role === "admin") return null;
    if (role === "driver") {
      var j = await window.PlatformAPI.api("/api/driver/wallet");
      return Number(j.balance) || 0;
    }
    if (role === "store" || role === "merchant" || role === "restaurant") {
      try {
        var md = await window.PlatformAPI.api("/api/store/merchant-dashboard");
        return Number((md.wallet && md.wallet.balance) || 0);
      } catch (e1) {
        var w2 = await window.PlatformAPI.api("/api/wallet");
        return Number(w2.balance) || 0;
      }
    }
    var w = await window.PlatformAPI.api("/api/wallet");
    return Number(w.balance) || 0;
  } catch (e) {
    return null;
  }
}

function setSelectedPaymentFromSelect(selectId, method) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  sel.value = method || "";
  if (!method) {
    persistCartPaymentMethod(null);
    var ew0 = document.getElementById(selectId === "lpCartPaySelect" ? "lpCartEwPayDetail" : "cartEwPayDetail");
    if (ew0) ew0.hidden = true;
    syncPayLuxeTrigger(selectId, "");
    syncLpCartAccordionMeta();
    syncLpCartCheckoutBtn();
    syncCartPageCheckoutBtn();
    return;
  }
  persistCartPaymentMethod(method);

  if (method === "ew_pay") {
    loadEwPayBalanceForCart();
  } else {
    refreshEwPayBalanceCards();
  }
  syncPayLuxeTrigger(selectId, method);
  syncLpCartAccordionMeta();
  syncLpCartCheckoutBtn();
  syncCartPageCheckoutBtn();
}

function setSelectedPaymentForContainer(containerId, method) {
  var selMap = { lpCartPayIcons: "lpCartPaySelect", cartPayIcons: "cartPaySelect" };
  if (selMap[containerId] && document.getElementById(selMap[containerId])) {
    setSelectedPaymentFromSelect(selMap[containerId], method);
    return;
  }
  var root = document.getElementById(containerId);
  if (!root) return;
  root.querySelectorAll(".erv-pay-card").forEach(function (b) {
    var on = b.getAttribute("data-pay-method") === method;
    b.classList.toggle("erv-pay-card--selected", on);
    b.classList.toggle("payment-option--selected", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  persistCartPaymentMethod(method);

  if (method === "ew_pay") {
    loadEwPayBalanceForCart();
  } else {
    refreshEwPayBalanceCards();
  }
  syncLpCartAccordionMeta();
}

function checkoutV3PayLabel(key, meta) {
  var v3PayLabels = {
    ew_pay: "💰 ERVENOW",
    stc_pay: "📱 STC Pay",
    mada: "💳 مدى",
    apple_pay: " Apple Pay",
    visa: "💳 Visa",
    mastercard: "💳 Mastercard",
    cash_on_delivery: "💵 عند الاستلام",
    tabby: "📅 Tabby",
    tamara: "📅 Tamara",
  };
  return v3PayLabels[key] || (meta && meta.title) || key;
}

function buildPaymentCardButton(key, opts) {
  opts = opts || {};
  var src = ERV_PAY_ICON_SRC[key];
  if (!src) return null;
  var meta = paymentCardDisplay(key);
  var isV3 = document.body.classList.contains("cart-checkout-v3");
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "erv-pay-card" +
    (isV3 ? " payment-option" : "") +
    (key === "ew_pay" ? " erv-pay-card--ew" : "") +
    (opts.bnpl ? " erv-pay-card--bnpl" : "");
  if (opts.bnpl && key === "tabby") btn.classList.add("erv-pay-card--tabby");
  if (opts.bnpl && key === "tamara") btn.classList.add("erv-pay-card--tamara");
  btn.setAttribute("data-pay-method", key);
  btn.setAttribute("aria-label", meta.title + (meta.hint ? " — " + meta.hint : ""));
  btn.setAttribute("aria-pressed", "false");
  if (isV3) {
    var radio = document.createElement("span");
    radio.className = "radio";
    radio.setAttribute("aria-hidden", "true");
    btn.appendChild(radio);
    var payLabel = document.createElement("span");
    payLabel.className = "payment-label";
    payLabel.textContent = checkoutV3PayLabel(key, meta);
    btn.appendChild(payLabel);
    return btn;
  }
  var wrap = document.createElement("span");
  wrap.className = "erv-pay-card__icon-wrap";
  var img = document.createElement("img");
  img.className = "erv-pay-card__icon";
  img.src = src;
  img.alt = meta.title;
  img.loading = "lazy";
  wrap.appendChild(img);
  btn.appendChild(wrap);
  var t = document.createElement("span");
  t.className = "erv-pay-card__title";
  t.textContent = meta.title;
  btn.appendChild(t);
  if (meta.hint) {
    var h = document.createElement("span");
    h.className = "erv-pay-card__hint";
    h.textContent = meta.hint;
    btn.appendChild(h);
  }
  return btn;
}

var __ervPayCardsRenderGen = {};

function renderPaymentMethodCardsInto(containerId) {
  var root = document.getElementById(containerId);
  if (!root) return;
  var gen = (__ervPayCardsRenderGen[containerId] || 0) + 1;
  __ervPayCardsRenderGen[containerId] = gen;
  root.innerHTML = "";
  var ewMap = { lpCartPayIcons: "lpCartEwPayDetail", cartPayIcons: "cartEwPayDetail" };
  var ewId = ewMap[containerId];
  if (ewId) {
    var ew0 = document.getElementById(ewId);
    if (ew0) ew0.hidden = true;
  }
  resolveCartPaymentMethodsForUi().then(function (methods) {
    if (__ervPayCardsRenderGen[containerId] !== gen) return;
    root = document.getElementById(containerId);
    if (!root) return;
    var ordered = filterCartPaymentMethodsOrdered(methods);
    var gridKeys = ordered;
    var bnplKeys = [];

    var row5 = document.createElement("div");
    row5.className = "erv-pay-cards__row erv-pay-cards__row--5";
    gridKeys.slice(0, 5).forEach(function (key) {
      var b = buildPaymentCardButton(key, {});
      if (b) row5.appendChild(b);
    });
    root.appendChild(row5);

    var slice3 = gridKeys.slice(5, 8);
    if (slice3.length) {
      var row3 = document.createElement("div");
      row3.className = "erv-pay-cards__row erv-pay-cards__row--3";
      slice3.forEach(function (key) {
        var b = buildPaymentCardButton(key, {});
        if (b) row3.appendChild(b);
      });
      root.appendChild(row3);
    }

    if (bnplKeys.length) {
      var bnpl = document.createElement("div");
      bnpl.className = "erv-pay-cards__bnpl";
      bnpl.setAttribute("role", "group");
      bnpl.setAttribute("aria-label", "تابي وتمارا — تقسيط");
      bnplKeys.forEach(function (key) {
        var b = buildPaymentCardButton(key, { bnpl: true });
        if (b) bnpl.appendChild(b);
      });
      root.appendChild(bnpl);
    }

    var first = ordered[0];
    var saved =
      (readCartStore().payment && readCartStore().payment.method) ||
      (function () {
        try {
          return localStorage.getItem(ERV_CART_PAYMENT_KEY);
        } catch (e3) {
          return null;
        }
      })();
    var pick = saved && cartPaymentMethodAllowed(methods, saved) ? saved : first;
    if (pick) setSelectedPaymentForContainer(containerId, pick);
  });
}

function renderPaymentMethodIconsInto(containerId) {
  renderPaymentMethodCardsInto(containerId);
}

var ERV_PAY_LUXE_WRAP = { lpCartPaySelect: "lpCartPayLuxeWrap", cartPaySelect: "cartPayLuxeWrap" };

var ERV_PAY_LUXE_GROUPS = [
  { label: "ERVENOW PAY", keys: ["ew_pay"] },
  { label: "البطاقات والمحافظ", keys: ["mada", "visa", "mastercard", "apple_pay", "stc_pay"] },
  { label: "الدفع عند الاستلام", keys: ["cash_on_delivery"] },
];

function payLuxeWrapId(selectId) {
  return ERV_PAY_LUXE_WRAP[selectId] || "";
}

function payLuxeAccentClass(key) {
  if (key === "ew_pay") return "erv-pay-luxe__opt--ew";
  if (key === "tabby") return "erv-pay-luxe__opt--tabby";
  if (key === "tamara") return "erv-pay-luxe__opt--tamara";
  if (key === "mada") return "erv-pay-luxe__opt--mada";
  return "";
}

function payLuxeIconHtml(key) {
  var src = ERV_PAY_ICON_SRC[key];
  if (!src) return '<span aria-hidden="true">💳</span>';
  var meta = paymentCardDisplay(key);
  return '<img src="' + src + '" alt="' + meta.title + '" loading="lazy" />';
}

function closeAllPayLuxePickers(exceptSelectId) {
  Object.keys(ERV_PAY_LUXE_WRAP).forEach(function (selectId) {
    if (exceptSelectId && selectId === exceptSelectId) return;
    var wrap = document.getElementById(payLuxeWrapId(selectId));
    if (!wrap) return;
    var root = wrap.querySelector(".erv-pay-luxe");
    var trigger = wrap.querySelector(".erv-pay-luxe__trigger");
    if (root) root.classList.remove("erv-pay-luxe--open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function syncPayLuxeTrigger(selectId, method) {
  var wrap = document.getElementById(payLuxeWrapId(selectId));
  if (!wrap) return;

  wrap.querySelectorAll(".erv-pay-luxe__opt").forEach(function (opt) {
    var on = opt.getAttribute("data-pay-method") === method;
    opt.classList.toggle("erv-pay-luxe__opt--selected", on);
    opt.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function ensurePayLuxeShell(selectId) {
  var wrapId = payLuxeWrapId(selectId);
  var wrap = document.getElementById(wrapId);
  if (!wrap || wrap.querySelector(".erv-pay-luxe")) return wrap;

  wrap.innerHTML =
    '<div class="erv-pay-luxe erv-pay-luxe--inline erv-pay-luxe--cart" data-select-id="' +
    selectId +
    '">' +
    '<div class="erv-pay-luxe__shell">' +
    '<div class="erv-pay-luxe__head">' +
    '<div class="erv-pay-luxe__head-text">' +
    '<span class="erv-pay-luxe__eyebrow">ERVENOW PAY</span>' +
    '<span class="erv-pay-luxe__title">بطاقة الدفع</span>' +
    "</div>" +
    '<div class="erv-pay-luxe__badges">' +
    '<span class="erv-pay-luxe__badge">🔒 آمن</span>' +
    '<span class="erv-pay-luxe__badge">⚡ فوري</span>' +
    "</div>" +
    "</div>" +
    '<div class="erv-pay-luxe__body">' +
    '<p class="erv-pay-luxe__pick-label">اختر وسيلة الدفع المناسبة</p>' +
    '<div class="erv-pay-luxe__panel erv-pay-luxe__panel--inline" role="listbox" aria-label="وسائل الدفع"></div>' +
    '<p class="erv-pay-luxe__foot">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
    "معاملات مشفّرة · محمية بمعايير الدفع الآمن" +
    "</p>" +
    "</div></div></div>";

  return wrap;
}

function buildPayLuxeOptions(selectId, ordered) {
  var wrap = ensurePayLuxeShell(selectId);
  if (!wrap) return;
  var panel = wrap.querySelector(".erv-pay-luxe__panel");
  if (!panel) return;
  panel.innerHTML = "";

  var used = {};
  ERV_PAY_LUXE_GROUPS.forEach(function (group) {
    var keys = group.keys.filter(function (k) {
      return ordered.indexOf(k) >= 0;
    });
    if (!keys.length) return;
    keys.forEach(function (k) {
      used[k] = true;
    });

    var groupEl = document.createElement("div");
    groupEl.className = "erv-pay-luxe__group";
    var label = document.createElement("p");
    label.className = "erv-pay-luxe__group-label";
    label.textContent = group.label;
    groupEl.appendChild(label);

    keys.forEach(function (key) {
      var meta = paymentCardDisplay(key);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "erv-pay-luxe__opt " + payLuxeAccentClass(key);
      btn.setAttribute("role", "option");
      btn.setAttribute("data-pay-method", key);
      btn.setAttribute("aria-selected", "false");
      btn.innerHTML =
        '<span class="erv-pay-luxe__opt-icon">' +
        payLuxeIconHtml(key) +
        "</span>" +
        '<span class="erv-pay-luxe__opt-copy">' +
        '<span class="erv-pay-luxe__opt-title">' +
        meta.title +
        "</span>" +
        (meta.hint ? '<span class="erv-pay-luxe__opt-hint">' + meta.hint + "</span>" : "") +
        "</span>" +
        '<span class="erv-pay-luxe__opt-check" aria-hidden="true"></span>';
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        setSelectedPaymentFromSelect(selectId, key);
      });
      groupEl.appendChild(btn);
    });
    panel.appendChild(groupEl);
  });

  ordered.forEach(function (key) {
    if (used[key]) return;
    var meta = paymentCardDisplay(key);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "erv-pay-luxe__opt " + payLuxeAccentClass(key);
    btn.setAttribute("role", "option");
    btn.setAttribute("data-pay-method", key);
    btn.setAttribute("aria-selected", "false");
    btn.innerHTML =
      '<span class="erv-pay-luxe__opt-icon">' +
      payLuxeIconHtml(key) +
      "</span>" +
      '<span class="erv-pay-luxe__opt-copy">' +
      '<span class="erv-pay-luxe__opt-title">' +
      meta.title +
      "</span>" +
      (meta.hint ? '<span class="erv-pay-luxe__opt-hint">' + meta.hint + "</span>" : "") +
      "</span>" +
      '<span class="erv-pay-luxe__opt-check" aria-hidden="true"></span>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setSelectedPaymentFromSelect(selectId, key);
    });
    panel.appendChild(btn);
  });
}

function renderPaymentMethodDropdownInto(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var gen = (__ervPayCardsRenderGen[selectId] || 0) + 1;
  __ervPayCardsRenderGen[selectId] = gen;
  sel.innerHTML = "";
  var ph = document.createElement("option");
  ph.value = "";
  ph.setAttribute("data-pay-placeholder", "1");
  ph.textContent = "— اختر وسيلة الدفع —";
  sel.appendChild(ph);

  ensurePayLuxeShell(selectId);
  syncPayLuxeTrigger(selectId, "");

  var ewMap = { lpCartPaySelect: "lpCartEwPayDetail", cartPaySelect: "cartEwPayDetail" };
  var ew0 = document.getElementById(ewMap[selectId]);
  if (ew0) ew0.hidden = true;

  resolveCartPaymentMethodsForUi().then(function (methods) {
    if (__ervPayCardsRenderGen[selectId] !== gen) return;
    sel = document.getElementById(selectId);
    if (!sel) return;
    var ordered = filterCartPaymentMethodsOrdered(methods);
    ordered.forEach(function (key) {
      var d = paymentCardDisplay(key);
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = d.hint ? d.title + " — " + d.hint : d.title;
      sel.appendChild(opt);
    });
    buildPayLuxeOptions(selectId, ordered);
    var saved =
      (readCartStore().payment && readCartStore().payment.method) ||
      (function () {
        try {
          return localStorage.getItem(ERV_CART_PAYMENT_KEY);
        } catch (e3) {
          return null;
        }
      })();
    var first = ordered[0];
    var pick = saved && cartPaymentMethodAllowed(methods, saved) ? saved : "";
    if (pick) setSelectedPaymentFromSelect(selectId, pick);
    else syncPayLuxeTrigger(selectId, "");
  });
}

function handleLpCartCheckoutClick() {
  if (!getCart().length) return;
  var path = (window.location.pathname || "").replace(/\/+$/, "") || "/";
  if ((path === "/cart" || path === "/checkout") && typeof window.executeCartCheckout === "function") {
    void window.executeCartCheckout();
    return;
  }
  window.location.href = "/checkout";
}

window.renderPaymentMethodCardsInto = renderPaymentMethodCardsInto;
window.renderPaymentMethodIconsInto = renderPaymentMethodIconsInto;
window.renderPaymentMethodDropdownInto = renderPaymentMethodDropdownInto;
window.handleLpCartCheckoutClick = handleLpCartCheckoutClick;
window.setSelectedPaymentFromSelect = setSelectedPaymentFromSelect;
window.resolveCartPaymentMethodsForUi = resolveCartPaymentMethodsForUi;
window.getSelectedCartPaymentMethod = function () {
  return window.__ervCartSelectedPayment || null;
};
window.refreshEwPayBalanceCards = refreshEwPayBalanceCards;
window.loadEwPayBalanceForCart = loadEwPayBalanceForCart;
window.mountCartPaymentUiIfNeeded = mountCartPaymentUiIfNeeded;
window.validateEwPayCheckout = function () {
  if (window.__ervCartSelectedPayment !== "ew_pay") return { ok: true };
  var grand = getCartGrandTotalForPay();
  if (grand == null) {
    return { ok: false, message: "حدّد موقع التوصيل لحساب المبلغ قبل الدفع بـ ERVENOW PAY" };
  }
  if (__ervEwPayBalanceCache == null) {
    return { ok: false, message: "جارٍ التحقق من رصيد المحفظة…" };
  }
  if (roundMoney(__ervEwPayBalanceCache) < roundMoney(grand)) {
    return { ok: false, message: "رصيد المحفظة غير كافٍ", insufficient: true };
  }
  return { ok: true };
};

function resolveCartDeliveryFeeArg(cart) {
  if (!cartHasStoreProducts(cart)) return 0;
  if (cartIsPickupOnly(cart)) return 0;
  hydrateDeliveryLocationForCart(cart);
  if (cartHasDeliverySnapshot(cart)) {
    var snapFee = resolveCartDeliveryFeeFromItems(cart);
    if (snapFee !== undefined) return snapFee;
  }
  var storeFee = readCartStore().totals && readCartStore().totals.deliveryFee;
  if (Number.isFinite(Number(storeFee))) return roundMoney(Number(storeFee));
  if (typeof window.__ervCartDeliveryFee === "number" && Number.isFinite(window.__ervCartDeliveryFee))
    return window.__ervCartDeliveryFee;
  return undefined;
}

async function refreshCartDeliveryFee() {
  var cart = getCart();
  var storeTotals = readCartStore().totals || {};
  var prevFee = storeTotals.deliveryFee;
  var nextFee = prevFee;

  try {
    hydrateDeliveryLocationForCart(cart);
    cart = getCart();
    if (cartIsPickupOnly(cart) || !cartHasStoreProducts(cart)) {
      nextFee = 0;
    } else if (cartHasDeliverySnapshot(cart)) {
      nextFee = resolveCartDeliveryFeeFromItems(cart);
      if (nextFee === undefined) nextFee = undefined;
    } else {
      var loc = resolveEffectiveDeliveryLocation(cart);
      if (!loc) {
        nextFee = undefined;
        persistCartDeliveryFee(undefined);
        if (typeof renderCartPage === "function") renderCartPage({ skipDeliveryRefresh: true });
        return;
      }
      var sid = null;
      getCartStoreIds().forEach(function (id) {
        if (!sid) sid = id;
      });
      if (!sid || !window.PlatformAPI || typeof PlatformAPI.apiUrl !== "function") {
        nextFee = undefined;
      } else {
        var url =
          PlatformAPI.apiUrl("/api/store/public/" + encodeURIComponent(sid)) +
          "?user_lat=" +
          encodeURIComponent(loc.lat) +
          "&user_lng=" +
          encodeURIComponent(loc.lng);
        var res = await fetch(url);
        var j = await res.json().catch(function () {
          return {};
        });
        var km = j && j.store && j.store.distance_km;
        if (typeof km === "number" && Number.isFinite(km)) {
          nextFee = Math.round(km * 2.3 * 100) / 100;
        } else {
          nextFee = undefined;
        }
      }
    }
  } catch (_e) {
    /* keep previous fee on error */
  }

  var feeChanged = nextFee !== prevFee;
  persistCartDeliveryFee(nextFee);

  if (feeChanged && typeof renderCartPage === "function") {
    renderCartPage({ skipDeliveryRefresh: true });
  }
}

function requestCartDeliveryGps() {
  var st = document.getElementById("geoStatus");
  if (!navigator.geolocation) {
    if (st) st.textContent = "المتصفح لا يدعم الموقع.";
    return;
  }
  if (st) st.textContent = "جاري تحديد الموقع…";
  navigator.geolocation.getCurrentPosition(
    function (p) {
      var addrEl = document.getElementById("customer_address");
      var loc = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        address: (addrEl && addrEl.value.trim()) || "موقع GPS",
        fulfillment_mode: getCartFulfillmentMode(getCart()) || "ervenow_delivery",
      };
      var storeIds = getCartStoreIds();
      if (storeIds.size) loc.store_id = storeIds.values().next().value;
      saveDeliveryLocation(loc);
      var cart = getCart();
      if (patchCartItemsWithLocation(cart, loc)) saveCart(cart);
      var card = document.getElementById("storeDeliveryCard");
      if (card) card.setAttribute("data-loc-editor-open", "0");
      if (st) st.textContent = "تم حفظ موقع التوصيل.";
      void refreshCartDeliveryFee();
      syncCartDeliveryLocationUi();
    },
    function () {
      if (st) st.textContent = "تعذر الوصول للموقع — تأكد من الإذن.";
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
  );
}

function saveCartDeliveryLocationFromEditor() {
  var g = getCartPendingGeo();
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) {
    showError("حدّد الموقع عبر GPS أولاً");
    return;
  }
  var addrEl = document.getElementById("customer_address");
  var loc = {
    lat: g.lat,
    lng: g.lng,
    address: (addrEl && addrEl.value.trim()) || "عنوان التوصيل",
    fulfillment_mode: getCartFulfillmentMode(getCart()) || "ervenow_delivery",
  };
  var storeIds = getCartStoreIds();
  if (storeIds.size) loc.store_id = storeIds.values().next().value;
  saveDeliveryLocation(loc);
  var cart = getCart();
  if (patchCartItemsWithLocation(cart, loc)) saveCart(cart);
  var card = document.getElementById("storeDeliveryCard");
  if (card) card.setAttribute("data-loc-editor-open", "0");
  void refreshCartDeliveryFee();
  syncCartDeliveryLocationUi();
  showSuccess("تم حفظ موقع التوصيل");
}

function syncCartDeliveryLocationUi() {
  var cart = getCart();
  var card = document.getElementById("storeDeliveryCard");
  if (!card) return;

  hydrateDeliveryLocationForCart(cart);

  if (!cart.length || !cartHasStoreProducts(cart) || cartIsPickupOnly(cart)) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  var savedView = document.getElementById("deliveryLocSavedView");
  var editorView = document.getElementById("deliveryLocEditorView");
  var displayEl = document.getElementById("deliveryLocDisplay");
  var statusEl = document.getElementById("geoStatus");
  var loc = resolveEffectiveDeliveryLocation(cart);
  var editorOpen = card.getAttribute("data-loc-editor-open") === "1";

  if (loc && !editorOpen) {
    if (savedView) savedView.hidden = false;
    if (editorView) editorView.hidden = true;
    var label = loc.address || loc.lat.toFixed(5) + "، " + loc.lng.toFixed(5);
    var modeLabel = fulfillmentLabelAr(getCartFulfillmentMode(cart));
    if (displayEl) {
      displayEl.textContent = document.body.classList.contains("cart-checkout-v3") ? label : "📍 " + label;
    }
    if (statusEl) statusEl.textContent = modeLabel ? "✓ " + modeLabel : "✓ موقع التوصيل محفوظ";
    return;
  }

  if (savedView) savedView.hidden = !loc;
  if (editorView) editorView.hidden = false;
  if (loc && displayEl) {
    var locLabel = loc.address || loc.lat.toFixed(5) + "، " + loc.lng.toFixed(5);
    displayEl.textContent = document.body.classList.contains("cart-checkout-v3") ? locLabel : "📍 " + locLabel;
  }
  if (statusEl) {
    statusEl.textContent = loc
      ? "عدّل العنوان أو اضغط GPS ثم «حفظ الموقع»."
      : "حدّد موقع التوصيل لإتمام الطلب — لن يُطلب GPS تلقائياً.";
  }
}

function initCartDeliveryLocationUi() {
  if (!document.getElementById("storeDeliveryCard")) return;
  var changeBtn = document.getElementById("btnChangeLocation");
  var geoBtn = document.getElementById("btnGeo");
  var saveBtn = document.getElementById("btnSaveLocation");
  if (changeBtn && !changeBtn.__ervBound) {
    changeBtn.__ervBound = true;
    changeBtn.onclick = function () {
      var card = document.getElementById("storeDeliveryCard");
      if (card) card.setAttribute("data-loc-editor-open", "1");
      syncCartDeliveryLocationUi();
    };
  }
  if (geoBtn && !geoBtn.__ervBound) {
    geoBtn.__ervBound = true;
    geoBtn.onclick = function () {
      requestCartDeliveryGps();
    };
  }
  if (saveBtn && !saveBtn.__ervBound) {
    saveBtn.__ervBound = true;
    saveBtn.onclick = function () {
      saveCartDeliveryLocationFromEditor();
    };
  }
  syncCartDeliveryLocationUi();
}

function renderCartLinesList(listEl, cart) {
  if (!listEl) return;
  if (!cart.length) {
    listEl.innerHTML = "";
    listEl.classList.remove("lp-cart-panel__list--scroll");
    return;
  }
  listEl.innerHTML = cart.map(renderCartLineHtml).join("");
  listEl.classList.add("lp-cart-panel__list--scroll");
}

/** يملأ لوحة السلة في الهيدر إن وُجدت في الصفحة */
function renderHeaderCartPreview() {
  var list = document.getElementById("lpCartLines");
  var empty = document.getElementById("lpCartEmpty");
  var emptyCta = document.getElementById("lpCartEmptyCta");
  if (!list || !document.getElementById("lpCartPanel")) return;

  var cart = getCart();
  updateCartPanelHeader(cart);
  setCartPanelHasItems(!!cart.length);

  if (!cart.length) {
    renderCartLinesList(list, []);
    if (empty) empty.hidden = false;
    if (emptyCta) emptyCta.hidden = false;
    var co0 = document.getElementById("lpCartCheckoutBtn");
    if (co0) co0.disabled = true;
    applyCartFinancialsToUi({}, { empty: true });
    clearPaymentMethodIconContainers();
    syncLpCartAccordionMeta();
    return;
  }
  if (empty) empty.hidden = true;
  if (emptyCta) emptyCta.hidden = true;
  renderCartLinesList(list, cart);
  applyCartFinancialsToUi(computeErvCartBreakdown(cart, resolveCartDeliveryFeeArg(cart)));
  mountCartPaymentUiIfNeeded();
  if (window.__ervCartSelectedPayment === "ew_pay") loadEwPayBalanceForCart();
  else refreshEwPayBalanceCards();
  syncLpCartAccordionMeta();
  syncLpCartCheckoutBtn();
}

function syncCartCheckoutButtons() {
  var main = getCartCheckoutButtonEl();
  var mobile = document.getElementById("cartMobileCheckoutBtn");
  if (!mobile) return;
  if (main) {
    mobile.textContent = main.textContent;
    mobile.disabled = !!main.disabled;
    return;
  }
  var hasItems = !!getCart().length;
  var blocked = !hasItems || cartCheckoutBlockedByEwPay();
  mobile.disabled = blocked;
  mobile.textContent = hasItems ? "إتمام الطلب" : "بدء الدفع";
}

function syncCartMobileBar(cart, breakdown) {
  var bar = document.getElementById("cartMobileBar");
  if (!bar) return;
  var has = cart && cart.length;
  bar.hidden = !has;
  document.body.classList.toggle("cart-page-has-items", !!has);
  if (has && breakdown && breakdown.grandTotal != null) {
    var el = document.getElementById("cartMobileGrand");
    if (el) el.innerHTML = ervFmtMoney(breakdown.grandTotal) + ' <small class="lp-cart-panel__cur">ر.س</small>';
    var lpTotal = document.getElementById("lpCartTotal");
    if (lpTotal) lpTotal.innerHTML = ervMoneyCellHtml(breakdown.grandTotal);
  }
  syncCartCheckoutButtons();
}

/** صفحة السلة الكاملة — يُستدعى من cart.html */
function renderCartPage(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var list = document.getElementById("lpCartLines") || document.getElementById("cartList");
  var countEl = document.getElementById("cartItemsCount");
  var emptyMsg = document.getElementById("lpCartEmpty");
  var emptyCta = document.getElementById("lpCartEmptyCta");
  var legacyEmpty = document.getElementById("cartPageEmpty");
  if (!list) return;

  var cart = getCart();
  setCartPanelHasItems(!!cart.length);
  if (document.getElementById("lpCartPanel") && typeof renderHeaderCartPreview === "function") {
    renderHeaderCartPreview();
  }

  if (!cart.length) {
    renderCartLinesList(list, []);
    if (emptyMsg) emptyMsg.hidden = false;
    if (emptyCta) emptyCta.hidden = false;
    if (legacyEmpty) legacyEmpty.hidden = false;
    if (countEl) countEl.textContent = "لا توجد قطع في السلة";
    applyCartFinancialsToUi({}, { empty: true });
    syncLpCartAccordionMeta();
    syncCartMobileBar([], null);
    persistCartDeliveryFee(undefined);
    if (typeof window.refreshGuestCartBanner === "function") window.refreshGuestCartBanner();
    syncCartDeliveryLocationUi();
    return;
  }

  if (emptyMsg) emptyMsg.hidden = true;
  if (emptyCta) emptyCta.hidden = true;
  if (legacyEmpty) legacyEmpty.hidden = true;
  var totalQty = cartTotalPieceCount(cart);
  if (countEl) countEl.textContent = totalQty + (totalQty === 1 ? " قطعة" : " قطع");
  renderCartLinesList(list, cart);
  var breakdown = computeErvCartBreakdown(cart, resolveCartDeliveryFeeArg(cart));
  applyCartFinancialsToUi(breakdown);
  syncCartMobileBar(cart, breakdown);
  if (typeof window.refreshGuestCartBanner === "function") window.refreshGuestCartBanner();
  syncCartDeliveryLocationUi();
  syncCheckoutV3Chrome(cart, breakdown);
  if (!opts.skipDeliveryRefresh && typeof refreshCartDeliveryFee === "function") {
    void refreshCartDeliveryFee();
  }
  mountCartPaymentUiIfNeeded();
  if (window.__ervCartSelectedPayment === "ew_pay") loadEwPayBalanceForCart();
  else refreshEwPayBalanceCards();
  syncLpCartAccordionMeta();
  syncCartPageCheckoutBtn();
}

window.renderCartPage = renderCartPage;
window.renderCartLineHtml = renderCartLineHtml;

document.addEventListener(
  "toggle",
  function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("lp-cart-accordion--fin")) {
      t.setAttribute("data-erv-fin-touched", "1");
    }
  },
  true
);
window.syncCartCheckoutButtons = syncCartCheckoutButtons;
window.syncCartPageCheckoutBtn = syncCartPageCheckoutBtn;
window.syncLpCartCheckoutBtn = syncLpCartCheckoutBtn;
window.getCartCheckoutButtonEl = getCartCheckoutButtonEl;

function safeClick(fn) {
  let locked = false;
  return async function (...args) {
    if (locked) return;
    locked = true;
    try {
      await fn.apply(this, args);
    } finally {
      locked = false;
    }
  };
}
window.safeClick = safeClick;

function checkoutIdempotencyKey() {
  var KEY = "ervenow:checkout-idem";
  try {
    var saved = sessionStorage.getItem(KEY);
    if (saved && String(saved).trim()) return String(saved).trim();
  } catch (_e) {}
  var key =
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : "checkout-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
  try {
    sessionStorage.setItem(KEY, key);
  } catch (_e2) {}
  return key;
}

function clearCheckoutIdempotencyKey() {
  try {
    sessionStorage.removeItem("ervenow:checkout-idem");
  } catch (_e) {}
}

function resolvePostCheckoutRedirectUrl(orders) {
  var list = (orders || []).filter(function (o) {
    return o && o.id;
  });
  if (list.length !== 1) return "/my-orders";
  var o = list[0];
  var breakdown = o.breakdown && typeof o.breakdown === "object" ? o.breakdown : {};
  if (String(breakdown.fulfillment || "").toLowerCase() === "pickup") return "/my-orders";
  if (Number.isFinite(Number(o.drop_lat)) && Number.isFinite(Number(o.drop_lng))) {
    return "/track?id=" + encodeURIComponent(String(o.id));
  }
  return "/my-orders";
}

async function runExecuteCartCheckout() {
  var cart = window.ErvenowCart ? ErvenowCart.get() : getCart();
  if (!cart.length) {
    showError("السلة فارغة");
    return;
  }

  var payMethod =
    typeof window.getSelectedCartPaymentMethod === "function" ? window.getSelectedCartPaymentMethod() : null;
  if (!payMethod) {
    showError("اختر وسيلة الدفع");
    return;
  }
  if (payMethod === "ew_pay" && typeof window.validateEwPayCheckout === "function") {
    var ewCheck = window.validateEwPayCheckout();
    if (!ewCheck.ok) {
      showError(ewCheck.message || "رصيد المحفظة غير كافٍ");
      if (typeof window.loadEwPayBalanceForCart === "function") void window.loadEwPayBalanceForCart();
      return;
    }
  }

  var btn =
    (typeof getCartCheckoutButtonEl === "function" && getCartCheckoutButtonEl()) ||
    document.getElementById("lpCartCheckoutBtn") ||
    document.getElementById("checkoutBtn");

  var token =
    (window.PlatformAPI && typeof window.PlatformAPI.getToken === "function" && window.PlatformAPI.getToken()) ||
    localStorage.getItem("token") ||
    "";

  if (!token || !String(token).trim()) {
    window.location.href = "/login?mode=register&role=customer&next=" + encodeURIComponent("/checkout");
    return;
  }

  if (!window.PlatformAPI || typeof window.PlatformAPI.api !== "function") {
    showError("تعذّر الاتصال بالخادم — حدّث الصفحة");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = "جارٍ الإرسال...";
  }
  if (typeof syncCartCheckoutButtons === "function") syncCartCheckoutButtons();

  var idemKey = checkoutIdempotencyKey();
  var redirecting = false;

  try {
    hydrateDeliveryLocationForCart(cart);
    cart = getCart();

    var deliveryFee = resolveCartDeliveryFeeArg(cart);
    if (deliveryFee === undefined && cartNeedsDeliveryLocation(cart)) {
      await refreshCartDeliveryFee();
      deliveryFee = resolveCartDeliveryFeeArg(cart);
    } else if (deliveryFee !== undefined) {
      persistCartDeliveryFee(deliveryFee);
    }

    var financialIntent =
      window.ErvenowCart && typeof ErvenowCart.financialIntent === "function"
        ? ErvenowCart.financialIntent(cart, deliveryFee, payMethod)
        : null;
    if (financialIntent && financialIntent.delivery_pending && cartNeedsDeliveryLocation(cart)) {
      var effLoc0 = resolveEffectiveDeliveryLocation(cart);
      if (!effLoc0) {
        showError("حدّد موقع التوصيل لإتمام الطلب");
        var card0 = document.getElementById("storeDeliveryCard");
        if (card0) card0.setAttribute("data-loc-editor-open", "1");
        syncCartDeliveryLocationUi();
        return;
      }
      deliveryFee = resolveCartDeliveryFeeArg(cart);
      if (deliveryFee === undefined) {
        await refreshCartDeliveryFee();
        deliveryFee = resolveCartDeliveryFeeArg(cart);
      }
      if (deliveryFee !== undefined) persistCartDeliveryFee(deliveryFee);
      financialIntent =
        window.ErvenowCart && typeof ErvenowCart.financialIntent === "function"
          ? ErvenowCart.financialIntent(cart, deliveryFee, payMethod)
          : financialIntent;
      if (financialIntent && financialIntent.delivery_pending) {
        showError("تعذّر حساب أجرة التوصيل — جرّب «تغيير الموقع» أو أعد فتح المتجر");
        return;
      }
    }

    var payload = { items: cart, payment_method: payMethod, financial_intent: financialIntent };
    if (payMethod === "ew_pay") {
      payload.paid = true;
      payload.payment_status = "paid";
    }

    if (cartNeedsDeliveryLocation(cart)) {
      var effLoc = resolveEffectiveDeliveryLocation(cart);
      if (!effLoc) {
        showError("حدّد موقع التوصيل لإتمام الطلب");
        syncCartDeliveryLocationUi();
        return;
      }
      payload.customer_lat = effLoc.lat;
      payload.customer_lng = effLoc.lng;
      payload.customer_address =
        effLoc.address ||
        ((document.getElementById("customer_address") && document.getElementById("customer_address").value.trim()) ||
          "");
    } else if (cartHasDeliverySnapshot(cart) && typeof window.getCartDeliveryContext === "function") {
      var delCtx = window.getCartDeliveryContext(cart);
      if (delCtx && Number.isFinite(delCtx.drop_lat) && Number.isFinite(delCtx.drop_lng)) {
        payload.customer_lat = delCtx.drop_lat;
        payload.customer_lng = delCtx.drop_lng;
        payload.customer_address = delCtx.drop_address || "";
      }
    }

    var data = await window.PlatformAPI.api("/api/order/create", {
      method: "POST",
      body: payload,
      idempotencyKey: idemKey,
    });

    clearCheckoutIdempotencyKey();
    var orders = (data && data.orders) || [];
    var orderNum = orders[0] && (orders[0].order_number || orders[0].id);
    var successMsg =
      orders.length === 1 && orderNum
        ? "تم إنشاء الطلب #" + orderNum + " — جاري التوجيه للتتبع…"
        : "تم إنشاء " + orders.length + " طلب — جاري التوجيه…";
    showSuccess(successMsg);

    if (window.ErvenowCart) ErvenowCart.clear();
    else clearCartStoreCompletely();

    redirecting = true;
    window.location.href = resolvePostCheckoutRedirectUrl(orders);
  } catch (e) {
    var msg = String((e && e.message) || "حدث خطأ، حاول مرة أخرى");
    if (/رصيد|غير كاف|insufficient/i.test(msg)) {
      showError(msg);
      if (typeof window.loadEwPayBalanceForCart === "function") void window.loadEwPayBalanceForCart();
      return;
    }
    if (/401|غير مصرح|token/i.test(msg)) {
      window.location.href = "/login?mode=register&role=customer&next=" + encodeURIComponent("/checkout");
      return;
    }
    showError(msg);
  } finally {
    if (!redirecting && btn) {
      btn.disabled = false;
      btn.innerText = "إتمام الطلب";
    }
    if (!redirecting && typeof syncCartCheckoutButtons === "function") syncCartCheckoutButtons();
    if (!redirecting && typeof syncCartPageCheckoutBtn === "function") syncCartPageCheckoutBtn();
  }
}

window.executeCartCheckout = safeClick(runExecuteCartCheckout);
window.checkout = window.executeCartCheckout;

function showSuccess(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.bottom = "20px";
  el.style.right = "20px";
  el.style.background = "green";
  el.style.color = "#fff";
  el.style.padding = "10px";
  el.style.borderRadius = "8px";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showError(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position = "fixed";
  el.style.bottom = "20px";
  el.style.right = "20px";
  el.style.background = "red";
  el.style.color = "#fff";
  el.style.padding = "10px";
  el.style.borderRadius = "6px";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

document.addEventListener("click", function (ev) {
  if (ev.target.closest && ev.target.closest(".erv-pay-luxe")) return;
  closeAllPayLuxePickers();
});

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") closeAllPayLuxePickers();
});

document.addEventListener("click", function (ev) {
  var btn = ev.target.closest && ev.target.closest(".erv-pay-card[data-pay-method]");
  if (!btn) return;
  var root = btn.closest(".erv-pay-cards");
  if (!root || !root.id) return;
  setSelectedPaymentForContainer(root.id, btn.getAttribute("data-pay-method"));
});

document.addEventListener("change", function (ev) {
  var sel = ev.target;
  if (!sel || !sel.classList || !sel.classList.contains("erv-pay-select")) return;
  if (!sel.id) return;
  var method = sel.value;
  if (method) setSelectedPaymentFromSelect(sel.id, method);
  else window.__ervCartSelectedPayment = null;
});

(function loadDeliveryEngineFlagsForCart() {
  if (typeof fetch !== "function") return;
  var base =
    window.PlatformAPI && typeof window.PlatformAPI.apiUrl === "function"
      ? window.PlatformAPI.apiUrl("/api/store/delivery-engine/flags")
      : "/api/store/delivery-engine/flags";
  fetch(base)
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (j && j.DELIVERY_ENGINE_CHECKOUT) window.__ervDeliveryEngineCheckout = true;
      if (typeof window.renderCartPage === "function") window.renderCartPage();
      else if (typeof window.renderHeaderCartPreview === "function") window.renderHeaderCartPreview();
    })
    .catch(function () {});
})();

document.addEventListener("click", function (e) {
  var removeBtn = e.target && e.target.closest && e.target.closest("[data-cart-remove]");
  if (removeBtn) {
    removeFromCart(removeBtn.getAttribute("data-cart-remove"));
    if (typeof window.renderCartPage === "function") window.renderCartPage();
    return;
  }
  var qtyBtn = e.target && e.target.closest && e.target.closest("[data-cart-qty-delta]");
  if (qtyBtn) {
    var id = qtyBtn.getAttribute("data-cart-id");
    var delta = Number(qtyBtn.getAttribute("data-cart-qty-delta")) || 0;
    if (id && delta) adjustCartQty(id, delta);
  }
});

/** مصدر الحقيقة الوحيد للسلة — ERVENOW Unified Cart */
var ErvenowCart = {
  STORAGE_KEY: "cart",
  VAT_RATE: ERV_VAT_RATE,
  PLATFORM_COMMISSION_RATE: ERV_PLATFORM_COMMISSION_RATE,
  DELIVERY_SAR_PER_KM: ERV_DELIVERY_SAR_PER_KM,
  get: getCart,
  save: saveCart,
  add: addToCart,
  remove: removeFromCart,
  clear: function () {
    clearCartStoreCompletely();
    ErvenowCart.render();
  },
  adjustQty: adjustCartQty,
  getStoreIds: getCartStoreIds,
  lineKind: cartLineKind,
  subtotal: cartSubtotal,
  goodsSubtotal: cartGoodsSubtotal,
  breakdown: computeErvCartBreakdown,
  financialIntent: buildFinancialIntent,
  render: function (opts) {
    if (document.getElementById("cartList") || document.getElementById("lpCartPageRoot")) {
      renderCartPage(opts);
    } else {
      renderHeaderCartPreview();
    }
  },
  renderPanel: renderHeaderCartPreview,
  renderPage: renderCartPage,
  updateCount: updateCartCount,
  goCheckout: handleLpCartCheckoutClick,
  setDeliveryFee: function (fee) {
    if (Number.isFinite(Number(fee)) && Number(fee) >= 0) {
      persistCartDeliveryFee(Number(fee));
    } else {
      persistCartDeliveryFee(undefined);
    }
    ErvenowCart.render();
  },
  resolveDeliveryFee: resolveCartDeliveryFeeArg,
  addService: function (item, opts) {
    if (typeof window !== "undefined" && window.ErvenowServiceCart && typeof window.ErvenowServiceCart.add === "function") {
      return window.ErvenowServiceCart.add(item, opts);
    }
    return { ok: false, message: "حمّل service-cart.js بعد cart.js لإضافة الخدمات" };
  },
};

window.ErvenowCart = ErvenowCart;
window.getCart = function () {
  return ErvenowCart.get();
};
window.saveCart = function (cart) {
  return ErvenowCart.save(cart);
};
window.addToCart = function (item) {
  return ErvenowCart.add(item);
};
window.removeFromCart = function (id) {
  return ErvenowCart.remove(id);
};

document.addEventListener("DOMContentLoaded", function () {
  hydrateCartPaymentFromStore();
  ErvenowCart.updateCount();
  initCartDeliveryLocationUi();
});
window.addEventListener("storage", function () {
  __ervCartStoreCache = null;
  hydrateCartPaymentFromStore();
  ErvenowCart.updateCount();
});
