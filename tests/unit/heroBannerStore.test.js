const {
  isBannerPublishable,
  normalizeBannerRow,
  normalizePlacement,
  getActiveBannersByPlacement,
  getPublishedBannersForTarget,
  sortBannersForDisplay,
  computeCtr,
  getAdminSelectableTargets,
  DEFAULT_PLACEMENT,
} = require("../../shared/utils/heroBannerStore");

function mockSb(rows) {
  const chain = {
    select: function () {
      return chain;
    },
    order: function () {
      return chain;
    },
    neq: function () {
      return chain;
    },
    eq: function () {
      return chain;
    },
    then: function (resolve, reject) {
      try {
        resolve({ data: rows, error: null });
      } catch (e) {
        if (reject) reject(e);
      }
    },
  };
  return {
    from: function () {
      return chain;
    },
  };
}

describe("heroBannerStore", function () {
  test("normalizeBannerRow trims and normalizes urls", function () {
    const row = normalizeBannerRow({
      id: "a",
      title: "  عنوان  ",
      description: "وصف",
      button1_url: "start-now",
      sort_order: "3",
      is_active: true,
      banner_targets: ["visitor_dashboard"],
    });
    expect(row.title).toBe("عنوان");
    expect(row.button1_url).toBe("/start-now");
    expect(row.sort_order).toBe(3);
    expect(row.banner_targets).toEqual(["visitor_dashboard"]);
    expect(row.placement).toBe("guest_dashboard");
  });

  test("normalizePlacement maps legacy kind and accepts placement ids", function () {
    expect(normalizePlacement("home_hero")).toBe("home_hero");
    expect(normalizePlacement("guest_dashboard")).toBe("guest_dashboard");
    expect(normalizePlacement(null, "platform")).toBe("guest_dashboard");
    expect(normalizePlacement(null, "promo")).toBe("home_promo");
    expect(normalizePlacement("", "")).toBe(DEFAULT_PLACEMENT);
  });

  test("normalizeBannerRow derives targets from legacy placement", function () {
    const row = normalizeBannerRow({
      id: "b",
      title: "T",
      placement: "home_promo",
      banner_kind: "promo",
      is_active: true,
    });
    expect(row.banner_targets).toEqual(["home"]);
    expect(row.display_mode).toBe("carousel");
  });

  test("isBannerPublishable respects status and schedule", function () {
    const now = new Date("2026-06-05T12:00:00Z");
    expect(
      isBannerPublishable(
        { status: "active", starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-10T00:00:00Z" },
        now
      )
    ).toBe(true);
    expect(isBannerPublishable({ status: "paused" }, now)).toBe(false);
    expect(
      isBannerPublishable(
        { status: "scheduled", starts_at: "2026-06-20T00:00:00Z" },
        now
      )
    ).toBe(false);
  });

  test("sortBannersForDisplay orders by priority then sort_order", function () {
    const sorted = sortBannersForDisplay([
      { priority: 20, sort_order: 0, created_at: "2026-01-02" },
      { priority: 5, sort_order: 2, created_at: "2026-01-01" },
      { priority: 5, sort_order: 1, created_at: "2026-01-03" },
    ]);
    expect(sorted.map(function (b) {
      return b.priority + ":" + b.sort_order;
    })).toEqual(["5:1", "5:2", "20:0"]);
  });

  test("computeCtr returns percentage rounded", function () {
    expect(computeCtr(100, 5)).toBe(5);
    expect(computeCtr(0, 5)).toBe(0);
  });

  test("getActiveBannersByPlacement groups rows by display mode", async function () {
    const rows = [
      {
        id: "1",
        title: "Promo",
        placement: "home_promo",
        banner_kind: "promo",
        banner_targets: ["home"],
        display_mode: "carousel",
        status: "active",
        is_active: true,
        sort_order: 0,
        priority: 1,
      },
      {
        id: "2",
        title: "Dash",
        placement: "guest_dashboard",
        banner_kind: "platform",
        banner_targets: ["visitor_dashboard"],
        display_mode: "card",
        status: "active",
        is_active: true,
        sort_order: 0,
        priority: 1,
      },
      {
        id: "3",
        title: "Hero",
        placement: "home_hero",
        banner_kind: "platform",
        banner_targets: ["home"],
        display_mode: "card",
        status: "active",
        is_active: true,
        sort_order: 0,
        priority: 2,
      },
    ];
    const grouped = await getActiveBannersByPlacement(mockSb(rows));
    expect(grouped.home_promo.map(function (b) {
      return b.id;
    })).toEqual(["1"]);
    expect(grouped.guest_dashboard.map(function (b) {
      return b.id;
    })).toEqual(["2"]);
    expect(grouped.home_hero.map(function (b) {
      return b.id;
    })).toEqual(["3"]);
  });

  test("getPublishedBannersForTarget filters by target and publishability", async function () {
    const rows = [
      {
        id: "1",
        title: "Home",
        banner_targets: ["home"],
        display_mode: "carousel",
        status: "active",
        is_active: true,
        sort_order: 0,
        priority: 1,
      },
      {
        id: "2",
        title: "Wallet",
        banner_targets: ["wallet_page"],
        display_mode: "card",
        status: "active",
        is_active: true,
        sort_order: 0,
        priority: 1,
      },
    ];
    const home = await getPublishedBannersForTarget(mockSb(rows), "home");
    expect(home.map(function (b) {
      return b.id;
    })).toEqual(["1"]);
  });

  test("getAdminSelectableTargets returns six admin placements in order", function () {
    const opts = getAdminSelectableTargets();
    expect(opts.map(function (o) {
      return o.id;
    })).toEqual(["home", "visitor_dashboard", "services", "stores", "restaurants", "delivery"]);
    expect(opts[0].label_ar).toBe("الرئيسية");
    expect(opts[1].label_ar).toBe("لوحة زائر المنصة");
    expect(opts.some(function (o) {
      return o.id === "pharmacy_dashboard";
    })).toBe(false);
  });
});
