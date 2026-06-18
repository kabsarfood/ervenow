#!/usr/bin/env node
/**
 * يولّد docs/NOTIFICATION-AUDIT-REPORT.md من كتالوج notificationEvents
 */
const fs = require("fs");
const path = require("path");
const { getNotificationAuditReport } = require("../shared/services/notificationEvents");

const outPath = path.join(__dirname, "..", "docs", "NOTIFICATION-AUDIT-REPORT.md");
const rows = getNotificationAuditReport();
const generatedAt = new Date().toISOString();

const header = `# ERVENOW — Notification Audit Report

> Generated: ${generatedAt}
> Source: \`shared/services/notificationEvents.js\` → \`NOTIFICATION_EVENT_CATALOG\`
> Engine: \`createRoutedNotification\` via Notification Routing (Flow Separation 3.0)

جميع الإشعارات التشغيلية تمر عبر \`target_portal\` + \`target_role\` + \`event\` في الـ payload.

| Event | Portal | Recipient | Route |
| ----- | ------ | --------- | ----- |
`;

const body = rows
  .map((r) => `| \`${r.Event}\` | ${r.Portal} | ${r.Recipient} | ${r.Route} |`)
  .join("\n");

const footer = `

## Portal coverage

| Portal | Events |
| ------ | ------ |
| merchant | ${rows.filter((r) => r.Portal === "merchant").length} |
| driver | ${rows.filter((r) => r.Portal === "driver").length} |
| service | ${rows.filter((r) => r.Portal === "service").length} |
| transport | ${rows.filter((r) => r.Portal === "transport").length} |
| customer | ${rows.filter((r) => r.Portal === "customer").length} |
| cross-portal | ${rows.filter((r) => r.Portal === "*").length} |

## Verification

\`\`\`bash
npm test -- --testPathPattern="notificationEvents|notificationPortalRouting"
node scripts/generate-notification-audit-report.js
\`\`\`
`;

const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(outPath, header + body + footer, "utf8");
console.log(`Wrote ${rows.length} events → ${outPath}`);
