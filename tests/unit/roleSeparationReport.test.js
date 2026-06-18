const { buildSoftLaunchReport, buildRecommendations } = require("../../shared/services/roleSeparationReport");

describe("roleSeparationReport", () => {
  test("builds soft launch report structure", async () => {
    const r = await buildSoftLaunchReport({ hours: 48 });
    expect(r.soft_launch).toBeDefined();
    expect(r.portal_usage.transport).toBeDefined();
    expect(r.portal_usage.merchant).toBeDefined();
    expect(r.portal_usage.customer).toBeUndefined();
    expect(r.redirect_statistics).toMatchObject({
      total: expect.any(Number),
      success: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(r.legacy_usage["store-dashboard"]).toBeDefined();
    expect(Array.isArray(r.recommendations)).toBe(true);
    expect(typeof r.continue_soft_launch).toBe("boolean");
  });

  test("recommendations include continue guidance when healthy", () => {
    const recs = buildRecommendations({
      soft_launch: { enabled: true },
      redirect_statistics: { total: 20, success: 20, failed: 0, success_rate: 100 },
      redirect_errors: { unknown_role: { count: 0 } },
      portal_usage: { transport: { visits: 10 }, merchant: { visits: 3 } },
      legacy_usage: { "store-dashboard": { visits: 2 } },
    });
    expect(recs.some((r) => r.level === "success")).toBe(true);
  });
});
