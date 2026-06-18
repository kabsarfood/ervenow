#!/usr/bin/env node
/**
 * ERVENOW Core Validation — structural + unit test runner
 * Outputs: docs/core-validation-results.json
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "core-validation-results.json");

const PORTAL_CHECKS = {
  merchant: {
    live: () => {
      const pl = require(path.join(ROOT, "shared/utils/portalLaunch.js"));
      return pl.PORTAL_LIVE.merchant === true;
    },
    files: [
      "public/assets/merchant-preview.js",
      "public/merchant-preview.html",
      "apps/store/routes.js",
    ],
    sections: ["renderCategories", "renderWithdrawals", "renderNotifications", "renderOrders"],
    apis: ["merchant-categories", "/withdrawals", "merchant-dashboard", "order-board"],
    jest: "orderPortalRouting|notificationPortalRouting|notificationEvents|storeOrderWorkflow|storeMerchantLedgerCredit|ledgerWallet",
  },
  driver: {
    live: () => {
      const pl = require(path.join(ROOT, "shared/utils/portalLaunch.js"));
      return pl.PORTAL_LIVE.driver === true;
    },
    files: ["public/assets/driver-preview.js", "public/driver-preview.html", "apps/driver/routes.js"],
    sections: ["renderEarnings", "renderNotifications", "renderWallet"],
    apis: ['router.get("/orders"', 'router.get("/wallet"', 'router.get("/earnings"'],
    jest: "driverStoreHandoff|driverLedgerCredit|ledgerWallet|resolvePortalRole",
  },
  service: {
    live: () => {
      const pl = require(path.join(ROOT, "shared/utils/portalLaunch.js"));
      return pl.PORTAL_LIVE.service === true;
    },
    files: ["public/assets/service-preview.js", "public/service-preview.html", "apps/services/routes.js"],
    sections: ["renderSchedule", "renderDashboard", "renderRequests"],
    apis: ["/me/dashboard", "/me/schedule"],
    jest: "orderPortalRouting|notificationPortalRouting|resolvePortalRole",
  },
  transport: {
    live: () => {
      const pl = require(path.join(ROOT, "shared/utils/portalLaunch.js"));
      return pl.PORTAL_LIVE.transport === true;
    },
    files: ["public/assets/transport-preview.js", "public/transport-preview.html", "apps/services/routes.js"],
    sections: ["renderFleet", "renderPricing", "renderTransportOrders"],
    apis: ["/me/fleet", "/me/pricing"],
    jest: "orderPortalRouting|resolvePortalRole",
  },
};

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function runJest(pattern) {
  try {
    const out = execSync(`npm test -- --testPathPattern="${pattern}" --silent`, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const m = out.match(/Tests:\s+(\d+) passed/);
    return { ok: true, passed: m ? Number(m[1]) : 0, output: out.slice(-400) };
  } catch (e) {
    return { ok: false, passed: 0, output: String(e.stdout || e.message).slice(-600) };
  }
}

function validatePortal(name, cfg) {
  const result = { portal: name, checks: [], pass: true };

  result.checks.push({
    id: "live",
    ok: cfg.live(),
    note: "portalLaunch live flag",
  });

  for (const f of cfg.files) {
    const ok = fs.existsSync(path.join(ROOT, f));
    result.checks.push({ id: `file:${f}`, ok, note: ok ? "exists" : "missing" });
  }

  const mainJs = cfg.files.find((f) => f.endsWith("-preview.js"));
  if (mainJs) {
    const src = readFile(mainJs);
    for (const sec of cfg.sections) {
      const ok = src.includes(`function ${sec}`) || src.includes(`${sec}()`);
      result.checks.push({ id: `section:${sec}`, ok, note: ok ? "implemented" : "missing" });
    }
  }

  const apiFile = cfg.files.find((f) => f.includes("routes.js"));
  if (apiFile) {
    const src = readFile(apiFile);
    for (const api of cfg.apis) {
      const ok = src.includes(api);
      result.checks.push({ id: `api:${api}`, ok, note: ok ? "routed" : "not found" });
    }
  }

  const jest = runJest(cfg.jest);
  result.checks.push({
    id: "unit_tests",
    ok: jest.ok,
    note: jest.ok ? `${jest.passed} tests passed` : "unit tests failed",
  });

  result.pass = result.checks.every((c) => c.ok);
  return result;
}

function main() {
  const portals = Object.entries(PORTAL_CHECKS).map(([name, cfg]) => validatePortal(name, cfg));
  const allPass = portals.every((p) => p.pass);

  const payload = {
    generated_at: new Date().toISOString(),
    ervenow_core_1_0_ready: allPass,
    portals: portals.reduce((acc, p) => {
      acc[p.portal] = { result: p.pass ? "PASS" : "FAIL", checks: p.checks };
      return acc;
    }, {}),
    summary: portals.map((p) => ({ portal: p.portal, result: p.pass ? "PASS" : "FAIL" })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");

  console.log("ERVENOW Core Validation — structural");
  for (const row of payload.summary) {
    console.log(`  ${row.portal}: ${row.result}`);
  }
  console.log(`\nResults: ${OUT}`);
  console.log(`Core 1.0 ready (structural): ${allPass ? "YES" : "NO"}`);
  process.exit(allPass ? 0 : 1);
}

main();
