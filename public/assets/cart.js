function getCart() {
  try {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartCount();
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
        data: Object.assign({}, cur.data || {}, { qty: newQty, unit_price: unit }),
      });
      saveCart(cart);
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
    if (document.getElementById("cartList") && typeof renderCartPage === "function") renderCartPage();
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

/** سطر واحد — يُستخدم في لوحة الهيدر وصفحة السلة */
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
  var thumbIcon = { product: "🛍", delivery: "🚚", service: "⚡" };
  return (
    '<article class="lp-cart-line" data-cart-id="' +
    idAttr +
    '">' +
    '<div class="lp-cart-line__row">' +
    '<div class="lp-cart-line__thumb"><span class="lp-cart-line__thumb-icon" aria-hidden="true">' +
    (thumbIcon[kind] || "📦") +
    "</span></div>" +
    '<div class="lp-cart-line__main">' +
    '<div class="lp-cart-line__head">' +
    '<span class="lp-cart-line__badge lp-cart-line__badge--' +
    kind +
    '">' +
    kindLabel[kind] +
    "</span>" +
    '<strong class="lp-cart-line__title">' +
    escCartHtml(item.title || "طلب") +
    "</strong>" +
    "</div>" +
    (metaBits.length ? '<p class="lp-cart-line__meta">' + metaBits.join(" · ") + "</p>" : "") +
    '<div class="lp-cart-line__actions">' +
    qtyBlock +
    '<button type="button" class="lp-cart-line__remove" data-cart-remove="' +
    idAttr +
    '" aria-label="حذف من السلة">' +
    '<span class="lp-cart-line__remove-icon" aria-hidden="true">🗑</span> حذف</button>' +
    "</div>" +
    "</div>" +
    '<div class="lp-cart-line__aside">' +
    '<span class="lp-cart-line__price">' +
    priceStr +
    " <small>ر.س</small></span>" +
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

function syncLpCartCheckoutBtn() {
  var btn = document.getElementById("lpCartCheckoutBtn");
  if (!btn) return;
  btn.disabled = !getCart().length;
  btn.textContent = "إتمام العملية";
}

function syncCartPageCheckoutBtn() {
  var btn = document.getElementById("checkoutBtn");
  if (!btn) return;
  btn.disabled = !getCart().length;
  btn.textContent = "إتمام الطلب";
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
  ["lpCartSummary", "lpCartFooter"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.hidden = !hasItems;
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
  if (checkoutCol) checkoutCol.classList.toggle("cart-checkout-col--dim", !hasItems);
}

function updateCartPanelHeader(cart) {
  var title = document.getElementById("lpCartDialogTitle");
  var sub = document.getElementById("lpCartPanelSub");
  if (title) title.textContent = "السلة";
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

function cartSubtotal(cart) {
  return roundMoney(
    (cart || []).reduce(function (s, it) {
      return s + (Number(it && it.price) || 0);
    }, 0)
  );
}

function cartHasStoreProducts(cart) {
  return (cart || []).some(function (i) {
    return cartLineKind(i) === "product";
  });
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
function computeErvCartBreakdown(cart, deliveryFee) {
  var sub = cartSubtotal(cart);
  var delKnown = Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) >= 0;
  var del = delKnown ? roundMoney(Number(deliveryFee)) : 0;
  var deliveryPending = cartHasStoreProducts(cart) && !delKnown;
  var vat = roundMoney((sub + del) * ERV_VAT_RATE);
  var platformCommission = roundMoney(sub * ERV_PLATFORM_COMMISSION_RATE);
  var grandTotal = roundMoney(sub + del + vat);
  return {
    subtotal: sub,
    delivery: del,
    deliveryPending: deliveryPending,
    vat: vat,
    platformCommission: platformCommission,
    grandTotal: grandTotal,
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
  setMoney("lpCartVat", b.vat);
  setMoney("cartFinVat", b.vat);
  var commEl = document.getElementById("lpCartComm");
  if (commEl) commEl.textContent = ervFmtMoney(b.platformCommission);
  setMoney("cartFinComm", b.platformCommission);
  setMoney("lpCartTotal", b.grandTotal);
  setMoney("cartFinGrand", b.grandTotal);
  syncLpCartCheckoutBtn();
  syncCartPageCheckoutBtn();
}

window.computeErvCartBreakdown = computeErvCartBreakdown;
window.estimateStoreDeliveryFromKm = estimateStoreDeliveryFromKm;
window.cartSubtotal = cartSubtotal;
window.cartHasStoreProducts = cartHasStoreProducts;

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
    ew_pay: "EW PAY",
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
    ew_pay: "EW PAY",
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
    ew_pay: "محفظة المنصة",
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
    if (role === "merchant" || role === "restaurant") {
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
    window.__ervCartSelectedPayment = null;
    var ew0 = document.getElementById(selectId === "lpCartPaySelect" ? "lpCartEwPayDetail" : "cartEwPayDetail");
    if (ew0) ew0.hidden = true;
    syncPayLuxeTrigger(selectId, "");
    syncLpCartCheckoutBtn();
    syncCartPageCheckoutBtn();
    return;
  }
  try {
    localStorage.setItem("erv_cart_payment_method", method);
  } catch (e2) {}
  window.__ervCartSelectedPayment = method;

  var ewMap = { lpCartPaySelect: "lpCartEwPayDetail", cartPaySelect: "cartEwPayDetail" };
  var balMap = { lpCartPaySelect: "lpCartEwPayBalance", cartPaySelect: "cartEwPayBalance" };
  var ewEl = document.getElementById(ewMap[selectId]);
  var balEl = document.getElementById(balMap[selectId]);
  if (method === "ew_pay" && ewEl) {
    ewEl.hidden = false;
    if (balEl) balEl.textContent = "…";
    fetchWalletBalanceForCart().then(function (bal) {
      var ew = document.getElementById(ewMap[selectId]);
      if (!balEl || !ew || ew.hidden) return;
      balEl.textContent = bal == null || !Number.isFinite(bal) ? "—" : ervFmtMoney(bal);
    });
  } else if (ewEl) {
    ewEl.hidden = true;
  }
  syncPayLuxeTrigger(selectId, method);
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
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  try {
    localStorage.setItem("erv_cart_payment_method", method);
  } catch (e2) {}
  window.__ervCartSelectedPayment = method;

  var ewMap = { lpCartPayIcons: "lpCartEwPayDetail", cartPayIcons: "cartEwPayDetail" };
  var balMap = { lpCartPayIcons: "lpCartEwPayBalance", cartPayIcons: "cartEwPayBalance" };
  var ewEl = document.getElementById(ewMap[containerId]);
  var balEl = document.getElementById(balMap[containerId]);
  if (method === "ew_pay" && ewEl) {
    ewEl.hidden = false;
    if (balEl) balEl.textContent = "…";
    fetchWalletBalanceForCart().then(function (bal) {
      var wrap = document.getElementById(ewMap[containerId]);
      if (!balEl || !wrap || wrap.hidden) return;
      balEl.textContent = bal == null || !Number.isFinite(bal) ? "—" : ervFmtMoney(bal);
    });
  } else if (ewEl) {
    ewEl.hidden = true;
  }
}

function buildPaymentCardButton(key, opts) {
  opts = opts || {};
  var src = ERV_PAY_ICON_SRC[key];
  if (!src) return null;
  var meta = paymentCardDisplay(key);
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "erv-pay-card" +
    (key === "ew_pay" ? " erv-pay-card--ew" : "") +
    (opts.bnpl ? " erv-pay-card--bnpl" : "");
  if (opts.bnpl && key === "tabby") btn.classList.add("erv-pay-card--tabby");
  if (opts.bnpl && key === "tamara") btn.classList.add("erv-pay-card--tamara");
  btn.setAttribute("data-pay-method", key);
  btn.setAttribute("aria-pressed", "false");
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
    var ordered = ERV_PAYMENT_KEYS_ORDER.filter(function (key) {
      return methods[key] && ERV_PAY_ICON_SRC[key];
    });
    var gridKeys = ordered.filter(function (k) {
      return !ERV_PAYMENT_BNPL[k];
    });
    var bnplKeys = ordered.filter(function (k) {
      return ERV_PAYMENT_BNPL[k];
    });

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
    var saved = null;
    try {
      saved = localStorage.getItem("erv_cart_payment_method");
    } catch (e3) {}
    var pick = saved && methods[saved] ? saved : first;
    if (pick) setSelectedPaymentForContainer(containerId, pick);
  });
}

function renderPaymentMethodIconsInto(containerId) {
  renderPaymentMethodCardsInto(containerId);
}

var ERV_PAY_LUXE_WRAP = { lpCartPaySelect: "lpCartPayLuxeWrap", cartPaySelect: "cartPayLuxeWrap" };

var ERV_PAY_LUXE_GROUPS = [
  { label: "محفظة المنصة", keys: ["ew_pay"] },
  { label: "البطاقات والمحافظ", keys: ["mada", "visa", "mastercard", "apple_pay", "stc_pay"] },
  { label: "الدفع عند الاستلام", keys: ["cash_on_delivery"] },
  { label: "تقسيط بدون فوائد", keys: ["tabby", "tamara"] },
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
    '<div class="erv-pay-luxe erv-pay-luxe--inline" data-select-id="' +
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
    var ordered = ERV_PAYMENT_KEYS_ORDER.filter(function (key) {
      return methods[key];
    });
    ordered.forEach(function (key) {
      var d = paymentCardDisplay(key);
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = d.hint ? d.title + " — " + d.hint : d.title;
      sel.appendChild(opt);
    });
    buildPayLuxeOptions(selectId, ordered);
    var saved = null;
    try {
      saved = localStorage.getItem("erv_cart_payment_method");
    } catch (e3) {}
    var first = ordered[0];
    var pick = saved && methods[saved] ? saved : "";
    if (pick) setSelectedPaymentFromSelect(selectId, pick);
    else syncPayLuxeTrigger(selectId, "");
  });
}

