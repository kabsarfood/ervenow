const {
  BANNER_WIDTH,
  BANNER_HEIGHT,
  BANNER_ASPECT_RATIO,
  BANNER_OBJECT_FIT,
  BANNER_SPEC,
} = require("../../shared/utils/bannerSpec");

describe("bannerSpec", () => {
  test("official unified banner dimensions", () => {
    expect(BANNER_WIDTH).toBe(1920);
    expect(BANNER_HEIGHT).toBe(730);
    expect(BANNER_ASPECT_RATIO).toBe("1920 / 730");
    expect(BANNER_OBJECT_FIT).toBe("cover");
  });

  test("BANNER_SPEC exposes admin and CSS metadata", () => {
    expect(BANNER_SPEC.width).toBe(1920);
    expect(BANNER_SPEC.height).toBe(730);
    expect(BANNER_SPEC.object_fit).toBe("cover");
    expect(BANNER_SPEC.css_vars["--erv-banner-aspect"]).toBe("1920 / 730");
    expect(BANNER_SPEC.admin_hint_ar).toMatch(/1920×730/);
  });
});
