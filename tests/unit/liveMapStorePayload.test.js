const { liveMapStorePayload } = require("../../shared/utils/liveMapStorePayload");
const { parseLiveMapBounds, storeRowIsListedActive } = require("../../shared/utils/liveMapStoresQuery");
const fs = require("fs");
const path = require("path");

describe("liveMapStorePayload admin points", () => {
  test("pending store with lat/lng becomes a map payload", () => {
    const p = liveMapStorePayload({
      id: "s1",
      name: "متجر تجريبي",
      type: "store",
      status: "pending",
      is_active: false,
      lat: 24.7136,
      lng: 46.6753,
      maps_url: "https://www.google.com/maps?q=24.7136,46.6753",
    });
    expect(p).not.toBeNull();
    expect(p.lat).toBeCloseTo(24.7136, 4);
    expect(p.lng).toBeCloseTo(46.6753, 4);
    expect(p.status).toBe("pending");
    expect(p.listed).toBe(false);
    expect(p.status_label).toBe("قيد المراجعة");
  });

  test("row without coords is skipped", () => {
    expect(liveMapStorePayload({ id: "s2", name: "بدون موقع", status: "approved" })).toBeNull();
  });

  test("approved closed store still has coords payload", () => {
    const p = liveMapStorePayload({
      id: "s3",
      name: "مغلق",
      type: "restaurant",
      status: "approved",
      is_active: false,
      lat: 21.48,
      lng: 39.19,
    });
    expect(p.listed).toBe(false);
    expect(p.status_label).toBe("معتمد · مغلق");
  });

  test("storeRowIsListedActive excludes pending", () => {
    expect(storeRowIsListedActive({ status: "pending", is_active: false, lat: 1, lng: 2 })).toBe(false);
    expect(storeRowIsListedActive({ status: "approved", is_active: true })).toBe(true);
  });

  test("parseLiveMapBounds requires four numbers", () => {
    expect(parseLiveMapBounds({}).hasBounds).toBe(false);
    const b = parseLiveMapBounds({ north: 25, south: 24, east: 47, west: 46 });
    expect(b.hasBounds).toBe(true);
    expect(b.minLat).toBe(24);
    expect(b.maxLng).toBe(47);
  });

  test("admin route and map client include pending stores", () => {
    const admin = fs.readFileSync(path.join(__dirname, "../../apps/admin/routes.js"), "utf8");
    expect(admin).toMatch(/router\.get\("\/live-map\/stores"/);
    expect(admin).toMatch(/listedOnly:\s*false/);
    const js = fs.readFileSync(path.join(__dirname, "../../public/assets/live-store-map.js"), "utf8");
    expect(js).toMatch(/\/api\/admin\/live-map\/stores/);
    expect(js).toMatch(/runtime\.adminMode \? "" : boundsQuery\(\)/);
    expect(js).toMatch(/!runtime\.adminMode && typeof L\.markerClusterGroup/);
  });
});
