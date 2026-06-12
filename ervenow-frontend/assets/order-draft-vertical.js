/**
 * Checkout Engine V1 — Phase 3: Vertical → Order Draft (browser)
 * مطابق لـ shared/orderDraft/verticalDraftBridge.js
 */
(function (global) {
  "use strict";

  var CHECKOUT_PATH = "/checkout";

  function getDraftApi() {
    return global.ErvenowOrderDraft;
  }

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function validateSaPhone(phone) {
    var d = String(phone || "").replace(/\s/g, "").replace(/\D/g, "");
    if (/^05\d{8}$/.test(d)) return d;
    if (/^9665\d{8}$/.test(d)) return "0" + d.slice(3);
    if (/^5\d{8}$/.test(d)) return "0" + d;
    return null;
  }

  function isMapDeliveryItem(item) {
    var d = item && item.data;
    if (!d) return false;
    if (String(d.source || "") === "dashboard_map") return true;
    return (
      String(item.type || "") === "delivery" &&
      Number.isFinite(Number(d.pickup_lat)) &&
      Number.isFinite(Number(d.drop_lat))
    );
  }

  function getStoreIds(items) {
    var ids = {};
    (items || []).forEach(function (it) {
      var sid = it && it.data && it.data.store_id;
      if (sid) ids[String(sid)] = true;
    });
    return ids;
  }

  function findStoreLine(items, storeId, productId) {
    for (var i = 0; i < (items || []).length; i += 1) {
      var d = items[i] && items[i].data;
      if (d && String(d.store_id) === String(storeId) && String(d.product_id) === String(productId)) return i;
    }
    return -1;
  }

  function normalizeLine(item) {
    if (!item) return null;
    var dataIn = item.data && typeof item.data === "object" ? Object.assign({}, item.data) : {};
    var initQty = isMapDeliveryItem(item) ? 1 : Math.max(1, Math.min(99, Number(dataIn.qty) || 1));
    if (isMapDeliveryItem(item)) {
      if (dataIn.product_qty == null && dataIn.qty != null) dataIn.product_qty = dataIn.qty;
      dataIn.qty = 1;
    }
    var unit =
      Number(dataIn.unit_price) ||
      (Number(item.price) && initQty > 0 ? Number(item.price) / initQty : 0);
    var line = {
      id: item.id != null ? item.id : Date.now(),
      type: item.type,
      title: item.title,
      price: Number(item.price) || 0,
      data: Object.assign({}, dataIn, {
        qty: initQty,
        unit_price: Number.isFinite(unit) && unit > 0 ? unit : dataIn.unit_price,
      }),
    };
    if (item.customer_phone) line.customer_phone = String(item.customer_phone).trim();
    if (item.payment_status) line.payment_status = item.payment_status;
    return line;
  }

  function mergeIntoItems(items, item) {
    var list = (items || []).slice();
    var line = normalizeLine(item);
    if (!line) return { ok: false, message: "invalid_item", items: list };

    if (isMapDeliveryItem(line)) {
      for (var mi = list.length - 1; mi >= 0; mi -= 1) {
        if (isMapDeliveryItem(list[mi])) list.splice(mi, 1);
      }
    }

    var newSid = line.data && line.data.store_id ? String(line.data.store_id).trim() : "";
    if (newSid) {
      var ids = getStoreIds(list);
      var keys = Object.keys(ids);
      if (keys.length && !ids[newSid]) {
        return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين", items: list };
      }
    }

    var pid = line.data && line.data.product_id;
    if (newSid && pid != null && pid !== "") {
      var idx = findStoreLine(list, newSid, pid);
      if (idx >= 0) {
        var cur = list[idx];
        var addQty = Math.max(1, Math.min(99, Number(line.data.qty) || 1));
        var unit =
          Number(line.data.unit_price) ||
          Number(cur.data && cur.data.unit_price) ||
          (Number(cur.price) || 0) / Math.max(1, Number(cur.data && cur.data.qty) || 1);
        if (!Number.isFinite(unit) || unit < 0) unit = 0;
        var newQty = Math.min(99, (Number(cur.data && cur.data.qty) || 1) + addQty);
        list[idx] = Object.assign({}, cur, {
          price: unit * newQty,
          data: Object.assign({}, cur.data || {}, line.data, { qty: newQty, unit_price: unit }),
        });
        return { ok: true, items: list };
      }
    }

    var dup = list.find(function (i) {
      return i.type === line.type && i.title === line.title && JSON.stringify(i.data || {}) === JSON.stringify(line.data || {});
    });
    if (dup) return { ok: false, message: "تمت إضافة هذا العنصر مسبقًا", items: list };

    list.push(line);
    return { ok: true, items: list };
  }

  function itemsSubtotal(items) {
    return roundMoney(
      (items || []).reduce(function (s, it) {
        return s + (Number(it && it.price) || 0);
      }, 0)
    );
  }

  function customerLocationFromItems(items) {
    for (var i = 0; i < (items || []).length; i += 1) {
      var d = items[i] && items[i].data;
      if (!d || !d.store_id || String(d.fulfillment_mode || "").toLowerCase() === "pickup") continue;
      var lat = Number(d.drop_lat);
      var lng = Number(d.drop_lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return {
          lat: lat,
          lng: lng,
          address: String(d.drop_address || d.location || "").trim(),
          fulfillment_mode: d.fulfillment_mode || null,
          store_id: d.store_id != null ? String(d.store_id) : null,
          maps_url: d.drop_maps_url || d.maps_url || null,
        };
      }
    }
    return null;
  }

  function deliveryFeeFromItems(items) {
    var fee = 0;
    var seen = false;
    (items || []).forEach(function (it) {
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
    var hasStore = (items || []).some(function (i) {
      return i && i.data && i.data.store_id;
    });
    var hasSnap = (items || []).some(function (i) {
      var d = i && i.data;
      return d && (d.delivery_snapshot_version === 1 || d.fulfillment_mode);
    });
    if (hasStore && !hasSnap) return undefined;
    return 0;
  }

  function buildDraft(existing, mergedItems, opts) {
    var api = getDraftApi();
    var base = api && api.normalizeDraft ? api.normalizeDraft(existing) : existing || { items: [] };
    var loc = opts.customerLocation || customerLocationFromItems(mergedItems) || base.customer_location || null;
    var del = deliveryFeeFromItems(mergedItems);
    var draft = api.normalizeDraft({
      items: mergedItems,
      customer_location: loc,
      payment_method: base.payment_method,
      totals: {
        subtotal: itemsSubtotal(mergedItems),
        delivery: del,
        delivery_pending: del === undefined,
      },
      meta: {
        source_page: opts.sourcePage || (base.meta && base.meta.source_page) || null,
        migrated_from_cart: false,
        vertical: opts.vertical || null,
      },
    });
    return draft;
  }

  function validateService(item) {
    var phone = validateSaPhone(item && item.customer_phone);
    if (!phone && item && item.data) phone = validateSaPhone(item.data.customer_phone);
    if (!phone) return { ok: false, message: "أدخل رقم جوال سعودي صحيح (05xxxxxxxx أو 9665xxxxxxxx)" };
    var line = normalizeLine(item);
    line.customer_phone = phone;
    if (line.data) line.data.customer_phone = phone;
    var zeroOk = { delivery: 1, restaurant: 1, food: 1, service: 1 };
    var price = Number(line.price);
    if ((!Number.isFinite(price) || price <= 0) && !zeroOk[line.type]) {
      return { ok: false, message: "حدد المواقع أو الخدمة لحساب السعر قبل الإتمام" };
    }
    line.price = Number.isFinite(price) && price >= 0 ? roundMoney(price) : 0;
    line.payment_status = line.payment_status || "unpaid";
    return { ok: true, item: line };
  }

  function commit(item, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var api = getDraftApi();
    if (!api || typeof api.readDraft !== "function" || typeof api.writeDraft !== "function") {
      return { ok: false, message: "Order Draft Store غير متوفر" };
    }

    var normalized = item;
    var serviceTypes = {
      delivery: 1,
      vehicle_transfer: 1,
      car_transport: 1,
      internal_delivery: 1,
      pickup_truck: 1,
      furniture_move: 1,
      gas_delivery: 1,
      service: 1,
    };
    if (serviceTypes[item && item.type] || isMapDeliveryItem(item)) {
      var v = validateService(item);
      if (!v.ok) return v;
      normalized = v.item;
    } else {
      normalized = normalizeLine(item);
      if (!normalized) return { ok: false, message: "invalid_item" };
    }

    var existing = api.readDraft();
    var merge = mergeIntoItems(existing.items || [], normalized);
    if (!merge.ok) return merge;

    var draft = buildDraft(existing, merge.items, opts);
    var write = api.writeDraft(draft);
    if (!write.ok) {
      return { ok: false, message: (write.errors && write.errors[0]) || "تعذر حفظ المسودة" };
    }

    if (opts.redirect !== false) {
      try {
        if (opts.message) sessionStorage.setItem("ervenow:checkout-flash", opts.message);
      } catch (_e) {}
      global.location.href = CHECKOUT_PATH;
    }

    return { ok: true, draft: write.draft };
  }

  function getItems() {
    var api = getDraftApi();
    if (!api || typeof api.readDraft !== "function") return [];
    return (api.readDraft().items || []).slice();
  }

  function assertSnapshotCompatible(items, snapshot) {
    if (!items || !items.length) return { ok: true };
    var sid = String(snapshot.store_id || "");
    for (var i = 0; i < items.length; i += 1) {
      var d = items[i] && items[i].data;
      if (!d || !d.store_id) continue;
      if (String(d.store_id) !== sid) return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين" };
      if (d.delivery_snapshot_version === 1 && snapshot.delivery_snapshot_version === 1) {
        if (d.fulfillment_mode !== snapshot.fulfillment_mode) {
          return { ok: false, message: "نوع الاستلام/التوصيل يجب أن يكون موحّداً لكل المنتجات" };
        }
        if (
          d.fulfillment_mode !== "pickup" &&
          snapshot.fulfillment_mode !== "pickup" &&
          (Math.abs(Number(d.drop_lat) - Number(snapshot.drop_lat)) > 0.0001 ||
            Math.abs(Number(d.drop_lng) - Number(snapshot.drop_lng)) > 0.0001)
        ) {
          return { ok: false, message: "موقع التوصيل يجب أن يكون واحداً لكل المنتجات" };
        }
      }
    }
    return { ok: true };
  }

  function saveCustomerLocation(loc) {
    var api = getDraftApi();
    if (!api) return { ok: false };
    var existing = api.readDraft();
    var lat = Number(loc && loc.lat);
    var lng = Number(loc && loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false };
    return api.writeDraft(
      api.normalizeDraft({
        customer_location: {
          lat: lat,
          lng: lng,
          address: String((loc && loc.address) || "").trim(),
          fulfillment_mode: loc.fulfillment_mode || null,
          store_id: loc.store_id != null ? String(loc.store_id) : null,
          maps_url: loc.maps_url || null,
        },
        meta: Object.assign({}, existing.meta || {}, { updated_at: Date.now() }),
      })
    );
  }

  function syncHeaderBadge() {
    var el = document.getElementById("cartCount");
    if (!el) return;
    var n = getItems().reduce(function (s, i) {
      return s + (Number(i.data && i.data.qty) || 1);
    }, 0);
    el.textContent = String(n);
    el.setAttribute("data-empty", n ? "false" : "true");
  }

  global.ErvenowOrderDraftVertical = {
    CHECKOUT_PATH: CHECKOUT_PATH,
    validateSaPhone: validateSaPhone,
    commit: commit,
    getItems: getItems,
    assertSnapshotCompatible: assertSnapshotCompatible,
    saveCustomerLocation: saveCustomerLocation,
    syncHeaderBadge: syncHeaderBadge,
  };
})(typeof window !== "undefined" ? window : global);
