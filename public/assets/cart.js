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

function addToCart(item) {
  const cart = getCart();
  var newSid = item && item.data && item.data.store_id ? String(item.data.store_id).trim() : "";
  if (newSid) {
    var existingIds = getCartStoreIds();
    if (existingIds.size > 0 && !existingIds.has(newSid)) {
      alert("لا يمكن خلط منتجات من متجرين مختلفين. أفرغ السلة أو أتمّم الطلب أولاً.");
      return;
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
      return;
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
    return;
  }
  var initQty = Math.max(1, Math.min(99, Number(item.data && item.data.qty) || 1));
  var unitFromItem =
    Number(item.data && item.data.unit_price) ||
    (Number(item.price) && initQty > 0 ? Number(item.price) / initQty : 0);
  cart.push({
    id: Date.now(),
    type: item.type,
    title: item.title,
    price: Number(item.price) || 0,
    data: Object.assign({}, item.data || {}, {
      qty: initQty,
      unit_price: Number.isFinite(unitFromItem) && unitFromItem > 0 ? unitFromItem : undefined,
    }),
  });
  saveCart(cart);
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
}

/** أنواع طلبات التوصيل في السلة (browse) */
var ERV_DELIVERY_TYPES = {
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
    if (el) el.innerHTML = ervMoneyCellHtml(0);
  });
  ["lpCartDelNote", "cartFinDelNote"].forEach(function (nid) {
    var n = document.getElementById(nid);
    if (n) n.hidden = true;
  });
  clearPaymentMethodIconContainers();
}

function applyCartFinancialsToUi(b) {
  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function setMoney(id, val) {
    setHtml(id, ervMoneyCellHtml(val));
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
  setMoney("lpCartComm", b.platformCommission);
  setMoney("cartFinComm", b.platformCommission);
  setMoney("lpCartTotal", b.grandTotal);
  setMoney("cartFinGrand", b.grandTotal);
  renderPaymentMethodCardsInto("lpCartPayIcons");
  renderPaymentMethodCardsInto("cartPayIcons");
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
  ["lpCartEwPayDetail", "cartEwPayDetail"].forEach(function (eid) {
    var e = document.getElementById(eid);
    if (e) e.hidden = true;
  });
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

function setSelectedPaymentForContainer(containerId, method) {
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

function renderPaymentMethodCardsInto(containerId) {
  var root = document.getElementById(containerId);
  if (!root) return;
  root.innerHTML = "";
  var ewMap = { lpCartPayIcons: "lpCartEwPayDetail", cartPayIcons: "cartEwPayDetail" };
  var ewId = ewMap[containerId];
  if (ewId) {
    var ew0 = document.getElementById(ewId);
    if (ew0) ew0.hidden = true;
  }
  resolveCartPaymentMethodsForUi().then(function (methods) {
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

window.renderPaymentMethodCardsInto = renderPaymentMethodCardsInto;
window.renderPaymentMethodIconsInto = renderPaymentMethodIconsInto;
window.resolveCartPaymentMethodsForUi = resolveCartPaymentMethodsForUi;
window.getSelectedCartPaymentMethod = function () {
  return window.__ervCartSelectedPayment || null;
};

/** يملأ لوحة السلة في الهيدر إن وُجدت في الصفحة */
function renderHeaderCartPreview() {
  var list = document.getElementById("lpCartLines");
  var empty = document.getElementById("lpCartEmpty");
  if (!list || !document.getElementById("lpCartPanel")) return;

  var cart = getCart();

  if (!cart.length) {
    list.innerHTML = "";
    list.classList.remove("lp-cart-panel__list--scroll");
    if (empty) empty.hidden = false;
    var co0 = document.getElementById("lpCartCheckoutBtn");
    if (co0) co0.disabled = true;
    zeroCartFinancialsUi();
    clearPaymentMethodIconContainers();
    return;
  }
  if (empty) empty.hidden = true;

  var kindLabel = { product: "منتج", delivery: "توصيل", service: "خدمة" };
  list.innerHTML = cart
    .map(function (item) {
      var kind = cartLineKind(item);
      var data = item.data || {};
      var qty = Math.max(1, Number(data.qty) || 1);
      var metaBits = [];
      if (kind === "product") {
        metaBits.push("الكمية: " + qty);
        if (data.unit_price != null && Number.isFinite(Number(data.unit_price)))
          metaBits.push("الوحدة: " + Number(data.unit_price).toFixed(2) + " ر.س");
      } else {
        if (data.from && data.to)
          metaBits.push("من " + escCartHtml(data.from) + " إلى " + escCartHtml(data.to));
        else if (data.district) metaBits.push("الحي: " + escCartHtml(data.district));
        if (data.location) metaBits.push("تفاصيل: " + escCartHtml(data.location));
        metaBits.push("الكمية: " + qty);
      }
      var priceNum = Number(item.price) || 0;
      var priceStr;
      try {
        priceStr = priceNum.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (e2) {
        priceStr = priceNum.toFixed(2);
      }
      return (
        '<article class="lp-cart-line" data-cart-id="' +
        escCartHtml(String(item.id)) +
        '">' +
        '<div class="lp-cart-line__top">' +
        '<span class="lp-cart-line__badge lp-cart-line__badge--' +
        kind +
        '">' +
        kindLabel[kind] +
        "</span>" +
        '<strong class="lp-cart-line__title">' +
        escCartHtml(item.title || "طلب") +
        "</strong>" +
        "</div>" +
        '<p class="lp-cart-line__meta">' +
        metaBits.join(" · ") +
        "</p>" +
        '<div class="lp-cart-line__foot">' +
        '<span class="lp-cart-line__price">' +
        priceStr +
        " ر.س</span>" +
        '<button type="button" class="lp-cart-line__remove" data-cart-remove="' +
        escCartHtml(String(item.id)) +
        '" aria-label="حذف من السلة">حذف</button>' +
        "</div>" +
        "</article>"
      );
    })
    .join("");

  if (cart.length > 10) list.classList.add("lp-cart-panel__list--scroll");
  else list.classList.remove("lp-cart-panel__list--scroll");

  var hasStore = cartHasStoreProducts(cart);
  var feeArg;
  if (!hasStore) feeArg = 0;
  else if (typeof window.__ervCartDeliveryFee === "number" && Number.isFinite(window.__ervCartDeliveryFee))
    feeArg = window.__ervCartDeliveryFee;
  else feeArg = undefined;
  applyCartFinancialsToUi(computeErvCartBreakdown(cart, feeArg));

  var co = document.getElementById("lpCartCheckoutBtn");
  if (co) co.disabled = !cart.length;
}

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
  var btn = ev.target.closest && ev.target.closest(".erv-pay-card[data-pay-method]");
  if (!btn) return;
  var root = btn.closest(".erv-pay-cards");
  if (!root || !root.id) return;
  setSelectedPaymentForContainer(root.id, btn.getAttribute("data-pay-method"));
});

document.addEventListener("DOMContentLoaded", function () {
  updateCartCount();
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("[data-cart-remove]");
    if (!b || !document.getElementById("lpCartPanel")) return;
    removeFromCart(b.getAttribute("data-cart-remove"));
  });
});
window.addEventListener("storage", updateCartCount);
