jest.mock("../../shared/utils/platformFeatureFlags", () => {
  const actual = jest.requireActual("../../shared/utils/platformFeatureFlags");
  return {
    ...actual,
    getFeatureFlags: jest.fn(async () => ({
      auto_freeze: actual.MODE_AUTO,
      configs: { auto_freeze: { warn_threshold: 50, freeze_threshold: 100 } },
    })),
  };
});

const {
  evaluateAutoFreezeBalance,
  toAutoFreezeBalance,
  parseAutoFreezeConfig,
  getDriverFreezeFlags,
  applyAutoFreezeGate,
  AUTO_FREEZE_BLOCK_MESSAGE,
} = require("../../shared/services/autoFreeze");
const { MODE_OFF, MODE_AUTO, MODE_ON } = require("../../shared/utils/platformFeatureFlags");

describe("autoFreeze", () => {
  test("toAutoFreezeBalance maps positive debt to negative", () => {
    expect(toAutoFreezeBalance(80)).toBe(-80);
    expect(toAutoFreezeBalance(-50)).toBe(-50);
  });

  test("AUTO: warn then block thresholds", () => {
    const cfg = { warn_threshold: 50, freeze_threshold: 100 };
    expect(evaluateAutoFreezeBalance(-40, cfg, MODE_AUTO).phase).toBe("none");
    expect(evaluateAutoFreezeBalance(-60, cfg, MODE_AUTO).phase).toBe("warn");
    expect(evaluateAutoFreezeBalance(-120, cfg, MODE_AUTO).phase).toBe("block");
  });

  test("OFF uses legacy path only in assert (phase none)", () => {
    expect(evaluateAutoFreezeBalance(-200, { warn_threshold: 50, freeze_threshold: 100 }, MODE_OFF).phase).toBe(
      "none"
    );
  });

  test("ON mode does not apply phased freeze (AUTO only)", () => {
    const cfg = { warn_threshold: 50, freeze_threshold: 100 };
    expect(evaluateAutoFreezeBalance(-60, cfg, MODE_ON).phase).toBe("none");
    expect(evaluateAutoFreezeBalance(-120, cfg, MODE_ON).phase).toBe("none");
  });

  test("getDriverFreezeFlags — warn at 60, block at 120 when AUTO", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const flags = await getDriverFreezeFlags(null, "driver-1", 60);
    expect(flags.warning).toBe(true);
    expect(flags.is_frozen).toBe(false);
    expect(logSpy).toHaveBeenCalledWith("[auto_freeze] warning:", "driver-1");

    const blocked = await getDriverFreezeFlags(null, "driver-2", 120);
    expect(blocked.is_frozen).toBe(true);
    expect(blocked.warning).toBe(false);
    expect(logSpy).toHaveBeenCalledWith("[auto_freeze] blocked:", "driver-2");

    logSpy.mockRestore();
  });

  test("applyAutoFreezeGate returns block message", async () => {
    const gate = await applyAutoFreezeGate(null, "d1", 150);
    expect(gate.blocked).toBe(true);
    expect(gate.message).toBe(AUTO_FREEZE_BLOCK_MESSAGE);
  });
});
