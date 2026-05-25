const {
  normalizeMode,
  isFeatureEnabled,
  isFeatureAuto,
  loadFinancialFeatureFlags,
  listFinancialFeatureFlagsArray,
  toFeatureFlagsArray,
  updateFinancialFeatureFlag,
  getFeatureFlags,
  FINANCIAL_FEATURE_KEYS,
} = require("../../shared/utils/platformFeatureFlags");

describe("platformFeatureFlags", () => {
  test("normalizeMode accepts 0, 1, 2 only", () => {
    expect(normalizeMode(0)).toBe(0);
    expect(normalizeMode(1)).toBe(1);
    expect(normalizeMode(2)).toBe(2);
    expect(normalizeMode(99)).toBe(0);
    expect(normalizeMode("2")).toBe(2);
  });

  test("isFeatureEnabled and isFeatureAuto", () => {
    expect(isFeatureEnabled(0)).toBe(false);
    expect(isFeatureEnabled(1)).toBe(true);
    expect(isFeatureEnabled(2)).toBe(true);
    expect(isFeatureAuto(2)).toBe(true);
    expect(isFeatureAuto(1)).toBe(false);
  });

  test("loadFinancialFeatureFlags returns defaults when table empty", async () => {
    const sb = {
      from: jest.fn(() => ({
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      })),
    };
    const payload = await loadFinancialFeatureFlags(sb);
    expect(payload.ok).toBe(true);
    expect(payload.flags.withdraw_system).toBe(1);
    expect(payload.features).toHaveLength(FINANCIAL_FEATURE_KEYS.length);
  });

  test("toFeatureFlagsArray returns API shape", () => {
    const list = toFeatureFlagsArray({ auto_freeze: 0, auto_payout: 1 });
    expect(list).toEqual(
      expect.arrayContaining([
        { key: "auto_freeze", mode: 0, config: { warn_threshold: 50, freeze_threshold: 100 } },
        { key: "auto_payout", mode: 1 },
      ])
    );
    expect(list).toHaveLength(FINANCIAL_FEATURE_KEYS.length);
  });

  test("listFinancialFeatureFlagsArray returns list", async () => {
    const sb = {
      from: jest.fn(() => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [{ key: "auto_freeze", mode: 2, config: { warn_threshold: 50, freeze_threshold: 100 } }],
              error: null,
            }),
        }),
      })),
    };
    const result = await listFinancialFeatureFlagsArray(sb);
    expect(result.ok).toBe(true);
    expect(result.list.find((x) => x.key === "auto_freeze").mode).toBe(2);
    expect(result.list.find((x) => x.key === "auto_freeze").config.freeze_threshold).toBe(100);
  });

  test("getFeatureFlags returns modes and configs", async () => {
    const sb = {
      from: jest.fn(() => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [{ key: "auto_freeze", mode: 2, config: { warn_threshold: 50, freeze_threshold: 100 } }],
              error: null,
            }),
        }),
      })),
    };
    const features = await getFeatureFlags(sb);
    expect(features.auto_freeze).toBe(2);
    expect(features.configs.auto_freeze.freeze_threshold).toBe(100);
  });

  test("updateFinancialFeatureFlag upserts row", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const sb = {
      from: jest.fn(() => ({
        upsert: () => ({
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { key: "financial_alerts", mode: 0, updated_at: "2026-01-01" },
                error: null,
              }),
          }),
        }),
      })),
    };
    const result = await updateFinancialFeatureFlag(sb, "financial_alerts", 0);
    expect(result.ok).toBe(true);
    expect(result.feature.mode).toBe(0);
    expect(result.feature.enabled).toBe(false);
    expect(logSpy).toHaveBeenCalledWith("[feature updated]", "financial_alerts", 0);
    logSpy.mockRestore();
  });
});
