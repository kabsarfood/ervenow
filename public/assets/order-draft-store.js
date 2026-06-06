/**
 * ERVENOW Checkout Engine V1 — Order Draft Store (Phase 1, browser)
 * مصدر بيانات المسودة — يعمل بالتوازي مع cart.js (بدون حذف Legacy).
 * المنطق مطابق لـ shared/orderDraft/* — الاختبارات تستهدف shared/.
 */
(function (global) {
  "use strict";

  var ORDER_DRAFT_VERSION = 1;
  var ORDER_DRAFT_STORAGE_KEY = "ervenow:order-draft";
  var LEGACY_CART_STORAGE_KEY = "cart";
  var LEGACY_DELIVERY_LOC_KEY = "ervenow:delivery-location";
  var LEGACY_PAYMENT_METHOD_KEY = "erv_cart_payment_method";
  var CART_STORE_VERSION = 2;

  var SERVICE_TYPES = ["store", "restaurant", "gas", "service", "vehicle", "map_delivery"];
  var DELIVERY_ITEM_TYPES = {
    delivery: 1,
    vehicle_transfer: 1,
    car_transport: 1,
    internal_delivery: 1,
    pickup_truck: 1,
    furniture_move: 1,
    gas_delivery: 1,
  };

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function emptyOrderDraft() {
    var now = Date.now();
    return {
      version: ORDER_DRAFT_VERSION,
      service_type: null,
      provider_id: null,
      items: [],
      customer_location: null,
      payment_method: null,
      order_notes: "",
      totals: {
        subtotal: 0,
        delivery: null,
        vat: null,
        platform_fee: null,
        grand_total: null,
        delivery_pending: true,
      },
      meta: {
        created_at: now,
        updated_at: now,
        source_page: null,
        migrated_from_cart: false,
      },
    };
  }

  function isStoreProductLine(item) {
    var d = item && item.data;
    return !!(d && d.store_id && d.product_id != null && String(d.product_id).trim() !== "");
  }

  function isMapDeliveryLine(item) {
    var d = item && item.data;
    if (!d || typeof d !== "object") return false;
    if (String(d.source || "") === "dashboard_map") return true;
    return (
      String(item.type || "") === "delivery" &&
      Number.isFinite(Number(d.pickup_lat)) &&
      Number.isFinite(Number(d.drop_lat))
    );
  }

  function inferServiceTypeFromItems(items) {
    var list = Array.isArray(items) ? items : [];
    if (!list.length) return null;
    if (list.some(isMapDeliveryLine)) return "map_delivery";
    for (var i = 0; i < list.length; i += 1) {
      var t = String((list[i] && list[i].type) || "").toLowerCase();
      if (t === "gas_delivery") return "gas";
    }
    for (var j = 0; j < list.length; j += 1) {
      var t2 = String((list[j] && list[j].type) || "").toLowerCase();
      if (DELIVERY_ITEM_TYPES[t2] && t2 !== "gas_delivery") return "vehicle";
    }
    for (var k = 0; k < list.length; k += 1) {
      if (isStoreProductLine(list[k])) {
        var d = list[k].data || {};
        var st = String(d.store_type || "").toLowerCase();
        if (st === "restaurant" || /مطعم|restaurant/i.test(String(d.store_name || d.merchant_name || ""))) {
          return "restaurant";
        }
        return "store";
      }
    }
    return "service";
  }

  function inferProviderIdFromItems(items) {
    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i += 1) {
      var d = list[i] && list[i].data;
      if (d && d.store_id) return String(d.store_id);
    }
    return null;
  }

  function normalizeCustomerLocation(loc) {
    if (!loc || typeof loc !== "object") return null;
    var lat = Number(loc.lat);
    var lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat: lat,
      lng: lng,
      address: String(loc.address || loc.drop_address || "").trim(),
      fulfillment_mode: loc.fulfillment_mode ? String(loc.fulfillment_mode) : null,
      store_id: loc.store_id != null ? String(loc.store_id) : null,
      maps_url: loc.maps_url || loc.drop_maps_url || null,
    };
  }

  function computeItemsSubtotal(items) {
    return roundMoney(
      (items || []).reduce(function (sum, it) {
        return sum + (Number(it && it.price) || 0);
      }, 0)
    );
  }

  function normalizeOrderDraft(input) {
    var base = emptyOrderDraft();
    if (!input || typeof input !== "object") return base;

    var draft = Object.assign({}, base, input);
    draft.version = ORDER_DRAFT_VERSION;
    draft.items = Array.isArray(input.items) ? input.items.slice() : [];
    draft.service_type = SERVICE_TYPES.indexOf(input.service_type) >= 0 ? input.service_type : null;
    draft.provider_id =
      input.provider_id != null && String(input.provider_id).trim() ? String(input.provider_id) : null;
    draft.payment_method =
      input.payment_method != null && String(input.payment_method).trim() ? String(input.payment_method) : null;
    draft.order_notes =
      input.order_notes != null ? String(input.order_notes).trim().slice(0, 500) : "";
    draft.customer_location = normalizeCustomerLocation(input.customer_location);

    var totalsIn = input.totals && typeof input.totals === "object" ? input.totals : {};
    draft.totals = {
      subtotal: Number.isFinite(Number(totalsIn.subtotal))
        ? roundMoney(totalsIn.subtotal)
        : computeItemsSubtotal(draft.items),
      delivery: Number.isFinite(Number(totalsIn.delivery)) ? roundMoney(totalsIn.delivery) : null,
      vat: Number.isFinite(Number(totalsIn.vat)) ? roundMoney(totalsIn.vat) : null,
      platform_fee: Number.isFinite(Number(totalsIn.platform_fee)) ? roundMoney(totalsIn.platform_fee) : null,
      grand_total: Number.isFinite(Number(totalsIn.grand_total)) ? roundMoney(totalsIn.grand_total) : null,
      delivery_pending: totalsIn.delivery_pending !== false,
    };

    var metaIn = input.meta && typeof input.meta === "object" ? input.meta : {};
    draft.meta = {
      created_at: Number.isFinite(Number(metaIn.created_at)) ? Number(metaIn.created_at) : base.meta.created_at,
      updated_at: Number.isFinite(Number(metaIn.updated_at)) ? Number(metaIn.updated_at) : Date.now(),
      source_page: metaIn.source_page != null ? String(metaIn.source_page) : null,
      migrated_from_cart: !!metaIn.migrated_from_cart,
    };

    if (!draft.service_type && draft.items.length) {
      draft.service_type = inferServiceTypeFromItems(draft.items);
    }
    if (!draft.provider_id && draft.items.length) {
      draft.provider_id = inferProviderIdFromItems(draft.items);
    }

    return draft;
  }

  function validateOrderDraft(draft) {
    var errors = [];
    var d = normalizeOrderDraft(draft);

    if (d.version !== ORDER_DRAFT_VERSION) errors.push("invalid_version");
    if (!Array.isArray(d.items)) errors.push("items_must_be_array");
    if (d.items.length && !d.service_type) errors.push("service_type_required_when_items_present");
    if (d.service_type && SERVICE_TYPES.indexOf(d.service_type) < 0) errors.push("invalid_service_type");
    if ((d.service_type === "store" || d.service_type === "restaurant") && d.items.length && !d.provider_id) {
      errors.push("provider_id_required_for_store");
    }
    if (d.payment_method != null && !String(d.payment_method).trim()) errors.push("invalid_payment_method");
    if (d.customer_location) {
      if (
        !Number.isFinite(Number(d.customer_location.lat)) ||
        !Number.isFinite(Number(d.customer_location.lng))
      ) {
        errors.push("invalid_customer_location_coords");
      }
    }

    return { ok: errors.length === 0, errors: errors, draft: d };
  }

  function hasDraftItems(draft) {
    return !!(draft && Array.isArray(draft.items) && draft.items.length);
  }

  function emptyLegacyCartStore() {
    return { version: CART_STORE_VERSION, items: [], delivery: {}, payment: {}, totals: {} };
  }

  function parseLegacyDeliveryLocRaw(raw) {
    if (!raw) return null;
    try {
      var o = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!o || typeof o !== "object") return null;
      return normalizeCustomerLocation({
        lat: o.lat,
        lng: o.lng,
        address: o.address || o.drop_address,
        fulfillment_mode: o.fulfillment_mode,
        store_id: o.store_id,
        maps_url: o.maps_url || o.drop_maps_url,
      });
    } catch (_e) {
      return null;
    }
  }

  function parseLegacyCartStore(parsed) {
    if (!parsed) return emptyLegacyCartStore();
    if (Array.isArray(parsed)) {
      return Object.assign(emptyLegacyCartStore(), { items: parsed.slice() });
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      var store = emptyLegacyCartStore();
      store.items = parsed.items.slice();
      if (parsed.delivery && typeof parsed.delivery === "object") store.delivery = parsed.delivery;
      if (parsed.payment && typeof parsed.payment === "object") store.payment = parsed.payment;
      if (parsed.totals && typeof parsed.totals === "object") store.totals = parsed.totals;
      if (parsed.version === CART_STORE_VERSION) store.version = CART_STORE_VERSION;
      return store;
    }
    return Object.assign(emptyLegacyCartStore(), { items: [] });
  }

  function deliveryRecordToCustomerLocation(delivery, items) {
    var fromDelivery = normalizeCustomerLocation(delivery);
    if (fromDelivery) return fromDelivery;

    var list = Array.isArray(items) ? items : [];
    for (var i = 0; i < list.length; i += 1) {
      var d = list[i] && list[i].data;
      if (!d) continue;
      var loc = normalizeCustomerLocation({
        lat: d.drop_lat != null ? d.drop_lat : d.lat,
        lng: d.drop_lng != null ? d.drop_lng : d.lng,
        address: d.drop_address || d.address || d.location,
        fulfillment_mode: d.fulfillment_mode,
        store_id: d.store_id,
        maps_url: d.drop_maps_url || d.maps_url,
      });
      if (loc) return loc;
    }
    return null;
  }

  function migrateFromLegacyCart(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var parsed = opts.cartRaw;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch (_e2) {
        parsed = null;
      }
    }

    var legacyCartStore = parseLegacyCartStore(parsed);
    var items = legacyCartStore.items.slice();

    if (!items.length) {
      return { draft: emptyOrderDraft(), migrated: false, legacyCartStore: legacyCartStore };
    }

    var legacyLoc =
      parseLegacyDeliveryLocRaw(opts.legacyDeliveryLocRaw) ||
      (opts.legacyDeliveryLocRaw == null && legacyCartStore.delivery
        ? deliveryRecordToCustomerLocation(legacyCartStore.delivery, items)
        : null) ||
      deliveryRecordToCustomerLocation(null, items);

    var paymentMethod = null;
    if (legacyCartStore.payment && legacyCartStore.payment.method) {
      paymentMethod = String(legacyCartStore.payment.method);
    } else if (opts.legacyPaymentMethod) {
      paymentMethod = String(opts.legacyPaymentMethod);
    }

    var deliveryFee = null;
    if (legacyCartStore.totals && Number.isFinite(Number(legacyCartStore.totals.deliveryFee))) {
      deliveryFee = roundMoney(Number(legacyCartStore.totals.deliveryFee));
    } else if (Number.isFinite(Number(opts.runtimeDeliveryFee))) {
      deliveryFee = roundMoney(Number(opts.runtimeDeliveryFee));
    }

    var subtotal = computeItemsSubtotal(items);
    var now = Date.now();

    var draft = normalizeOrderDraft({
      service_type: inferServiceTypeFromItems(items),
      provider_id: inferProviderIdFromItems(items),
      items: items,
      customer_location: legacyLoc,
      payment_method: paymentMethod,
      totals: {
        subtotal: subtotal,
        delivery: deliveryFee,
        vat: null,
        platform_fee: null,
        grand_total: null,
        delivery_pending: deliveryFee == null,
      },
      meta: {
        created_at: now,
        updated_at: now,
        source_page: opts.sourcePage || null,
        migrated_from_cart: true,
      },
    });

    return { draft: draft, migrated: true, legacyCartStore: legacyCartStore };
  }

  function createMemoryStorage(initial) {
    var bag = Object.assign({}, initial || {});
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
      },
      setItem: function (key, value) {
        bag[key] = value;
      },
      removeItem: function (key) {
        delete bag[key];
      },
    };
  }

  function createOrderDraftStore(storage, options) {
    options = options && typeof options === "object" ? options : {};
    var cache = null;

    function readDraft() {
      if (cache) return normalizeOrderDraft(cache);
      try {
        var raw = storage.getItem(ORDER_DRAFT_STORAGE_KEY);
        if (!raw) {
          cache = emptyOrderDraft();
          return normalizeOrderDraft(cache);
        }
        cache = normalizeOrderDraft(JSON.parse(raw));
        return cache;
      } catch (_e) {
        cache = emptyOrderDraft();
        return cache;
      }
    }

    function writeDraft(draft) {
      var normalized = normalizeOrderDraft(draft);
      normalized.meta.updated_at = Date.now();
      var validation = validateOrderDraft(normalized);
      if (!validation.ok) {
        return { ok: false, errors: validation.errors, draft: validation.draft };
      }
      cache = validation.draft;
      try {
        storage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(cache));
      } catch (_e2) {
        return { ok: false, errors: ["storage_write_failed"], draft: cache };
      }
      if (typeof options.onChange === "function") {
        try {
          options.onChange(cache);
        } catch (_e3) {}
      }
      return { ok: true, errors: [], draft: cache };
    }

    function clearDraft() {
      cache = null;
      try {
        storage.removeItem(ORDER_DRAFT_STORAGE_KEY);
      } catch (_e) {}
      if (typeof options.onChange === "function") {
        try {
          options.onChange(emptyOrderDraft());
        } catch (_e2) {}
      }
      return emptyOrderDraft();
    }

    function getDraftItems() {
      return readDraft().items.slice();
    }

    function isDraftEmpty() {
      return !hasDraftItems(readDraft());
    }

    function tryMigrateFromLegacyCart(migrateOpts) {
      migrateOpts = migrateOpts && typeof migrateOpts === "object" ? migrateOpts : {};
      var existing = readDraft();
      if (hasDraftItems(existing)) {
        return { ok: true, migrated: false, reason: "draft_already_has_items", draft: existing };
      }

      var cartRaw = storage.getItem(LEGACY_CART_STORAGE_KEY);
      if (!cartRaw) {
        return { ok: true, migrated: false, reason: "no_legacy_cart", draft: existing };
      }

      var result = migrateFromLegacyCart({
        cartRaw: cartRaw,
        legacyDeliveryLocRaw: storage.getItem(LEGACY_DELIVERY_LOC_KEY),
        legacyPaymentMethod: storage.getItem(LEGACY_PAYMENT_METHOD_KEY),
        runtimeDeliveryFee: migrateOpts.runtimeDeliveryFee,
        sourcePage: migrateOpts.sourcePage || null,
      });

      if (!result.migrated) {
        return { ok: true, migrated: false, reason: "legacy_cart_empty", draft: existing };
      }

      var writeResult = writeDraft(result.draft);
      return {
        ok: writeResult.ok,
        migrated: writeResult.ok,
        reason: writeResult.ok ? "migrated_from_cart" : "write_failed",
        errors: writeResult.errors,
        draft: writeResult.draft,
        legacyCartStore: result.legacyCartStore,
      };
    }

    function invalidateCache() {
      cache = null;
    }

    return {
      ORDER_DRAFT_STORAGE_KEY: ORDER_DRAFT_STORAGE_KEY,
      LEGACY_CART_STORAGE_KEY: LEGACY_CART_STORAGE_KEY,
      readDraft: readDraft,
      writeDraft: writeDraft,
      clearDraft: clearDraft,
      getDraftItems: getDraftItems,
      isDraftEmpty: isDraftEmpty,
      tryMigrateFromLegacyCart: tryMigrateFromLegacyCart,
      invalidateCache: invalidateCache,
    };
  }

  function getBrowserStorage() {
    try {
      if (global.localStorage) return global.localStorage;
    } catch (_e) {}
    return createMemoryStorage();
  }

  var store = createOrderDraftStore(getBrowserStorage(), {
    onChange: function (draft) {
      try {
        global.dispatchEvent(
          new CustomEvent("ervenow:order-draft-changed", {
            detail: { itemCount: (draft.items && draft.items.length) || 0 },
          })
        );
      } catch (_e2) {}
    },
  });

  function onDraftChange(handler) {
    if (typeof handler !== "function") return function () {};
    function listener(ev) {
      handler(ev && ev.detail ? ev.detail : {}, store.readDraft());
    }
    global.addEventListener("ervenow:order-draft-changed", listener);
    global.addEventListener("storage", function (ev) {
      if (ev && ev.key === ORDER_DRAFT_STORAGE_KEY) {
        store.invalidateCache();
        handler({ storageEvent: true }, store.readDraft());
      }
    });
    return function () {
      global.removeEventListener("ervenow:order-draft-changed", listener);
    };
  }

  global.ErvenowOrderDraft = {
    VERSION: ORDER_DRAFT_VERSION,
    STORAGE_KEY: ORDER_DRAFT_STORAGE_KEY,
    LEGACY_CART_KEY: LEGACY_CART_STORAGE_KEY,
    SERVICE_TYPES: SERVICE_TYPES,
    emptyDraft: emptyOrderDraft,
    normalizeDraft: normalizeOrderDraft,
    validateDraft: validateOrderDraft,
    inferServiceTypeFromItems: inferServiceTypeFromItems,
    inferProviderIdFromItems: inferProviderIdFromItems,
    migrateFromLegacyCart: migrateFromLegacyCart,
    readDraft: store.readDraft,
    writeDraft: store.writeDraft,
    clearDraft: store.clearDraft,
    getItems: store.getDraftItems,
    isEmpty: store.isDraftEmpty,
    tryMigrateFromLegacyCart: function (opts) {
      return store.tryMigrateFromLegacyCart({
        runtimeDeliveryFee:
          opts && opts.runtimeDeliveryFee != null ? opts.runtimeDeliveryFee : global.__ervCartDeliveryFee,
        sourcePage: opts && opts.sourcePage ? opts.sourcePage : global.location && global.location.pathname,
      });
    },
    onDraftChange: onDraftChange,
    _createMemoryStorage: createMemoryStorage,
    _createOrderDraftStore: createOrderDraftStore,
  };
})(typeof window !== "undefined" ? window : global);
