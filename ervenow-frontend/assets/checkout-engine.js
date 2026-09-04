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
  var CHECKOUT_IN_PROGRESS_MAX_POLLS = 30;
  var CHECKOUT_API_TIMEOUT_MS = 60000;

  var checkoutInFlight = false;
  var labelEnrichInFlight = false;

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
      car_polishing: 1,
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

  function isInternalDeliveryDraft(items) {
    return (items || []).some(function (it) {
      return String((it && it.type) || "").toLowerCase() === "internal_delivery";
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

  function parseTitleParts(rawTitle) {
    var raw = String(rawTitle || "").trim();
    if (!raw) return { storeName: "", productName: "" };
    var sep = raw.indexOf(" — ");
    if (sep < 0) sep = raw.indexOf(" - ");
    if (sep >= 0) {
      return {
        storeName: raw.slice(0, sep).trim(),
        productName: raw.slice(sep + 3).trim(),
      };
    }
    return { storeName: "", productName: raw };
  }

  function resolveLineDisplay(it, idx) {
    var d = (it && it.data) || {};
    var kind = lineKind(it);
    var storeName = String(d.store_name || d.merchant_name || "").trim();
    var productName = String(d.product_name || d.name || "").trim();
    var parsed = parseTitleParts(it && it.title);

    if (kind === "product") {
      if (!storeName) storeName = parsed.storeName;
      if (!productName) productName = parsed.productName;
      if (!productName && String(it && it.title || "").trim()) productName = String(it.title).trim();
      if (!productName) productName = "منتج";
    } else {
      productName = String(it.title || d.title || d.name || parsed.productName || "").trim();
      if (!productName) productName = String(it.type || "طلب") + " #" + (idx + 1);
    }

    return { productName: productName, storeName: storeName, kind: kind };
  }

  function lineNeedsLabelEnrichment(it) {
    if (lineKind(it) !== "product") return false;
    var d = (it && it.data) || {};
    if (!d.store_id || d.product_id == null || String(d.product_id).trim() === "") return false;
    if (d.product_name && d.store_name) return false;
    var disp = resolveLineDisplay(it, 0);
    return !disp.storeName || disp.productName === "منتج" || /^restaurant\s*#/i.test(disp.productName);
  }

  function apiFetchUrl(path) {
    if (global.PlatformAPI && typeof global.PlatformAPI.apiUrl === "function") {
      return global.PlatformAPI.apiUrl(path);
    }
    return path;
  }

  async function enrichDraftLineLabels(draft) {
    if (labelEnrichInFlight || !draft || !(draft.items || []).length) return;
    var pending = (draft.items || []).filter(lineNeedsLabelEnrichment);
    if (!pending.length) return;

    var storeIds = {};
    pending.forEach(function (it) {
      var sid = it && it.data && it.data.store_id;
      if (sid) storeIds[String(sid)] = true;
    });
    var ids = Object.keys(storeIds);
    if (!ids.length) return;

    labelEnrichInFlight = true;
    var storeNames = {};
    var productMaps = {};

    try {
      await Promise.all(
        ids.map(function (sid) {
          return Promise.all([
            fetch(apiFetchUrl("/api/store/public/" + encodeURIComponent(sid)))
              .then(function (res) {
                return res.json();
              })
              .then(function (data) {
                if (data && data.ok && data.store && data.store.name) {
                  storeNames[sid] = String(data.store.name).trim();
                }
              })
              .catch(function () {}),
            fetch(
              apiFetchUrl(
                "/api/store/products?store_id=" + encodeURIComponent(sid) + "&limit=60&offset=0"
              )
            )
              .then(function (res) {
                return res.json();
              })
              .then(function (data) {
                if (!data || !data.ok || !Array.isArray(data.products)) return;
                var map = {};
                data.products.forEach(function (p) {
                  if (p && p.id != null) map[String(p.id)] = String(p.name || "").trim();
                });
                productMaps[sid] = map;
              })
              .catch(function () {}),
          ]);
        })
      );

      var changed = false;
      var items = (draft.items || []).map(function (it) {
        var d = (it && it.data) || {};
        var sid = String(d.store_id || "");
        var pid = String(d.product_id || "");
        if (!sid || !pid) return it;

        var nextData = Object.assign({}, d);
        var itemChanged = false;
        if (!nextData.store_name && storeNames[sid]) {
          nextData.store_name = storeNames[sid];
          itemChanged = true;
        }
        if (!nextData.product_name && productMaps[sid] && productMaps[sid][pid]) {
          nextData.product_name = productMaps[sid][pid];
          itemChanged = true;
        }
        if (!itemChanged) return it;

        changed = true;
        var storeLabel = nextData.store_name || storeNames[sid] || "متجر";
        var productLabel = nextData.product_name || "منتج";
        return Object.assign({}, it, {
          title: storeLabel + " — " + productLabel,
          data: nextData,
        });
      });

      if (!changed) return;
      draft.items = items;
      var api = getDraftApi();
      if (api && typeof api.writeDraft === "function") {
        api.writeDraft(draft);
        refresh();
      }
    } finally {
      labelEnrichInFlight = false;
    }
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
    return /already in progress|checkout already|checkout_stuck_in_progress|طلب التأكيد قيد المعالجة/i.test(
      String(msg || "")
    );
  }

  function isCheckoutTransientError(msg) {
    var m = String(msg || "");
    return (
      isCheckoutInProgressError(m) ||
      /انتهت مهلة الاتصال|timeout|AbortError|الخادم مشغول/i.test(m)
    );
  }

  function humanizeCheckoutError(msg) {
    var m = String(msg || "").trim();
    if (/طلبات كثيرة|RATE_LIMIT|too many/i.test(m)) {
      return "طلبات كثيرة — انتظر دقيقة ثم اضغط «تأكيد الطلب» مرة أخرى (لن يُنشأ طلب مكرر).";
    }
    if (!m || /checkout_stuck_in_progress/i.test(m)) {
      return "تعذّر إتمام الطلب — حدّث الصفحة واضغط «تأكيد الطلب» مرة واحدة.";
    }
    if (isCheckoutInProgressError(m)) {
      return "طلب التأكيد قيد المعالجة — انتظر نصف دقيقة ثم أعد المحاولة.";
    }
    if (/رصيد|غير كاف|insufficient/i.test(m)) return "رصيد المحفظة غير كافٍ لإتمام الطلب.";
    if (/amount_mismatch|تعارض في مبلغ/i.test(m)) {
      return "تعارض في مبلغ الطلب — حدّث الصفحة ثم اضغط «تأكيد الطلب» مرة واحدة.";
    }
    if (/موقع|GPS|توصيل|متجر|دفع|فارغ/i.test(m) && /[\u0600-\u06FF]/.test(m)) return m;
    if (/platform_wallet|migration_missing|ledger|schema cache|function.*not found/i.test(m)) {
      return "نظام الدفع غير جاهز — تواصل مع دعم ERVENOW أو أعد المحاولة لاحقاً.";
    }
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
      timeoutMs: CHECKOUT_API_TIMEOUT_MS,
    });
  }

  async function submitCheckoutWithInProgressPoll(payload, idemKey, btn) {
    var polls = 0;
    while (true) {
      try {
        return await submitCheckoutOrder(payload, idemKey);
      } catch (e) {
        var msg = String((e && e.message) || "");
        if (!isCheckoutTransientError(msg) || polls >= CHECKOUT_IN_PROGRESS_MAX_POLLS) {
          if (isCheckoutInProgressError(msg) || /انتهت مهلة/i.test(msg)) {
            throw new Error("checkout_stuck_in_progress");
          }
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
          var display = resolveLineDisplay(it, idx);
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
          var storeBlock =
            display.storeName && display.kind === "product"
              ? '<span class="checkout-line__store">' + escHtml(display.storeName) + "</span>"
              : "";
          return (
            '<li class="checkout-line" data-line-index="' +
            idx +
            '">' +
            '<div class="checkout-line__main">' +
            '<span class="checkout-line__title">' +
            escHtml(display.productName) +
            "</span>" +
            storeBlock +
            qtyBlock +
            "</div>" +
            '<div class="checkout-line__tail">' +
            '<span class="checkout-line__price">' +
            fmtMoney(it.price || 0) +
            " ر.س</span>" +
            '<button type="button" class="checkout-line__remove" data-checkout-action="remove" aria-label="حذف ' +
            escHtml(display.productName) +
            '">حذف</button>' +
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
      if (isInternalDeliveryDraft(items)) {
        var idItem = items.find(function (it) {
          return String((it && it.type) || "").toLowerCase() === "internal_delivery";
        });
        var idData = (idItem && idItem.data) || {};
        var idLabel = String(idData.shipment_name || (idItem && idItem.title) || "توصيل داخلي").trim();
        if (idData.from && idData.to) {
          delEl.textContent = "توصيل داخلي — " + idLabel;
        } else if (Number.isFinite(Number(idData.pickup_lat)) && Number.isFinite(Number(idData.drop_lat))) {
          delEl.textContent = "توصيل داخلي — موقع الاستلام والتسليم محفوظ";
        } else {
          delEl.textContent = "توصيل داخلي — أكمل موقع الاستلام والتسليم من صفحة التوصيل";
        }
      } else if (!hasStoreProducts(items)) {
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
    var paySelected =
      global.ErvenowCheckoutPayment && typeof global.ErvenowCheckoutPayment.getSelected === "function"
        ? global.ErvenowCheckoutPayment.getSelected()
        : draft.payment_method;
    var canConfirm = !!paySelected && !breakdown.deliveryPending;
    if (confirmBtn && !checkoutInFlight) {
      confirmBtn.disabled = !canConfirm;
      if (!paySelected) {
        confirmBtn.textContent = "اختر وسيلة الدفع";
      } else if (breakdown.deliveryPending) {
        confirmBtn.textContent = "أكمل موقع التوصيل أولاً";
      } else {
        confirmBtn.textContent = "تأكيد الطلب — " + fmtMoney(breakdown.grandTotal) + " ر.س";
      }
    }

    if (global.ErvenowCheckoutPayment && typeof global.ErvenowCheckoutPayment.setGrandTotalForEwPay === "function") {
      global.ErvenowCheckoutPayment.setGrandTotalForEwPay(breakdown.deliveryPending ? null : breakdown.grandTotal);
    }

    var pay = global.ErvenowCheckoutPayment;
    if (pay && typeof pay.renderOptions === "function") {
      var payRoot = document.getElementById("checkoutPayOptions");
      if (payRoot) {
        if (typeof pay.ensureDefaultSelected === "function") {
          pay.ensureDefaultSelected(draft, onPaymentChanged);
        }
        pay.renderOptions(payRoot, null, pay.getSelected(), onPaymentChanged);
      }
    }

    void enrichDraftLineLabels(draft);
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
      if (typeof pay.ensureDefaultSelected === "function") {
        pay.ensureDefaultSelected(draft, onPaymentChanged);
      } else {
        var initial = draft.payment_method || pay.getSelected();
        if (initial) pay.setSelected(initial, onPaymentChanged);
      }
      pay.renderOptions(payRoot, null, pay.getSelected(), onPaymentChanged);
    });
  }

  async function ensureCheckoutReady(draft) {
    var edit = global.ErvenowCheckoutDraftEdit;
    if (edit && typeof edit.refreshDeliveryQuoteIfPending === "function") {
      try {
        await edit.refreshDeliveryQuoteIfPending();
      } catch (_e) {}
    }
    var api = getDraftApi();
    return api ? api.readDraft() : draft;
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
      showToast("لا توجد تفاصيل في الطلب", "error");
      return;
    }

    var payMethod = pay && typeof pay.getSelected === "function" ? pay.getSelected() : draft.payment_method;
    if (!payMethod) {
      if (pay && typeof pay.ensureDefaultSelected === "function") {
        payMethod = pay.ensureDefaultSelected(draft, onPaymentChanged);
      }
    }
    if (!payMethod) {
      resetCheckoutBtnIdle(btn);
      showToast("اختر وسيلة الدفع", "error");
      return;
    }
    draft.payment_method = payMethod;
    api.writeDraft(draft);

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
      /* احتفظ بمفتاح idempotency عند الفشل — يمنع طلباً مكرراً عند إعادة الدفع */
      if (/401|غير مصرح|token/i.test(msg)) {
        clearCheckoutIdempotencyKey();
        checkoutInFlight = false;
        global.location.href = "/login?mode=register&role=customer&next=" + encodeURIComponent("/checkout");
        return;
      }
      if (/SERVICE_NOT_LAUNCHED|لم تُطلق|التسجيل مفتوح/i.test(msg)) {
        clearCheckoutIdempotencyKey();
        resetCheckoutBtnIdle(btn);
        showToast("التسجيل مفتوح — الطلبات التجارية لم تُطلق بعد. سنبلغك عند بدء الخدمة.", "error");
        return;
      }
      if (/checkout_stuck_in_progress|already in progress|checkout already|طلب التأكيد قيد المعالجة/i.test(msg)) {
        clearCheckoutIdempotencyKey();
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
    var policy = { allowMigrate: true };
    if (typeof api.applySessionDraftPolicy === "function") {
      policy = api.applySessionDraftPolicy() || policy;
    }
    restorePendingMapDraft();
    if (policy.allowMigrate && typeof api.tryMigrateFromLegacyCart === "function") {
      api.tryMigrateFromLegacyCart({ sourcePage: "/checkout" });
    }
    showCheckoutFlash();
    var draft = api.readDraft();
    if (!draft.items || !draft.items.length) {
      renderEmpty();
      return;
    }
    ensureCheckoutReady(draft).then(function (freshDraft) {
      return initPayment(freshDraft || draft).then(function () {
        refresh();
      });
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
    resolveEffectiveLocation: resolveEffectiveLocation,
    syncDraftTotals: syncDraftTotals,
    hasStoreProducts: hasStoreProducts,
    getFulfillmentMode: getFulfillmentMode,
    lineKind: lineKind,
    resolveLineDisplay: resolveLineDisplay,
    showToast: showToast,
    isCheckoutInFlight: function () {
      return checkoutInFlight;
    },
  };
})(typeof window !== "undefined" ? window : global);
