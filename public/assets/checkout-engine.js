/**
 * Checkout Engine V1 — Unified Checkout (Phase 2)
 * مصدر البيانات: ErvenowOrderDraft فقط — بدون وحدات السلة القديمة.
 * المنطق المالي مطابق لـ shared/checkout/checkoutFromDraft.js
 */
(function (global) {
  "use strict";

  var VAT_RATE = 0.15;
  var PLATFORM_RATE = 0.07;
  var IDEM_KEY = "ervenow:checkout-idem";
  var CHECKOUT_BTN_PROCESSING = "⏳ جاري معالجة الطلب...";
  var CHECKOUT_BTN_WAITING = "جاري معالجة الطلب...";
  var CHECKOUT_BTN_SUCCESS = "✅ تم إنشاء الطلب بنجاح";
  var CHECKOUT_IN_PROGRESS_POLL_MS = 2000;
  var CHECKOUT_IN_PROGRESS_MAX_POLLS = 15;

  var checkoutInFlight = false;

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function lineKind(item) {
    var d = item && item.data;
    if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return "product";
    var types = {
      delivery: 1,
      vehicle_transfer: 1,
      car_transport: 1,
      internal_delivery: 1,
      pickup_truck: 1,
      furniture_move: 1,
      gas_delivery: 1,
    };
    if (types[String((item && item.type) || "")]) return "delivery";
    return "service";
  }

  function itemsSubtotal(items) {
    return roundMoney(
      (items || []).reduce(function (s, it) {
        return s + (Number(it && it.price) || 0);
      }, 0)
    );
  }

  function itemsGoodsSubtotal(items) {
    return roundMoney(
      (items || []).reduce(function (s, it) {
        if (lineKind(it) !== "product") return s;
        return s + (Number(it && it.price) || 0);
      }, 0)
    );
  }

  function hasStoreProducts(items) {
    return (items || []).some(function (i) {
      var d = i && i.data;
      return lineKind(i) === "product" && d && d.store_id;
    });
  }

  function getFulfillmentMode(items) {
    for (var i = 0; i < (items || []).length; i += 1) {
      var d = items[i] && items[i].data;
      if (d && d.fulfillment_mode) return String(d.fulfillment_mode).toLowerCase();
    }
    return null;
  }

  function needsDeliveryCoords(items) {
    if (!hasStoreProducts(items)) return false;
    return getFulfillmentMode(items) !== "pickup";
  }

  function locationFromItemData(d) {
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
    };
  }

  function resolveEffectiveLocation(draft) {
    var items = (draft && draft.items) || [];
    for (var i = 0; i < items.length; i += 1) {
      var loc = locationFromItemData(items[i] && items[i].data);
      if (loc) return loc;
    }
    var cl = draft && draft.customer_location;
    if (!cl) return null;
    var lat = Number(cl.lat);
    var lng = Number(cl.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat: lat,
      lng: lng,
      address: String(cl.address || "").trim(),
      fulfillment_mode: cl.fulfillment_mode || null,
      store_id: cl.store_id || null,
    };
  }

  function resolveDeliveryFeeFromDraft(draft) {
    var totals = (draft && draft.totals) || {};
    if (Number.isFinite(Number(totals.delivery))) return roundMoney(Number(totals.delivery));
    var items = (draft && draft.items) || [];
    var fee = 0;
    var seen = false;
    items.forEach(function (it) {
      var d = it && it.data;
      if (!d || !d.store_id) return;
      var mode = String(d.fulfillment_mode || "").toLowerCase();
      if (mode === "pickup" || d.delivery_free || d.includes_delivery) {
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
    if (hasStoreProducts(items) && getFulfillmentMode(items) !== "pickup" && totals.delivery_pending !== false) {
      return undefined;
    }
    return 0;
  }

  function computeBreakdown(items, deliveryFee) {
    var sub = itemsSubtotal(items);
    var delKnown = Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) >= 0;
    var del = delKnown ? roundMoney(Number(deliveryFee)) : 0;
    var deliveryPending = hasStoreProducts(items) && !delKnown;
    var vat = roundMoney((sub + del) * VAT_RATE);
    var goods = itemsGoodsSubtotal(items);
    var platformOnGoods = roundMoney(goods * PLATFORM_RATE);
    var platformOnDelivery = delKnown ? roundMoney(del * PLATFORM_RATE) : 0;
    var platformCommission = roundMoney(platformOnGoods + platformOnDelivery);
    return {
      subtotal: sub,
      delivery: del,
      deliveryPending: deliveryPending,
      vat: vat,
      platformCommission: platformCommission,
      grandTotal: roundMoney(sub + del + vat),
    };
  }

  function buildFinancialIntent(items, deliveryFee, paymentMethod) {
    var b = computeBreakdown(items, deliveryFee);
    return {
      subtotal: b.subtotal,
      delivery_fee: b.deliveryPending ? null : b.delivery,
      delivery_pending: b.deliveryPending,
      vat: b.vat,
      platform_fee: b.platformCommission,
      merchant_net: roundMoney(itemsGoodsSubtotal(items) - roundMoney(itemsGoodsSubtotal(items) * PLATFORM_RATE)),
      driver_net: roundMoney(b.delivery - roundMoney(b.delivery * PLATFORM_RATE)),
      grand_total: b.deliveryPending ? null : b.grandTotal,
      payment_method: String(paymentMethod || "").trim(),
    };
  }

  function syncDraftTotals(draft) {
    if (!draft) return draft;
    var deliveryFee = resolveDeliveryFeeFromDraft(draft);
    var breakdown = computeBreakdown(draft.items || [], deliveryFee);
    draft.totals = {
      subtotal: breakdown.subtotal,
      delivery: breakdown.deliveryPending ? null : breakdown.delivery,
      vat: breakdown.deliveryPending ? null : breakdown.vat,
      platform_fee: breakdown.platformCommission,
      grand_total: breakdown.deliveryPending ? null : breakdown.grandTotal,
      delivery_pending: breakdown.deliveryPending,
    };
    return draft;
  }

  function buildOrderCreatePayload(draft, paymentMethod) {
    var items = (draft && draft.items ? draft.items.slice() : []);
    var pay = String(paymentMethod || (draft && draft.payment_method) || "").trim();
    var notes = draft && draft.order_notes ? String(draft.order_notes).trim() : "";
    if (notes && items.length && items[0].data) {
      items[0] = Object.assign({}, items[0], {
        data: Object.assign({}, items[0].data, { notes_extra: notes }),
      });
    }
    var deliveryFee = resolveDeliveryFeeFromDraft(draft);
    var financialIntent = buildFinancialIntent(items, deliveryFee, pay);
    var payload = { items: items, payment_method: pay, financial_intent: financialIntent };
    if (notes) payload.customer_notes = notes;
    if (pay === "ew_pay") {
      payload.paid = true;
      payload.payment_status = "paid";
    }
    if (needsDeliveryCoords(items)) {
      var loc = resolveEffectiveLocation(draft);
      if (loc) {
        payload.customer_lat = loc.lat;
        payload.customer_lng = loc.lng;
        payload.customer_address = loc.address || "";
      }
    }
    return { payload: payload, deliveryFee: deliveryFee, financialIntent: financialIntent, location: resolveEffectiveLocation(draft) };
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

  function fulfillmentLabelAr(mode) {
    var m = String(mode || "").toLowerCase();
    if (m === "pickup") return "الاستلام من المتجر";
    if (m === "store_delivery") return "توصيل بواسطة المتجر";
    if (m === "ervenow_delivery") return "توصيل المناديب";
    return "—";
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    if (global.ErvenowCheckoutPayment && typeof global.ErvenowCheckoutPayment.fmtMoney === "function") {
      return global.ErvenowCheckoutPayment.fmtMoney(n);
    }
    return roundMoney(n).toFixed(2);
  }

  function checkoutIdempotencyKey() {
    try {
      var saved = sessionStorage.getItem(IDEM_KEY);
      if (saved && String(saved).trim()) return String(saved).trim();
    } catch (_e) {}
    var key =
      global.crypto && global.crypto.randomUUID
        ? global.crypto.randomUUID()
        : "checkout-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
    try {
      sessionStorage.setItem(IDEM_KEY, key);
    } catch (_e2) {}
    return key;
  }

  function clearCheckoutIdempotencyKey() {
    try {
      sessionStorage.removeItem(IDEM_KEY);
    } catch (_e) {}
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isCheckoutInProgressError(msg) {
    return /already in progress|checkout already/i.test(String(msg || ""));
  }

  function humanizeCheckoutError(msg) {
    var m = String(msg || "").trim();
    if (!m || isCheckoutInProgressError(m)) return "تعذّر إتمام الطلب — أعد المحاولة بعد لحظة.";
    if (/رصيد|غير كاف|insufficient/i.test(m)) return "رصيد المحفظة غير كافٍ لإتمام الطلب.";
    if (/موقع|GPS|توصيل|متجر|دفع|فارغ/i.test(m) && /[\u0600-\u06FF]/.test(m)) return m;
    if (/database not configured|idempotency unavailable/i.test(m)) {
      return "الخدمة غير متاحة مؤقتاً — أعد المحاولة بعد قليل.";
    }
    if (/[\u0600-\u06FF]/.test(m)) return m;
    if (/network|اتصال|خادم|timeout|مهلة/i.test(m)) {
      return "تعذّر الاتصال بالخادم — تحقّق من الشبكة وأعد المحاولة.";
    }
    return "تعذّر إتمام الطلب — تحقّق من البيانات وأعد المحاولة.";
  }

  function setCheckoutBtnState(btn, state, labelText) {
    if (!btn) return;
    if (state === "processing") {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.classList.add("checkout-btn--processing");
      btn.textContent = labelText || CHECKOUT_BTN_PROCESSING;
      return;
    }
    if (state === "success") {
      btn.disabled = true;
      btn.removeAttribute("aria-busy");
      btn.classList.remove("checkout-btn--processing");
      btn.textContent = labelText || CHECKOUT_BTN_SUCCESS;
      return;
    }
    btn.classList.remove("checkout-btn--processing");
    btn.removeAttribute("aria-busy");
  }

  function resetCheckoutBtnIdle(btn) {
    checkoutInFlight = false;
    setCheckoutBtnState(btn, "idle");
    refresh();
  }

  async function submitCheckoutOrder(payload, idemKey) {
    return global.PlatformAPI.api("/api/order/create", {
      method: "POST",
      body: payload,
      idempotencyKey: idemKey,
    });
  }

  async function submitCheckoutWithInProgressPoll(payload, idemKey, btn) {
    var polls = 0;
    while (true) {
      try {
        return await submitCheckoutOrder(payload, idemKey);
      } catch (e) {
        var msg = String((e && e.message) || "");
        if (!isCheckoutInProgressError(msg) || polls >= CHECKOUT_IN_PROGRESS_MAX_POLLS) {
          throw e;
        }
        setCheckoutBtnState(btn, "processing", CHECKOUT_BTN_WAITING);
        polls += 1;
        await sleep(CHECKOUT_IN_PROGRESS_POLL_MS);
      }
    }
  }

  function showToast(msg, kind) {
    var el = document.getElementById("checkoutToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "checkoutToast";
      el.setAttribute("role", "status");
      el.className = "checkout-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "checkout-toast checkout-toast--" + (kind || "info");
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.hidden = true;
    }, 5000);
  }

  function getDraftApi() {
    return global.ErvenowOrderDraft;
  }

  function renderEmpty() {
    var root = document.getElementById("checkoutMain");
    var empty = document.getElementById("checkoutEmpty");
    var confirmBtn = document.getElementById("checkoutConfirmBtn");
    if (root) {
      root.hidden = true;
      root.classList.remove("checkout-panel--active", "checkout-panel--compact");
    }
    if (empty) empty.hidden = false;
    if (confirmBtn) confirmBtn.disabled = true;
  }

  function renderActive(draft) {
    var root = document.getElementById("checkoutMain");
    var empty = document.getElementById("checkoutEmpty");
    if (root) {
      root.hidden = false;
      root.classList.add("checkout-panel--active");
    }
    if (empty) empty.hidden = true;

    var items = draft.items || [];
    if (root) {
      root.classList.toggle("checkout-panel--compact", items.length > 0 && items.length <= 2);
    }
    var deliveryFee = resolveDeliveryFeeFromDraft(draft);
    var breakdown = computeBreakdown(items, deliveryFee);
    var loc = resolveEffectiveLocation(draft);
    var mode = getFulfillmentMode(items);

    var linesEl = document.getElementById("checkoutLines");
    var editApi = global.ErvenowCheckoutDraftEdit;
    if (linesEl) {
      linesEl.innerHTML = items
        .map(function (it, idx) {
          var title =
            (it.data && (it.data.product_name || it.data.title || it.data.name)) ||
            String(it.type || "بند") + " #" + (idx + 1);
          var qty = (it.data && it.data.qty) || 1;
          var editable = editApi && editApi.isProductLine && editApi.isProductLine(it);
          var qtyBlock = editable
            ? '<div class="checkout-line__qty" role="group" aria-label="الكمية">' +
              '<button type="button" class="checkout-qty-btn" data-checkout-action="qty-minus" aria-label="إنقاص">−</button>' +
              '<span class="checkout-qty-val">' +
              qty +
              "</span>" +
              '<button type="button" class="checkout-qty-btn" data-checkout-action="qty-plus" aria-label="زيادة">+</button>' +
              "</div>"
            : '<span class="checkout-line__qty-readonly">' + (qty > 1 ? "× " + qty : "") + "</span>";
          return (
            '<li class="checkout-line" data-line-index="' +
            idx +
            '">' +
            '<div class="checkout-line__main">' +
            '<span class="checkout-line__title">' +
            escHtml(title) +
            "</span>" +
            qtyBlock +
            "</div>" +
            '<div class="checkout-line__tail">' +
            '<span class="checkout-line__price">' +
            fmtMoney(it.price || 0) +
            " ر.س</span>" +
            '<button type="button" class="checkout-line__remove" data-checkout-action="remove" aria-label="حذف البند">×</button>' +
            "</div>" +
            "</li>"
          );
        })
        .join("");
    }

    var notesEl = document.getElementById("checkoutOrderNotes");
    if (notesEl && document.activeElement !== notesEl) {
      notesEl.value = draft.order_notes || "";
    }

    var delEl = document.getElementById("checkoutDeliverySummary");
    var delEdit = document.getElementById("checkoutDeliveryEdit");
    var locInput = document.getElementById("checkoutLocationInput");
    var addrInput = document.getElementById("checkoutAddressInput");
    var showLocEdit = hasStoreProducts(items) && mode !== "pickup";
    if (delEdit) delEdit.hidden = !showLocEdit;
    if (delEl) {
      if (!hasStoreProducts(items)) {
        delEl.textContent = "لا يتطلب توصيل متجر";
      } else if (mode === "pickup") {
        delEl.textContent = "الاستلام من المتجر — لا توصيل";
      } else if (loc && loc.address) {
        delEl.textContent = fulfillmentLabelAr(mode) + " — " + loc.address;
      } else if (loc) {
        delEl.textContent = fulfillmentLabelAr(mode) + " — إحداثيات محفوظة";
      } else {
        delEl.textContent = "حدّد موقع التوصيل أدناه";
      }
    }
    if (showLocEdit && locInput && document.activeElement !== locInput) {
      locInput.value = (loc && loc.maps_url) || (loc ? loc.lat + "," + loc.lng : "");
    }
    if (showLocEdit && addrInput && document.activeElement !== addrInput) {
      addrInput.value = (loc && loc.address) || "";
    }

    function setMoney(id, val, pending) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = pending ? "—" : fmtMoney(val) + " ر.س";
      el.classList.toggle("checkout-money--pending", !!pending);
    }

    setMoney("checkoutSubtotal", breakdown.subtotal, false);
    setMoney("checkoutDelivery", breakdown.delivery, breakdown.deliveryPending);
    setMoney("checkoutVat", breakdown.vat, breakdown.deliveryPending);
    setMoney("checkoutGrand", breakdown.grandTotal, breakdown.deliveryPending);

    var confirmBtn = document.getElementById("checkoutConfirmBtn");
    if (confirmBtn && !checkoutInFlight) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = breakdown.deliveryPending
        ? "تأكيد الطلب"
        : "تأكيد الطلب — " + fmtMoney(breakdown.grandTotal) + " ر.س";
    }

    if (global.ErvenowCheckoutPayment && typeof global.ErvenowCheckoutPayment.setGrandTotalForEwPay === "function") {
      global.ErvenowCheckoutPayment.setGrandTotalForEwPay(breakdown.deliveryPending ? null : breakdown.grandTotal);
    }

    var pay = global.ErvenowCheckoutPayment;
    if (pay && typeof pay.renderOptions === "function") {
      var payRoot = document.getElementById("checkoutPayOptions");
      if (payRoot) {
        pay.renderOptions(payRoot, null, pay.getSelected(), onPaymentChanged);
      }
    }
  }

  function onPaymentChanged(method) {
    var api = getDraftApi();
    if (!api) return;
    var draft = api.readDraft();
    draft.payment_method = method || null;
    api.writeDraft(draft);
  }

  function refresh() {
    var api = getDraftApi();
    if (!api) return;
    var draft = api.readDraft();
    if (!draft.items || !draft.items.length) {
      renderEmpty();
      return;
    }
    renderActive(draft);
  }

  function initPayment(draft) {
    var pay = global.ErvenowCheckoutPayment;
    if (!pay) return Promise.resolve();
    return pay.loadPaymentMethods(draft).then(function () {
      var payRoot = document.getElementById("checkoutPayOptions");
      var initial = draft.payment_method || pay.getSelected();
      if (initial) pay.setSelected(initial, onPaymentChanged);
      pay.renderOptions(payRoot, null, pay.getSelected(), onPaymentChanged);
    });
  }

  async function confirmOrder() {
    if (checkoutInFlight) return;

    var btn = document.getElementById("checkoutConfirmBtn");
    checkoutInFlight = true;
    setCheckoutBtnState(btn, "processing", CHECKOUT_BTN_PROCESSING);

    var api = getDraftApi();
    var pay = global.ErvenowCheckoutPayment;
    if (!api) {
      resetCheckoutBtnIdle(btn);
      showToast("تعذّر تحميل مسودة الطلب", "error");
      return;
    }

    var draft = api.readDraft();
    if (!draft.items || !draft.items.length) {
      resetCheckoutBtnIdle(btn);
      showToast("لا توجد بنود في المسودة", "error");
      return;
    }

    var payMethod = pay && typeof pay.getSelected === "function" ? pay.getSelected() : draft.payment_method;
    if (!payMethod) {
      resetCheckoutBtnIdle(btn);
      showToast("اختر وسيلة الدفع", "error");
      return;
    }

    if (payMethod === "ew_pay" && pay && typeof pay.validateEwPay === "function") {
      var deliveryFee = resolveDeliveryFeeFromDraft(draft);
      var intent = buildFinancialIntent(draft.items, deliveryFee, payMethod);
      var ewCheck = pay.validateEwPay(intent.grand_total);
      if (!ewCheck.ok) {
        resetCheckoutBtnIdle(btn);
        showToast(ewCheck.message || "رصيد المحفظة غير كافٍ", "error");
        if (typeof pay.loadEwPayBalance === "function") void pay.loadEwPayBalance();
        return;
      }
    }

    var token =
      (global.PlatformAPI && typeof global.PlatformAPI.getToken === "function" && global.PlatformAPI.getToken()) ||
      "";
    if (!token) {
      checkoutInFlight = false;
      global.location.href = "/login?mode=register&role=customer&next=" + encodeURIComponent("/checkout");
      return;
    }
    if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") {
      resetCheckoutBtnIdle(btn);
      showToast("تعذّر الاتصال بالخادم — حدّث الصفحة", "error");
      return;
    }

    var built = buildOrderCreatePayload(draft, payMethod);
    if (needsDeliveryCoords(draft.items) && !built.location) {
      resetCheckoutBtnIdle(btn);
      showToast("الموقع غير مكتمل — ارجع للمتجر لتحديد التوصيل قبل التأكيد", "error");
      return;
    }
    if (built.financialIntent && built.financialIntent.delivery_pending) {
      resetCheckoutBtnIdle(btn);
      showToast("تعذّر حساب أجرة التوصيل — ارجع للمتجر وأكمل بيانات التوصيل", "error");
      return;
    }

    var idemKey = checkoutIdempotencyKey();
    var redirecting = false;

    try {
      var data = await submitCheckoutWithInProgressPoll(built.payload, idemKey, btn);

      clearCheckoutIdempotencyKey();
      var orders = (data && data.orders) || [];
      api.clearDraft();

      var successMsg = CHECKOUT_BTN_SUCCESS;
      setCheckoutBtnState(btn, "success", successMsg);
      showToast(successMsg, "success");

      redirecting = true;
      checkoutInFlight = true;
      await sleep(650);
      global.location.href = resolvePostCheckoutRedirectUrl(orders);
    } catch (e) {
      var msg = String((e && e.message) || "حدث خطأ، حاول مرة أخرى");
      clearCheckoutIdempotencyKey();
      if (/401|غير مصرح|token/i.test(msg)) {
        checkoutInFlight = false;
        global.location.href = "/login?mode=register&role=customer&next=" + encodeURIComponent("/checkout");
        return;
      }
      resetCheckoutBtnIdle(btn);
      showToast(humanizeCheckoutError(msg), "error");
    }
  }

  function bindEvents() {
    var btn = document.getElementById("checkoutConfirmBtn");
    if (btn) {
      btn.addEventListener("click", function (ev) {
        if (checkoutInFlight) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        void confirmOrder();
      });
    }
    if (getDraftApi() && typeof getDraftApi().onDraftChange === "function") {
      getDraftApi().onDraftChange(function () {
        refresh();
      });
    }
  }

  function restorePendingMapDraft() {
    try {
      var raw = sessionStorage.getItem("ervenow:pending-map-draft");
      if (!raw) return;
      var item = JSON.parse(raw);
      sessionStorage.removeItem("ervenow:pending-map-draft");
      if (!item || !item.type) return;
      if (global.ErvenowOrderDraftVertical && typeof global.ErvenowOrderDraftVertical.commit === "function") {
        global.ErvenowOrderDraftVertical.commit(item, {
          sourcePage: "/delivery-map",
          vertical: "map_delivery",
          redirect: false,
          message: "تم استعادة طلب الخريطة — أكمل تأكيد الطلب",
        });
      }
    } catch (_e) {}
  }

  function showCheckoutFlash() {
    try {
      var msg = sessionStorage.getItem("ervenow:checkout-flash");
      if (!msg) return;
      sessionStorage.removeItem("ervenow:checkout-flash");
      showToast(msg, "success");
    } catch (_e2) {}
  }

  function boot() {
    var api = getDraftApi();
    if (!api) {
      showToast("تعذّر تحميل Order Draft Store", "error");
      return;
    }
    restorePendingMapDraft();
    api.tryMigrateFromLegacyCart({ sourcePage: "/checkout" });
    showCheckoutFlash();
    var draft = api.readDraft();
    if (!draft.items || !draft.items.length) {
      renderEmpty();
      return;
    }
    initPayment(draft).then(function () {
      refresh();
    });
    bindEvents();
    if (global.ErvenowCheckoutDraftEdit && typeof global.ErvenowCheckoutDraftEdit.bindUi === "function") {
      global.ErvenowCheckoutDraftEdit.bindUi();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  global.ErvenowCheckoutEngine = {
    refresh: refresh,
    confirmOrder: confirmOrder,
    buildOrderCreatePayload: buildOrderCreatePayload,
    computeBreakdown: computeBreakdown,
    resolveDeliveryFeeFromDraft: resolveDeliveryFeeFromDraft,
    syncDraftTotals: syncDraftTotals,
    lineKind: lineKind,
    showToast: showToast,
    isCheckoutInFlight: function () {
      return checkoutInFlight;
    },
  };
})(typeof window !== "undefined" ? window : global);
