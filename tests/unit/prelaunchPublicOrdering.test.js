const {
  isPublicOrderingEnabled,
  getPublicOrderingState,
  writePublicOrderingFile,
  isInternalOrderingAllowed,
  SERVICE_NOT_LAUNCHED,
} = require("../../shared/utils/publicOrdering");
const { denyUnlessPublicOrdering } = require("../../shared/middleware/publicOrderingGate");
const { capRatio, launchBand } = require("../../shared/services/launchReadiness");
const { getLaunchTargets, LAUNCH_WEIGHTS } = require("../../shared/config/launchTargets");

describe("public ordering kill switch", () => {
  const prev = process.env.PUBLIC_ORDERING_ENABLED;

  afterEach(() => {
    process.env.PUBLIC_ORDERING_ENABLED = prev || "true";
  });

  test("defaults auto_launch false", () => {
    expect(getPublicOrderingState().auto_launch).toBe(false);
  });

  test("env false is kill switch", () => {
    process.env.PUBLIC_ORDERING_ENABLED = "false";
    expect(isPublicOrderingEnabled()).toBe(false);
  });

  test("env true enables", () => {
    process.env.PUBLIC_ORDERING_ENABLED = "true";
    expect(isPublicOrderingEnabled()).toBe(true);
  });

  test("customer cannot pass gate", () => {
    process.env.PUBLIC_ORDERING_ENABLED = "false";
    const req = { appUser: { id: "c1", role: "customer" } };
    const res = {
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    let nextCalled = false;
    denyUnlessPublicOrdering(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.code).toBe(403);
    expect(res.body.reason).toBe(SERVICE_NOT_LAUNCHED);
  });

  test("admin internal flow allowed when ordering off", () => {
    process.env.PUBLIC_ORDERING_ENABLED = "false";
    const req = { appUser: { id: "a1", role: "admin" } };
    expect(isInternalOrderingAllowed(req)).toBe(true);
    let nextCalled = false;
    denyUnlessPublicOrdering(req, { status() { return this; }, json() {} }, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});

describe("launch readiness math", () => {
  test("caps at 100% of target", () => {
    expect(capRatio(400, 200)).toBe(1);
    expect(capRatio(100, 200)).toBe(0.5);
    expect(capRatio(0, 200)).toBe(0);
  });

  test("bands", () => {
    expect(launchBand(12)).toBe("NOT_READY");
    expect(launchBand(60)).toBe("BUILDING_SUPPLY");
    expect(launchBand(80)).toBe("READY_FOR_LIMITED_LAUNCH");
    expect(launchBand(100)).toBe("TARGET_ACHIEVED");
  });

  test("weights sum to 1", () => {
    const s = Object.values(LAUNCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 8);
  });

  test("customer target is 200", () => {
    expect(getLaunchTargets().customers_verified).toBe(200);
  });
});

describe("prelaunch security source contracts", () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "../..");

  test("public-ordering POST is admin-only", () => {
    const src = fs.readFileSync(path.join(root, "apps/admin/routes.js"), "utf8");
    expect(src).toMatch(
      /router\.post\(\s*["']\/public-ordering["']\s*,\s*requireAuth\s*,\s*requireRole\(\s*["']admin["']\s*\)/
    );
  });

  test("legacy food and finance order creates are gated", () => {
    const food = fs.readFileSync(path.join(root, "apps/food/routes.js"), "utf8");
    const finance = fs.readFileSync(path.join(root, "apps/finance/routes.js"), "utf8");
    expect(food).toMatch(/router\.post\(\s*["']\/orders["']\s*,\s*requireAuth\s*,\s*denyUnlessPublicOrdering/);
    expect(finance).toMatch(/router\.post\(\s*["']\/orders["']\s*,\s*requireAuth\s*,\s*denyUnlessPublicOrdering/);
  });

  test("driver self-register stays pending, not ready", () => {
    const drv = fs.readFileSync(path.join(root, "apps/driver/routes.js"), "utf8");
    const core = fs.readFileSync(path.join(root, "apps/core/routes.js"), "utf8");
    expect(drv).toMatch(/status:\s*["']pending["']/);
    expect(drv).toMatch(/active:\s*false/);
    expect(core).toMatch(/status:\s*["']pending["']/);
    expect(drv).not.toMatch(/router\.(post|patch|put)\([^)]*status[^)]*approved/);
  });

  test("generic settings cannot hold launch keys", () => {
    const src = fs.readFileSync(path.join(root, "apps/admin/settings.js"), "utf8");
    expect(src).toMatch(/public_ordering_enabled/);
    expect(src).toMatch(/launch_targets/);
  });
});
