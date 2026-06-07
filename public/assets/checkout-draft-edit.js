/**
 * Checkout V1.2 — Draft editing (ErvenowOrderDraft only)
 */
(function (global) {
  "use strict";

  function draftApi() {
    return global.ErvenowOrderDraft;
  }

  function engine() {
    return global.ErvenowCheckoutEngine;
  }

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function isProductLine(item) {
    return engine() && typeof engine().lineKind === "function" && engine().lineKind(item) === "product";
  }

  function unitPrice(item) {
    var d = item && item.data;
    var unit = Number(d && d.unit_price);
    if (Number.isFinite(unit) && unit > 0) return roundMoney(unit);
    var qty = Math.max(1, Number(d && d.qty) || 1);
    return roundMoney((Number(item && item.price) || 0) / qty);
  }

  function syncTotals(draft) {
    var eng = engine();
    if (!eng || typeof eng.computeBreakdown !== "function" || typeof eng.resolveDeliveryFeeFromDraft !== "function") {
      return draft;
    }
    var deliveryFee = eng.resolveDeliveryFeeFromDraft(draft);
    var breakdown = eng.computeBreakdown(draft.items || [], deliveryFee);
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

  function syncBadgeAfterDraftChange() {
    if (global.ErvenowOrderDraftBadge && typeof global.ErvenowOrderDraftBadge.sync === "function") {
      global.ErvenowOrderDraftBadge.sync();
    }
    if (global.ErvenowOrderDraftVertical && typeof global.ErvenowOrderDraftVertical.syncHeaderBadge === "function") {
      global.ErvenowOrderDraftVertical.syncHeaderBadge();
    }
  }

  function persist(draft) {
    var api = draftApi();
    if (!api || typeof api.writeDraft !== "function") {
      return { ok: false, message: "مسودة الطلب غير متاحة" };
    }
    syncTotals(draft);
    var res = api.writeDraft(draft);
    if (!res.ok) return { ok: false, message: "تعذّر حفظ التعديل" };
    syncBadgeAfterDraftChange();
    if (engine() && typeof engine().refresh === "function") engine().refresh();
    return { ok: true, draft: res.draft };
  }

  function parseLatLngPair(s) {
    var t = String(s || "")
      .trim()
      .replace(/\u060c/g, ",")
      .replace(/،/g, ",");
    if (!t.includes(",")) return null;
    var parts = t.split(/,\s*/);
    if (parts.length < 2) return null;
    var lat = parseFloat(String(parts[0]).trim());
    var lng = parseFloat(String(parts[1]).trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function parseMapsUrl(input) {
    var raw = String(input || "").trim();
    if (!raw) return null;
    var direct = parseLatLngPair(raw);
    if (direct) return { lat: direct.lat, lng: direct.lng, maps_url: raw };
    var urlStr = raw;
    if (!/^https?:\/\//i.test(urlStr)) {
      if (/^(maps\.|www\.|goo\.|g\.co)/i.test(urlStr)) urlStr = "https://" + urlStr;
      else if (/google\.com\/maps|maps\.google|goo\.gl|maps\.app/i.test(urlStr)) urlStr = "https://" + urlStr;
    }
    var patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/]|z|\?|$)/i,
      /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]lat=(-?\d+(?:\.\d+)?)[&]lng=(-?\d+(?:\.\d+)?)/i,
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var m = urlStr.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]);
        var lng = parseFloat(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat: lat, lng: lng, maps_url: raw };
        }
      }
    }
    return null;
  }

  async function resolveMapsInput(input) {
    var raw = String(input || "").trim();
    if (!raw) return null;
    if (global.PlatformAPI && typeof global.PlatformAPI.apiUrl === "function" && typeof fetch === "function") {
      try {
        var res = await fetch(global.PlatformAPI.apiUrl("/api/store/resolve-maps-link"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: raw }),
        });
        var data = await res.json();
        if (data.ok && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lng))) {
          return { lat: Number(data.lat), lng: Number(data.lng), maps_url: raw };
        }
      } catch (_e) {}
    }
    return parseMapsUrl(raw);
  }

  function firstStoreLineData(items) {
    for (var i = 0; i < (items || []).length; i += 1) {
      var d = items[i] && items[i].data;
      if (d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "") return d;
    }
    return null;
  }

  function applyLocationToItems(items, loc, addressText) {
    var addr = String(addressText || loc.address || "").trim();
    return (items || []).map(function (it) {
      var d = it && it.data;
      if (!d || !d.store_id) return it;
      if (String(d.fulfillment_mode || "").toLowerCase() === "pickup") return it;
      return Object.assign({}, it, {
        data: Object.assign({}, d, {
          drop_lat: loc.lat,
          drop_lng: loc.lng,
          drop_address: addr,
          drop_maps_url: loc.maps_url || d.drop_maps_url || null,
        }),
      });
    });
  }

  async function refreshDeliveryFee(draft, loc) {
    var items = draft.items || [];
    var storeData = firstStoreLineData(items);
    if (!storeData || !storeData.store_id) return draft;
    var fulfillment = String(storeData.fulfillment_mode || "ervenow_delivery");
    if (fulfillment === "pickup") {
      draft.totals.delivery = 0;
      draft.totals.delivery_pending = false;
      return draft;
    }
    var subtotal = roundMoney(
      items.reduce(function (s, it) {
        return s + (Number(it && it.price) || 0);
      }, 0)
    );
    var qs =
      "?lat=" +
      encodeURIComponent(loc.lat) +
      "&lng=" +
      encodeURIComponent(loc.lng) +
      "&fulfillment=" +
      encodeURIComponent(fulfillment) +
      "&subtotal=" +
      encodeURIComponent(subtotal);
    try {
      var url =
        global.PlatformAPI && global.PlatformAPI.apiUrl
          ? global.PlatformAPI.apiUrl("/api/store/public/" + encodeURIComponent(storeData.store_id) + "/delivery-quote" + qs)
          : "/api/store/public/" + encodeURIComponent(storeData.store_id) + "/delivery-quote" + qs;
      var res = await fetch(url);
      var data = await res.json();
      var quote = data && (data.quote || data);
      if (data.ok && quote && Number.isFinite(Number(quote.delivery_fee))) {
        var fee = roundMoney(Number(quote.delivery_fee));
        draft.items = items.map(function (it) {
          var d = it && it.data;
          if (!d || !d.store_id) return it;
          return Object.assign({}, it, {
            data: Object.assign({}, d, {
              delivery_fee: fee,
              delivery_free: !!quote.delivery_free,
              distance_km: quote.distance_km != null ? Number(quote.distance_km) : d.distance_km,
            }),
          });
        });
        draft.totals.delivery = fee;
        draft.totals.delivery_pending = false;
      } else {
        draft.totals.delivery_pending = true;
      }
    } catch (_e2) {
      draft.totals.delivery_pending = true;
    }
    return draft;
  }

  function changeQty(lineIndex, delta) {
    var api = draftApi();
    if (!api) return { ok: false, message: "مسودة الطلب غير متاحة" };
    var draft = api.readDraft();
    var items = (draft.items || []).slice();
    var idx = Number(lineIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return { ok: false, message: "بند غير موجود" };
    var item = items[idx];
    if (!isProductLine(item)) return { ok: false, message: "لا يمكن تعديل كمية هذا البند" };

    var d = Object.assign({}, item.data || {});
    var qty = Math.max(0, Math.min(99, (Number(d.qty) || 1) + Number(delta || 0)));
    if (qty <= 0) {
      items.splice(idx, 1);
    } else {
      var unit = unitPrice(item);
      d.qty = qty;
      d.unit_price = unit;
      items[idx] = Object.assign({}, item, { price: roundMoney(unit * qty), data: d });
    }

    draft.items = items;
    if (!draft.items.length) {
      api.clearDraft();
      syncBadgeAfterDraftChange();
      if (engine() && typeof engine().refresh === "function") engine().refresh();
      return { ok: true, cleared: true };
    }
    return persist(draft);
  }

  function removeItem(lineIndex) {
    var api = draftApi();
    if (!api) return { ok: false, message: "مسودة الطلب غير متاحة" };
    var draft = api.readDraft();
    var items = (draft.items || []).slice();
    var idx = Number(lineIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return { ok: false, message: "بند غير موجود" };
    items.splice(idx, 1);
    draft.items = items;
    if (!draft.items.length) {
      api.clearDraft();
      syncBadgeAfterDraftChange();
      if (engine() && typeof engine().refresh === "function") engine().refresh();
      return { ok: true, cleared: true };
    }
    return persist(draft);
  }

  function clearAll() {
    var api = draftApi();
    if (!api || typeof api.clearDraft !== "function") return { ok: false, message: "مسودة الطلب غير متاحة" };
    api.clearDraft();
    syncBadgeAfterDraftChange();
    if (engine() && typeof engine().refresh === "function") engine().refresh();
    return { ok: true };
  }

  function setOrderNotes(notes) {
    var api = draftApi();
    if (!api) return { ok: false, message: "مسودة الطلب غير متاحة" };
    var draft = api.readDraft();
    draft.order_notes = String(notes || "").trim().slice(0, 500);
    var items = (draft.items || []).slice();
    if (items.length && items[0].data) {
      items[0] = Object.assign({}, items[0], {
        data: Object.assign({}, items[0].data, { notes_extra: draft.order_notes || null }),
      });
      draft.items = items;
    }
    return persist(draft);
  }

  async function setDeliveryLocation(mapsInput, addressText) {
    var api = draftApi();
    if (!api) return { ok: false, message: "مسودة الطلب غير متاحة" };
    var loc = await resolveMapsInput(mapsInput);
    if (!loc) return { ok: false, message: "أدخل رابط خرائط Google أو إحداثيات (lat,lng)" };

    var draft = api.readDraft();
    var storeData = firstStoreLineData(draft.items);
    draft.customer_location = {
      lat: loc.lat,
      lng: loc.lng,
      address: String(addressText || "").trim(),
      fulfillment_mode: storeData && storeData.fulfillment_mode ? storeData.fulfillment_mode : null,
      store_id: storeData && storeData.store_id ? String(storeData.store_id) : null,
      maps_url: loc.maps_url || null,
    };
    draft.items = applyLocationToItems(draft.items, draft.customer_location, addressText);
    draft = await refreshDeliveryFee(draft, draft.customer_location);
    return persist(draft);
  }

  async function refreshDeliveryQuoteIfPending() {
    var api = draftApi();
    if (!api) return { ok: false };
    var draft = api.readDraft();
    var items = draft.items || [];
    if (!items.length) return { ok: true, draft: draft };

    var eng = engine();
    if (!eng || typeof eng.hasStoreProducts !== "function") return { ok: true, draft: draft };
    if (!eng.hasStoreProducts(items)) return { ok: true, draft: draft };
    if (typeof eng.getFulfillmentMode === "function" && eng.getFulfillmentMode(items) === "pickup") {
      return { ok: true, draft: draft };
    }

    var deliveryFee = typeof eng.resolveDeliveryFeeFromDraft === "function" ? eng.resolveDeliveryFeeFromDraft(draft) : null;
    var breakdown =
      typeof eng.computeBreakdown === "function" ? eng.computeBreakdown(items, deliveryFee) : { deliveryPending: false };
    if (!breakdown.deliveryPending) return { ok: true, draft: draft };

    var loc = typeof eng.resolveEffectiveLocation === "function" ? eng.resolveEffectiveLocation(draft) : null;
    if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) {
      return { ok: false, message: "missing_location" };
    }

    draft = await refreshDeliveryFee(draft, loc);
    return persist(draft);
  }

  function bindUi() {
    var linesEl = document.getElementById("checkoutLines");
    if (linesEl && !linesEl.__checkoutEditBound) {
      linesEl.__checkoutEditBound = true;
      linesEl.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-checkout-action]");
        if (!btn || checkoutInFlightGuard()) return;
        var row = btn.closest("[data-line-index]");
        if (!row) return;
        var idx = parseInt(row.getAttribute("data-line-index"), 10);
        var action = btn.getAttribute("data-checkout-action");
        if (action === "qty-minus") changeQty(idx, -1);
        if (action === "qty-plus") changeQty(idx, 1);
        if (action === "remove") removeItem(idx);
      });
    }

    var clearBtn = document.getElementById("checkoutClearAllBtn");
    if (clearBtn && !clearBtn.__checkoutEditBound) {
      clearBtn.__checkoutEditBound = true;
      clearBtn.addEventListener("click", function () {
        if (checkoutInFlightGuard()) return;
        clearAll();
      });
    }

    var notesEl = document.getElementById("checkoutOrderNotes");
    if (notesEl && !notesEl.__checkoutEditBound) {
      notesEl.__checkoutEditBound = true;
      var notesTimer = null;
      function saveNotes() {
        if (checkoutInFlightGuard()) return;
        setOrderNotes(notesEl.value);
      }
      notesEl.addEventListener("input", function () {
        clearTimeout(notesTimer);
        notesTimer = setTimeout(saveNotes, 400);
      });
      notesEl.addEventListener("blur", saveNotes);
    }

    var saveLocBtn = document.getElementById("checkoutSaveLocationBtn");
    if (saveLocBtn && !saveLocBtn.__checkoutEditBound) {
      saveLocBtn.__checkoutEditBound = true;
      saveLocBtn.addEventListener("click", function () {
        if (checkoutInFlightGuard()) return;
        var mapsInput = document.getElementById("checkoutLocationInput");
        var addrInput = document.getElementById("checkoutAddressInput");
        saveLocBtn.disabled = true;
        setDeliveryLocation(
          mapsInput && mapsInput.value,
          addrInput && addrInput.value
        )
          .then(function (res) {
            if (!res.ok && engine() && typeof engine().showToast === "function") {
              engine().showToast(res.message || "تعذّر حفظ الموقع", "error");
            } else if (res.ok && engine() && typeof engine().showToast === "function") {
              engine().showToast("تم تحديث موقع التوصيل", "success");
            }
          })
          .finally(function () {
            saveLocBtn.disabled = false;
          });
      });
    }
  }

  function checkoutInFlightGuard() {
    return !!(engine() && engine().isCheckoutInFlight && engine().isCheckoutInFlight());
  }

  global.ErvenowCheckoutDraftEdit = {
    changeQty: changeQty,
    removeItem: removeItem,
    clearAll: clearAll,
    setOrderNotes: setOrderNotes,
    setDeliveryLocation: setDeliveryLocation,
    refreshDeliveryQuoteIfPending: refreshDeliveryQuoteIfPending,
    syncTotals: syncTotals,
    bindUi: bindUi,
    isProductLine: isProductLine,
    unitPrice: unitPrice,
  };

  function bootDraftEditUi() {
    bindUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootDraftEditUi);
  } else {
    bootDraftEditUi();
  }
})(typeof window !== "undefined" ? window : global);
