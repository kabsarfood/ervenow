const {
  inferWorkflow,
  inferSource,
  groupFulfillmentItems,
  normalizeUnifiedCartLine,
  splitFulfillmentBatches,
} = require("../../shared/orderDraft/unifiedCartLine");

describe("unifiedCartLine + fulfillment groups", () => {
  test("normalizes a legacy store product line without dropping type/data", () => {
    const line = normalizeUnifiedCartLine({
      type: "restaurant",
      title: "مطعم الأسماك — وجبة",
      price: 40,
      data: { store_id: "rest-1", product_id: "p1", store_name: "مطعم الأسماك", store_type: "restaurant", qty: 2 },
    });
    expect(line.workflow).toBe("store");
    expect(line.source).toBe("restaurant");
    expect(line.provider_id).toBe("rest-1");
    expect(line.item_id).toBe("p1");
    expect(line.qty).toBe(2);
    expect(line.type).toBe("restaurant");
    expect(line.data.store_id).toBe("rest-1");
  });

  test("groups restaurant + pharmacy + tow into three fulfillment keys", () => {
    const items = [
      {
        id: "l1",
        type: "restaurant",
        title: "مطعم أ",
        price: 50,
        data: { store_id: "a", product_id: "p1", store_name: "مطعم أ", store_type: "restaurant" },
      },
      {
        id: "l2",
        type: "pharmacy",
        title: "صيدلية ب",
        price: 20,
        data: { store_id: "b", product_id: "p2", store_name: "صيدلية ب", store_type: "pharmacy" },
      },
      {
        id: "l3",
        type: "pickup_truck",
        title: "سطحة",
        price: 150,
        data: { pickup_lat: 24.7, pickup_lng: 46.6, drop_lat: 24.8, drop_lng: 46.7 },
      },
    ];
    const groups = groupFulfillmentItems(items);
    expect(groups.map((g) => g.key)).toEqual(["store:a", "store:b", "transport:pickup_truck:l3"]);
    expect(groups[0].heading_ar).toBe("طلبك من مطعم أ");
    expect(groups[1].heading_ar).toMatch(/صيدلية/);
    expect(groups[2].heading_ar).toBe("خدمة سطحة");
    expect(inferWorkflow(items[2])).toBe("transport");
    expect(inferSource(items[2], "transport")).toBe("tow");
  });

  test("same store products stay in one group", () => {
    const items = [
      { type: "store", data: { store_id: "s1", product_id: "p1" }, price: 10 },
      { type: "store", data: { store_id: "s1", product_id: "p2" }, price: 12 },
    ];
    const groups = groupFulfillmentItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("store:s1");
    expect(groups[0].items).toHaveLength(2);
  });

  test("car_transport heading is نقل مركبات without repeating مطعم", () => {
    const groups = groupFulfillmentItems([
      {
        id: "t1",
        type: "car_transport",
        title: "نقل مركبات",
        price: 180,
        data: { pickup_lat: 24.7, drop_lat: 24.8 },
      },
    ]);
    expect(groups[0].workflow).toBe("transport");
    expect(groups[0].heading_ar).toBe("نقل مركبات");
  });

  test("splitFulfillmentBatches splits two pharmacies and keeps delivery per line", () => {
    const storeItems = [
      { type: "pharmacy", data: { store_id: "p1" } },
      { type: "pharmacy", data: { store_id: "p2" } },
    ];
    const storeBatches = splitFulfillmentBatches("store", storeItems);
    expect(storeBatches).toHaveLength(2);
    const delBatches = splitFulfillmentBatches("delivery", [{ id: 1 }, { id: 2 }]);
    expect(delBatches).toHaveLength(2);
  });
});
