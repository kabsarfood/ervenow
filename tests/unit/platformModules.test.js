const {
  MODULE_STATUSES,
  readPlatformModules,
  listPlatformModules,
  isPlatformModuleEnabled,
  isPlatformModuleBeta,
  updatePlatformModuleStatus,
} = require("../../shared/utils/platformModules");

describe("platformModules", () => {
  test("default modules include sprint modules", () => {
    const state = readPlatformModules();
    expect(state.modules.meshwar).toBeDefined();
    expect(state.modules.ervenow_pos).toBeDefined();
    expect(state.modules.loyalty).toBeDefined();
    expect(state.modules.qr_payments).toBeDefined();
  });

  test("MODULE_STATUSES has enabled disabled beta", () => {
    expect(MODULE_STATUSES).toEqual(["enabled", "disabled", "beta"]);
  });

  test("isPlatformModuleEnabled treats beta as enabled", () => {
    const original = readPlatformModules();
    updatePlatformModuleStatus("meshwar", "beta");
    expect(isPlatformModuleBeta("meshwar")).toBe(true);
    expect(isPlatformModuleEnabled("meshwar")).toBe(true);
    updatePlatformModuleStatus("meshwar", original.modules.meshwar.status);
  });

  test("listPlatformModules returns array", () => {
    const rows = listPlatformModules();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});
