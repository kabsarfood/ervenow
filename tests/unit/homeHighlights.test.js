const {
  MIN_RATING_COUNT,
  rankTopRated,
  aggregateDemand,
  rankMostOrdered,
  buildPublicStats,
  restaurantChips,
  storeTypeChips,
  demandSinceIso,
} = require("../../shared/utils/homeHighlights");

describe("homeHighlights", () => {
  test("top rated skips cards under the minimum rating count", () => {
    const ranked = rankTopRated([
      { id: "a", rating_avg: 4.9, rating_count: 2 },
      { id: "b", rating_avg: 4.2, rating_count: MIN_RATING_COUNT },
      { id: "c", rating_avg: 4.8, rating_count: 9 },
      { id: "d", rating_avg: 0, rating_count: 20 },
    ]);
    expect(ranked.map((row) => row.id)).toEqual(["c", "b"]);
  });

  test("most ordered counts only completed orders inside the window", () => {
    const since = demandSinceIso(new Date("2026-09-29T12:00:00Z"), 30);
    const demand = aggregateDemand(
      [
        { store_id: "s1", delivery_status: "delivered", created_at: "2026-09-20T00:00:00Z", city: "الرياض" },
        { store_id: "s1", status: "completed", created_at: "2026-09-21T00:00:00Z", city: "الرياض" },
        { store_id: "s2", delivery_status: "pending", created_at: "2026-09-21T00:00:00Z", city: "جدة" },
        { store_id: "s2", delivery_status: "delivered", created_at: "2026-01-01T00:00:00Z", city: "جدة" },
        { service_type: "gas_delivery", delivery_status: "delivered", created_at: "2026-09-22T00:00:00Z" },
      ],
      since
    );
    expect(demand.byStore.get("s1")).toBe(2);
    expect(demand.byStore.has("s2")).toBe(false);
    expect(demand.serviceCounts).toEqual([{ key: "gas_delivery", count: 1 }]);
    expect([...demand.cities]).toEqual(["الرياض"]);

    const ranked = rankMostOrdered(
      [
        { id: "s1", rating_avg: 4 },
        { id: "s2", rating_avg: 5 },
        { id: "service:gas_delivery", rating_avg: 0 },
      ],
      new Map([
        ["s1", 2],
        ["service:gas_delivery", 1],
      ])
    );
    expect(ranked.map((row) => row.id)).toEqual(["s1", "service:gas_delivery"]);
  });

  test("public stats omit missing numbers and prefer platform settings", () => {
    expect(buildPublicStats({ storeCount: 0, customerCount: 0, cityCount: 0, settings: {} })).toEqual([]);
    expect(
      buildPublicStats({
        storeCount: 4,
        customerCount: 10,
        cityCount: 2,
        settings: { customers: 80, delivery_minutes: 25 },
      })
    ).toEqual([
      { key: "customers", value: "80", label: "عدد العملاء" },
      { key: "stores", value: "4", label: "متجر نشط" },
      { key: "cities", value: "2", label: "المدن المخدومة" },
      { key: "delivery", value: "25 دقيقة", label: "توصيل سريع" },
    ]);
  });

  test("category chips come from live store rows", () => {
    const stores = [
      { type: "restaurant", category: "burger" },
      { type: "restaurant", category: "burger" },
      { type: "restaurant", category: "cafe" },
      { type: "pharmacy" },
      { type: "clothing" },
      { type: "clothing" },
    ];
    expect(restaurantChips(stores, (slug) => (slug === "burger" ? "برقر" : slug === "cafe" ? "كافيه" : null))).toEqual([
      { label: "برقر", href: "/restaurants?category=burger" },
      { label: "كافيه", href: "/restaurants?category=cafe" },
    ]);
    expect(storeTypeChips(stores)).toEqual([
      { label: "ملابس", href: "/stores?type=clothing" },
      { label: "صيدليات", href: "/stores?type=pharmacy" },
    ]);
  });
});
