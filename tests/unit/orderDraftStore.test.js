/**
 * Checkout Engine V1 — Phase 1: Order Draft Store
 */
const schema = require("../../shared/orderDraft/orderDraftSchema");
const migrate = require("../../shared/orderDraft/migrateFromLegacyCart");
const core = require("../../shared/orderDraft/orderDraftStoreCore");

const {
  ORDER_DRAFT_VERSION,
  ORDER_DRAFT_STORAGE_KEY,
  LEGACY_CART_STORAGE_KEY,
  LEGACY_DELIVERY_LOC_KEY,
  LEGACY_PAYMENT_METHOD_KEY,
  emptyOrderDraft,
  normalizeOrderDraft,
  validateOrderDraft,
  inferServiceTypeFromItems,
  inferProviderIdFromItems,
  hasDraftItems,
} = schema;

const { migrateFromLegacyCart, parseLegacyCartStore } = migrate;
const { createMemoryStorage, createOrderDraftStore } = core;

describe("orderDraftSchema", () => {
  test("emptyOrderDraft has version 1 and empty items", () => {
    const d = emptyOrderDraft();
    expect(d.version).toBe(ORDER_DRAFT_VERSION);
    expect(d.items).toEqual([]);
    expect(d.totals.delivery_pending).toBe(true);
    expect(d.meta.migrated_from_cart).toBe(false);
  });

  test("inferServiceTypeFromItems — store product line", () => {
    const items = [{ type: "store", price: 50, data: { store_id: "s1", product_id: "p1" } }];
    expect(inferServiceTypeFromItems(items)).toBe("store");
    expect(inferProviderIdFromItems(items)).toBe("s1");
  });

  test("inferServiceTypeFromItems — restaurant via store_type", () => {
    const items = [
      { type: "store", price: 30, data: { store_id: "r1", product_id: "x", store_type: "restaurant" } },
    ];
    expect(inferServiceTypeFromItems(items)).toBe("restaurant");
  });

  test("inferServiceTypeFromItems — map delivery", () => {
    const items = [
      {
        type: "delivery",
        price: 40,
        data: { source: "dashboard_map", pickup_lat: 24.7, drop_lat: 24.8 },
      },
    ];
    expect(inferServiceTypeFromItems(items)).toBe("map_delivery");
  });

  test("validateOrderDraft rejects store without provider_id", () => {
    const result = validateOrderDraft({
      service_type: "store",
      items: [{ type: "store", price: 10, data: { product_id: "p" } }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("provider_id_required_for_store");
  });

  test("normalizeOrderDraft fills service_type from items", () => {
    const d = normalizeOrderDraft({
      items: [{ type: "gas_delivery", price: 20, data: {} }],
    });
    expect(d.service_type).toBe("gas");
    expect(d.totals.subtotal).toBe(20);
  });
});

describe("migrateFromLegacyCart", () => {
  test("returns empty draft when cart has no items", () => {
    const result = migrateFromLegacyCart({
      cartRaw: JSON.stringify({ version: 2, items: [], delivery: {}, payment: {}, totals: {} }),
    });
    expect(result.migrated).toBe(false);
    expect(result.draft.items).toEqual([]);
  });

  test("migrates cart v2 store line with payment and delivery location", () => {
    const cart = {
      version: 2,
      items: [
        {
          type: "store",
          price: 100,
          data: { store_id: "store-abc", product_id: "prod-1", qty: 1 },
        },
      ],
      delivery: { lat: 24.7136, lng: 46.6753, address: "الرياض" },
      payment: { method: "mada" },
      totals: { deliveryFee: 11.5 },
    };
    const result = migrateFromLegacyCart({
      cartRaw: JSON.stringify(cart),
      sourcePage: "/cart",
    });
    expect(result.migrated).toBe(true);
    expect(result.draft.items).toHaveLength(1);
    expect(result.draft.service_type).toBe("store");
    expect(result.draft.provider_id).toBe("store-abc");
    expect(result.draft.payment_method).toBe("mada");
    expect(result.draft.customer_location).toMatchObject({ lat: 24.7136, lng: 46.6753, address: "الرياض" });
    expect(result.draft.totals.subtotal).toBe(100);
    expect(result.draft.totals.delivery).toBe(11.5);
    expect(result.draft.totals.delivery_pending).toBe(false);
    expect(result.draft.meta.migrated_from_cart).toBe(true);
    expect(result.draft.meta.source_page).toBe("/cart");
  });

  test("migrates legacy array cart format", () => {
    const legacy = [{ type: "service", price: 25, data: { title: "تنظيف" } }];
    const parsed = parseLegacyCartStore(legacy);
    expect(parsed.items).toHaveLength(1);
    const result = migrateFromLegacyCart({ cartRaw: JSON.stringify(legacy) });
    expect(result.migrated).toBe(true);
    expect(result.draft.service_type).toBe("service");
    expect(result.draft.totals.subtotal).toBe(25);
  });

  test("reads legacy delivery-location key and payment method fallback", () => {
    const cart = {
      version: 2,
      items: [{ type: "store", price: 50, data: { store_id: "s2", product_id: "p2" } }],
      delivery: {},
      payment: {},
      totals: {},
    };
    const result = migrateFromLegacyCart({
      cartRaw: JSON.stringify(cart),
      legacyDeliveryLocRaw: JSON.stringify({ lat: 21.5, lng: 39.2, address: "جدة" }),
      legacyPaymentMethod: "apple_pay",
      runtimeDeliveryFee: 9,
    });
    expect(result.draft.customer_location.address).toBe("جدة");
    expect(result.draft.payment_method).toBe("apple_pay");
    expect(result.draft.totals.delivery).toBe(9);
  });
});

describe("orderDraftStoreCore", () => {
  function makeStore(initial) {
    return createOrderDraftStore(createMemoryStorage(initial));
  }

  test("readDraft returns empty when storage has no draft key", () => {
    const store = makeStore();
    const d = store.readDraft();
    expect(hasDraftItems(d)).toBe(false);
    expect(d.version).toBe(ORDER_DRAFT_VERSION);
  });

  test("writeDraft persists and readDraft returns normalized draft", () => {
    const store = makeStore();
    const items = [{ type: "store", price: 80, data: { store_id: "s3", product_id: "p3" } }];
    const write = store.writeDraft({
      service_type: "store",
      provider_id: "s3",
      items,
    });
    expect(write.ok).toBe(true);
    expect(write.draft.totals.subtotal).toBe(80);

    const storage = createMemoryStorage();
    storage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(write.draft));
    const store2 = createOrderDraftStore(storage);
    const read = store2.readDraft();
    expect(read.items).toHaveLength(1);
    expect(read.provider_id).toBe("s3");
  });

  test("clearDraft removes draft from storage", () => {
    const mem = createMemoryStorage();
    const store = createOrderDraftStore(mem);
    store.writeDraft({
      service_type: "service",
      items: [{ type: "service", price: 10, data: {} }],
    });
    expect(mem.getItem(ORDER_DRAFT_STORAGE_KEY)).toBeTruthy();
    store.clearDraft();
    expect(mem.getItem(ORDER_DRAFT_STORAGE_KEY)).toBeNull();
    expect(store.isDraftEmpty()).toBe(true);
  });

  test("tryMigrateFromLegacyCart migrates when draft empty and does not delete cart", () => {
    const cartPayload = {
      version: 2,
      items: [{ type: "store", price: 60, data: { store_id: "s4", product_id: "p4" } }],
      delivery: {},
      payment: { method: "mada" },
      totals: {},
    };
    const mem = createMemoryStorage({
      [LEGACY_CART_STORAGE_KEY]: JSON.stringify(cartPayload),
      [LEGACY_DELIVERY_LOC_KEY]: JSON.stringify({ lat: 24.0, lng: 46.0, address: "test" }),
      [LEGACY_PAYMENT_METHOD_KEY]: "mada",
    });
    const store = createOrderDraftStore(mem);
    const result = store.tryMigrateFromLegacyCart({ sourcePage: "/index" });

    expect(result.migrated).toBe(true);
    expect(result.reason).toBe("migrated_from_cart");
    expect(result.draft.items).toHaveLength(1);
    expect(result.draft.meta.migrated_from_cart).toBe(true);
    expect(mem.getItem(LEGACY_CART_STORAGE_KEY)).toBe(JSON.stringify(cartPayload));
    expect(mem.getItem(ORDER_DRAFT_STORAGE_KEY)).toBeTruthy();
  });

  test("tryMigrateFromLegacyCart skips when draft already has items", () => {
    const mem = createMemoryStorage({
      [ORDER_DRAFT_STORAGE_KEY]: JSON.stringify(
        normalizeOrderDraft({
          service_type: "service",
          items: [{ type: "service", price: 5, data: {} }],
        })
      ),
      [LEGACY_CART_STORAGE_KEY]: JSON.stringify({
        version: 2,
        items: [{ type: "store", price: 99, data: { store_id: "x", product_id: "y" } }],
        delivery: {},
        payment: {},
        totals: {},
      }),
    });
    const store = createOrderDraftStore(mem);
    const result = store.tryMigrateFromLegacyCart();
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("draft_already_has_items");
    expect(result.draft.items).toHaveLength(1);
    expect(result.draft.items[0].price).toBe(5);
  });

  test("tryMigrateFromLegacyCart returns no_legacy_cart when cart key missing", () => {
    const store = makeStore();
    const result = store.tryMigrateFromLegacyCart();
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no_legacy_cart");
  });
});
