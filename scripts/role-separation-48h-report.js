#!/usr/bin/env node
/**
 * تقرير 48 ساعة — Role Separation Soft Launch
 * الاستخدام: node scripts/role-separation-48h-report.js [--hours=48]
 */
const { buildSoftLaunchReport } = require("../shared/services/roleSeparationReport");

function pad(s, n) {
  return String(s).padEnd(n, " ");
}

async function main() {
  const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
  const hours = hoursArg ? Number(hoursArg.split("=")[1]) : 48;
  const r = await buildSoftLaunchReport({ hours });

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  ERVENOW — Role Separation Soft Launch Report");
  console.log("══════════════════════════════════════════════════════\n");
  console.log("Generated:", r.generated_at);
  console.log("Period:   ", r.period_hours, "hours (since", r.period_since + ")");
  console.log("Soft Launch:", r.soft_launch.enabled ? "ACTIVE" : "OFF", "| started:", r.soft_launch.started_at || "—");
  console.log("Hours since start:", r.soft_launch.hours_since_start);

  console.log("\n── Portal Usage ──────────────────────────────────────\n");
  Object.entries(r.portal_usage).forEach(([key, row]) => {
    console.log(
      pad(row.label || key, 22),
      "| visits:", pad(row.visits, 5),
      "| users:", pad(row.unique_users, 4),
      "| last:", row.last_at || "—"
    );
  });

  console.log("\n── Redirect Statistics ───────────────────────────────\n");
  const rs = r.redirect_statistics;
  console.log("Total redirects:  ", rs.total);
  console.log("Successful:       ", rs.success);
  console.log("Failed:           ", rs.failed);
  console.log("Success rate:     ", rs.success_rate + "%");
  console.log("Unknown roles:    ", (r.redirect_errors.unknown_role && r.redirect_errors.unknown_role.count) || 0);

  if (rs.by_portal && Object.keys(rs.by_portal).length) {
    console.log("\nBy portal:");
    Object.entries(rs.by_portal).forEach(([p, row]) => {
      console.log("  ", pad(p, 12), "ok:", row.success, " fail:", row.failed);
    });
  }

  console.log("\n── Legacy Usage ──────────────────────────────────────\n");
  Object.entries(r.legacy_usage).forEach(([key, row]) => {
    console.log(
      pad(row.label || key, 28),
      "| visits:", pad(row.visits, 5),
      "| users:", row.unique_users
    );
  });

  console.log("\n── Recommendations ───────────────────────────────────\n");
  (r.recommendations || []).forEach((rec, i) => {
    console.log(" " + (i + 1) + ". [" + rec.level.toUpperCase() + "] " + rec.text);
  });

  console.log("\nContinue Soft Launch?", r.continue_soft_launch ? "YES ✓" : "REVIEW NEEDED");
  console.log("\n══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
