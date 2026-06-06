/**
 * ERVENOW Checkout Engine V1 — Order Draft Store core (Phase 1)
 * Storage-agnostic read/write — browser adapter in public/assets/order-draft-store.js
 */

const {
  ORDER_DRAFT_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  emptyOrderDraft,
  normalizeOrderDraft,
  validateOrderDraft,
  hasDraftItems,
} = require("./orderDraftSchema");

const {
  migrateFromLegacyCart,
  LEGACY_DELIVERY_LOC_KEY,
  LEGACY_PAYMENT_METHOD_KEY,
} = require("./migrateFromLegacyCart");

function createMemoryStorage(initial) {
  const bag = Object.assign({}, initial || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
    },
    setItem(key, value) {
      bag[key] = value;
    },
    removeItem(key) {
      delete bag[key];
    },
  };
}

function createOrderDraftStore(storage, options) {
  options = options && typeof options === "object" ? options : {};
  let cache = null;

  function readDraft() {
    if (cache) return normalizeOrderDraft(cache);
    try {
      const raw = storage.getItem(ORDER_DRAFT_STORAGE_KEY);
      if (!raw) {
        cache = emptyOrderDraft();
        return normalizeOrderDraft(cache);
      }
      const parsed = JSON.parse(raw);
      cache = normalizeOrderDraft(parsed);
      return cache;
    } catch (_e) {
      cache = emptyOrderDraft();
      return cache;
    }
  }

  function writeDraft(draft) {
    const normalized = normalizeOrderDraft(draft);
    normalized.meta.updated_at = Date.now();
    const validation = validateOrderDraft(normalized);
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

  /**
   * ينقل من localStorage cart إذا لم توجد مسودة نشطة.
   * لا يحذف cart — Phase 1 بدون حذف نهائي.
   */
  function tryMigrateFromLegacyCart(migrateOpts) {
    migrateOpts = migrateOpts && typeof migrateOpts === "object" ? migrateOpts : {};
    const existing = readDraft();
    if (hasDraftItems(existing)) {
      return { ok: true, migrated: false, reason: "draft_already_has_items", draft: existing };
    }

    const cartRaw = storage.getItem(LEGACY_CART_STORAGE_KEY);
    if (!cartRaw) {
      return { ok: true, migrated: false, reason: "no_legacy_cart", draft: existing };
    }

    const result = migrateFromLegacyCart({
      cartRaw,
      legacyDeliveryLocRaw: storage.getItem(LEGACY_DELIVERY_LOC_KEY),
      legacyPaymentMethod: storage.getItem(LEGACY_PAYMENT_METHOD_KEY),
      runtimeDeliveryFee: migrateOpts.runtimeDeliveryFee,
      sourcePage: migrateOpts.sourcePage || null,
    });

    if (!result.migrated) {
      return { ok: true, migrated: false, reason: "legacy_cart_empty", draft: existing };
    }

    const writeResult = writeDraft(result.draft);
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
    ORDER_DRAFT_STORAGE_KEY,
    LEGACY_CART_STORAGE_KEY,
    readDraft,
    writeDraft,
    clearDraft,
    getDraftItems,
    isDraftEmpty,
    tryMigrateFromLegacyCart,
    invalidateCache,
  };
}

module.exports = {
  ORDER_DRAFT_STORAGE_KEY,
  createMemoryStorage,
  createOrderDraftStore,
};
