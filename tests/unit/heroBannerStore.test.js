const {
  isWithinSchedule,
  normalizeBannerRow,
} = require("../../shared/utils/heroBannerStore");

describe("heroBannerStore", function () {
  test("normalizeBannerRow trims and normalizes urls", function () {
    const row = normalizeBannerRow({
      id: "a",
      title: "  عنوان  ",
      description: "وصف",
      button1_url: "start-now",
      sort_order: "3",
      is_active: true,
    });
    expect(row.title).toBe("عنوان");
    expect(row.button1_url).toBe("/start-now");
    expect(row.sort_order).toBe(3);
  });

  test("isWithinSchedule respects active flag and dates", function () {
    const now = new Date("2026-06-05T12:00:00Z");
    expect(
      isWithinSchedule(
        { is_active: true, starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-10T00:00:00Z" },
        now
      )
    ).toBe(true);
    expect(
      isWithinSchedule(
        { is_active: false, starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-06-10T00:00:00Z" },
        now
      )
    ).toBe(false);
    expect(
      isWithinSchedule(
        { is_active: true, starts_at: "2026-06-10T00:00:00Z", ends_at: null },
        now
      )
    ).toBe(false);
    expect(
      isWithinSchedule(
        { is_active: true, starts_at: null, ends_at: "2026-06-01T00:00:00Z" },
        now
      )
    ).toBe(false);
  });
});
