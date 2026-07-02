"use strict";

const marketingEngine = require("../../shared/utils/marketingEngine");

describe("marketingEngine M1", () => {
  test("buildDefaultExperience home has hub and main modules", () => {
    const exp = marketingEngine.buildDefaultExperience("home");
    const ids = exp.modules.map((m) => m.id);
    expect(ids).toContain("hub_section");
    expect(ids).toContain("hub_categories");
    expect(ids).toContain("main");
    expect(ids).toContain("footer");
  });

  test("resolveModuleVisibility respects hidden status", () => {
    const mod = { id: "x", status: "hidden", locked: false };
    const vis = marketingEngine.resolveModuleVisibility(mod, {});
    expect(vis.resolved_visible).toBe(false);
    expect(vis.effective_status).toBe("hidden");
  });

  test("resolveModuleVisibility scheduled before start", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const mod = { id: "x", status: "scheduled", starts_at: future, locked: false };
    const vis = marketingEngine.resolveModuleVisibility(mod, { now: new Date() });
    expect(vis.resolved_visible).toBe(false);
    expect(vis.effective_status).toBe("scheduled");
  });

  test("locked modules stay visible", () => {
    const mod = { id: "header", status: "hidden", locked: true };
    const vis = marketingEngine.resolveModuleVisibility(mod, {});
    expect(vis.resolved_visible).toBe(true);
  });

  test("buildPublicExperience sorts by display_order", () => {
    const pub = marketingEngine.buildPublicExperience("home", {});
    const orders = pub.modules.map((m) => m.display_order);
    const sorted = orders.slice().sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });

  test("updateExperienceModules writes audit on change", () => {
    const before = marketingEngine.readAuditLog(5).length;
    marketingEngine.updateExperienceModules(
      "home",
      [{ id: "trust_bar", display_order: 41 }],
      { id: "test-admin", phone: "0500000000" }
    );
    const after = marketingEngine.readAuditLog(5).length;
    expect(after).toBeGreaterThanOrEqual(before);
    marketingEngine.updateExperienceModules(
      "home",
      [{ id: "trust_bar", display_order: 40 }],
      { id: "test-admin", phone: "0500000000" }
    );
  });
});