function handleLpCartCheckoutClick() {
  if (!getCart().length) return;
  window.location.href = "/cart";
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

function resolveCartDeliveryFeeArg(cart) {
  if (!cartHasStoreProducts(cart)) return 0;
  if (typeof window.__ervCartDeliveryFee === "number" && Number.isFinite(window.__ervCartDeliveryFee))
    return window.__ervCartDeliveryFee;
  return undefined;
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
    return;
  }
  if (empty) empty.hidden = true;
  if (emptyCta) emptyCta.hidden = true;
  renderCartLinesList(list, cart);
  applyCartFinancialsToUi(computeErvCartBreakdown(cart, resolveCartDeliveryFeeArg(cart)));
  syncLpCartCheckoutBtn();
}

function syncCartCheckoutButtons() {
  var main = document.getElementById("checkoutBtn");
  var mobile = document.getElementById("cartMobileCheckoutBtn");
  if (!main || !mobile) return;
  mobile.textContent = main.textContent;
  mobile.disabled = !!main.disabled;
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
  }
  syncCartCheckoutButtons();
}

/** صفحة السلة الكاملة — يُستدعى من cart.html */
function renderCartPage(opts) {
  opts = opts && typeof opts === "object" ? opts : {};
  var list = document.getElementById("cartList");
  var countEl = document.getElementById("cartItemsCount");
  var emptyBlock = document.getElementById("cartPageEmpty");
  if (!list) return;

  var cart = getCart();
  setCartPanelHasItems(!!cart.length);

  if (!cart.length) {
    list.innerHTML = "";
    if (emptyBlock) emptyBlock.hidden = false;
    if (countEl) countEl.textContent = "لا توجد قطع في السلة";
    applyCartFinancialsToUi({}, { empty: true });
    syncCartMobileBar([], null);
    delete window.__ervCartDeliveryFee;
    if (typeof window.refreshGuestCartBanner === "function") window.refreshGuestCartBanner();
    if (typeof window.refreshStoreDeliveryCard === "function") window.refreshStoreDeliveryCard();
    return;
  }

  if (emptyBlock) emptyBlock.hidden = true;
  var totalQty = cartTotalPieceCount(cart);
  if (countEl) countEl.textContent = totalQty + (totalQty === 1 ? " قطعة" : " قطع");
  renderCartLinesList(list, cart);
  var breakdown = computeErvCartBreakdown(cart, resolveCartDeliveryFeeArg(cart));
  applyCartFinancialsToUi(breakdown);
  syncCartMobileBar(cart, breakdown);
  if (typeof window.refreshGuestCartBanner === "function") window.refreshGuestCartBanner();
  if (typeof window.refreshStoreDeliveryCard === "function") window.refreshStoreDeliveryCard();
  if (!opts.skipDeliveryRefresh && typeof window.refreshCartDeliveryFee === "function") {
    void window.refreshCartDeliveryFee();
  }
  syncCartPageCheckoutBtn();
}

window.renderCartPage = renderCartPage;
window.renderCartLineHtml = renderCartLineHtml;
window.syncCartCheckoutButtons = syncCartCheckoutButtons;
window.syncCartPageCheckoutBtn = syncCartPageCheckoutBtn;
window.syncLpCartCheckoutBtn = syncLpCartCheckoutBtn;

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

document.addEventListener("DOMContentLoaded", function () {
  updateCartCount();
});
window.addEventListener("storage", updateCartCount);
