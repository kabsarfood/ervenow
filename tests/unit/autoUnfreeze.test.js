const { canAutoUnfreeze } = require("../../shared/services/autoUnfreeze");
const { MODE_AUTO } = require("../../shared/utils/platformFeatureFlags");

describe("autoUnfreeze", () => {
  const cfg = { warn_threshold: 50, freeze_threshold: 100 };

  test("unfrozen when owed below freeze threshold", () => {
    const r = canAutoUnfreeze(80, cfg, MODE_AUTO);
    expect(r.phase).toBe("warn");
    expect(r.unfrozen).toBe(true);
    expect(r.meets_threshold).toBe(true);
  });

  test("still frozen when owed above freeze threshold", () => {
    const r = canAutoUnfreeze(150, cfg, MODE_AUTO);
    expect(r.phase).toBe("block");
    expect(r.unfrozen).toBe(false);
  });

  test("unfrozen after full payment level", () => {
    const r = canAutoUnfreeze(50, cfg, MODE_AUTO);
    expect(r.phase).toBe("none");
    expect(r.unfrozen).toBe(true);
  });
});
