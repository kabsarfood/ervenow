const {
  createMemoryStorage,
  createOrderDraftStore,
} = require("../../shared/orderDraft/orderDraftStoreCore");
const {
  commitItemToDraft,
  mergeItemIntoItems,
  assertSnapshotCompatibleWithItems,
  validateSaPhone,
} = require("../../shared/orderDraft/verticalDraftBridge");

describe("verticalDraftBridge", () => {
  function makeApi(initial) {
    return createOrderDraftStore(createMemoryStorage(initial || {}));
  }

  test("commitItemToDraft writes draft and does not touch cart key", () => {
    const mem = createMemoryStorage({ cart: JSON.stringify({ version: 2, items: [{ type: "x", price: 1 }] }) });
    const api = createOrderDraftStore(mem);
    const item = {
      type: "store",
      title: "متجر — منتج",
      price: 50,
      data: { store_id: "s1", product_id: "p1", qty: 1, delivery_snapshot_version: 1, fulfillment_mode: "pickup" },
    };
    const res = commitItemToDraft(api, item, { sourcePage: "/store", vertical: "store", redirect: false });
    expect(res.ok).toBe(true);
    expect(res.draft.items).toHaveLength(1);
    expect(mem.getItem("cart")).toBeTruthy();
    expect(mem.getItem("ervenow:order-draft")).toBeTruthy();
  });

  test("mergeItemIntoItems rejects mixed stores", () => {
    const items = [{ type: "store", price: 10, data: { store_id: "a", product_id: "1", qty: 1 } }];
    const next = {
      type: "store",
      price: 20,
      data: { store_id: "b", product_id: "2", qty: 1 },
    };
    const merge = mergeItemIntoItems(items, next);
    expect(merge.ok).toBe(false);
  });

  test("validateSaPhone normalizes 966 format", () => {
    expect(validateSaPhone("966501234567")).toBe("0501234567");
  });

  test("assertSnapshotCompatibleWithItems enforces unified fulfillment", () => {
    const items = [
      {
        type: "store",
        price: 10,
        data: {
          store_id: "s1",
          product_id: "p1",
          delivery_snapshot_version: 1,
          fulfillment_mode: "pickup",
        },
      },
    ];
    const snap = {
      store_id: "s1",
      delivery_snapshot_version: 1,
      fulfillment_mode: "ervenow_delivery",
      drop_lat: 24.7,
      drop_lng: 46.6,
    };
    const compat = assertSnapshotCompatibleWithItems(items, snap);
    expect(compat.ok).toBe(false);
  });
});
