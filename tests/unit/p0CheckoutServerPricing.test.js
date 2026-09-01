jest.mock("../../shared/utils/osrmClient", () => ({
  getOsrmRouteKmOrHaversine: jest.fn(async () => 10),
}));

const {
  effectiveCatalogUnitPrice,
  repriceStoreCartItems,
  repriceServiceCartItem,
  repriceDeliveryOnlyFromCoords,
} = require("../../shared/services/checkoutServerPricing");

describe("P0-04 checkout server pricing", () => {
  test("manipulated unit price is ignored — catalog 100 wins over client 1", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [
                {
                  id: "p1",
                  store_id: "s1",
                  price: 100,
                  offer_price: null,
                  active: true,
                  name: "منتج",
                  includes_delivery: false,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    };
    const out = await repriceStoreCartItems(sb, "s1", [
      { type: "store", price: 1, data: { store_id: "s1", product_id: "p1", qty: 1 } },
    ]);
    expect(out.ok).toBe(true);
    expect(out.goodsTotal).toBe(100);
    expect(out.pricedItems[0].price).toBe(100);
    expect(out.pricedItems[0].data.unit_price).toBe(100);
  });

  test("manipulated subtotal / qty still uses catalog * server qty", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [
                {
                  id: "p1",
                  store_id: "s1",
                  price: 50,
                  offer_price: null,
                  active: true,
                  name: "x",
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    };
    const out = await repriceStoreCartItems(sb, "s1", [
      { type: "store", price: 1, data: { store_id: "s1", product_id: "p1", qty: 2 } },
    ]);
    expect(out.goodsTotal).toBe(100);
  });

  test("client discount / offer is not trusted — offer_price from DB only", async () => {
    expect(effectiveCatalogUnitPrice({ price: 100, offer_price: 80 })).toBe(80);
    expect(effectiveCatalogUnitPrice({ price: 100, offer_price: 0 })).toBe(100);
    expect(effectiveCatalogUnitPrice({ price: 100, offer_price: 150 })).toBe(100);
  });

  test("client delivery_fee is ignored for map delivery", async () => {
    const out = await repriceDeliveryOnlyFromCoords({
      pickup_lat: 24.7,
      pickup_lng: 46.7,
      drop_lat: 24.8,
      drop_lng: 46.8,
      delivery_fee: 1,
      platform_fee: 0,
      driver_earning: 1,
      distance_km: 0.1,
      vehicle_type: "car",
    });
    expect(out.ok).toBe(true);
    expect(out.distance_km).toBe(10);
    expect(out.delivery_fee).toBe(23);
    expect(out.delivery_fee).not.toBe(1);
  });

  test("home service uses catalog not client price", () => {
    const out = repriceServiceCartItem({
      type: "plumber",
      price: 1,
      data: { district: "x" },
    });
    expect(out.ok).toBe(true);
    expect(out.total).toBe(60);
  });

  test("retries catalog select when includes_delivery column is missing", async () => {
    const sb = {
      from: () => ({
        select: (cols) => ({
          eq: () => ({
            in: async () => {
              if (String(cols).includes("includes_delivery")) {
                return { data: null, error: { message: "column store_products.includes_delivery does not exist" } };
              }
              return {
                data: [{ id: "p1", store_id: "s1", price: 3, offer_price: null, active: true, name: "بيبسي" }],
                error: null,
              };
            },
          }),
        }),
      }),
    };
    const out = await repriceStoreCartItems(sb, "s1", [
      { type: "store", price: 1, data: { store_id: "s1", product_id: "p1", qty: 1 } },
    ]);
    expect(out.ok).toBe(true);
    expect(out.goodsTotal).toBe(3);
    expect(out.includesDelivery).toBe(false);
  });
});
