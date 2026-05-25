/**
 * Split public/admin-dashboard.html → public/admin/* (refactor only).
 */
import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "public");
const srcHtml = path.join(root, "admin-dashboard.html");
const outDir = path.join(root, "admin");
const modDir = path.join(outDir, "modules");

const lines = fs.readFileSync(srcHtml, "utf8").split(/\r?\n/);

const styleStart = lines.findIndex((l) => l.trim() === "<style>") + 1;
const styleEnd = lines.findIndex((l) => l.trim() === "</style>");
const css = lines
  .slice(styleStart, styleEnd)
  .map((l) => l.replace(/^      /, ""))
  .join("\n");

const scriptOpen = lines.findIndex((l) => l.trim() === "<script>" || (l.includes("<script>") && l.includes("__ERVENOW")));
const scriptClose = lines.findIndex((l, i) => i > scriptOpen && l.trim() === "</script>");
const jsRaw = lines
  .slice(scriptOpen + 1, scriptClose)
  .map((l) => (l.startsWith("      ") ? l.slice(6) : l))
  .join("\n");

const STATE_VARS = [
  "ADMIN_DEFAULT_PERMISSIONS",
  "adminPermissions",
  "adminLevel",
  "FULL_ADMIN_IDLE_MS",
  "fullAdminIdleTimer",
  "lastAdminActivityAt",
  "fullAdminForcedLogout",
  "cacheOrders",
  "adminSocket",
  "adminSocketFallbackTimer",
  "adminLiveStatsDebounceTimer",
  "adminDriverSilentRefreshTimer",
  "STATS_POLL_MS",
  "LEDGER_TX_POLL_MS",
  "activePanelId",
  "ledgerFinanceSummary",
  "financialFeatureModes",
  "liveProfit",
  "liveMap",
  "liveMapMarkersLayer",
  "liveMapDriverMarkers",
  "liveMapOrderMarkers",
  "adminAlertsTimer",
  "PENDING_SLA_WARNING_MS",
  "PENDING_SLA_CRITICAL_MS",
  "PENDING_SLA_FAILURE_MS",
  "execModalOrder",
  "execModalMode",
  "execSuggestedDriver",
  "ORDER_MAP_COLORS",
  "cacheNotifications",
  "cacheDrivers",
  "cacheComplaints",
  "cacheCustomers",
  "cacheStores",
  "cacheJobs",
  "cacheAdminAccounts",
  "cacheFinanceDrivers",
  "financeDebtLimit",
  "financeLoadBusy",
  "financeDrawerDriverId",
  "financeDrawerLedgerCache",
  "financeAlertThreshold",
  "financeCollectAllBusy",
  "financeLastDailyReport",
  "financeBulkPending",
  "siteMaintenanceEnabled",
  "FINANCE_FEATURE_DESCS",
  "financialFeatureConfigs",
  "FINANCE_FEATURE_LABELS",
  "liveTickBusy",
];

const FN_TO_MOD = {
  ensureAdminAccess: "settings",
  applyAdminPermissionsFallback: "settings",
  loadAdminProfile: "settings",
  updateSiteMaintenanceBtn: "settings",
  loadSiteMaintenanceState: "settings",
  toggleSiteMaintenance: "settings",
  adminAccountAction: "settings",
  loadAdminAccounts: "settings",
  renderAdminAccounts: "settings",
  loadSettingsPanel: "settings",
  updateSettingsMaintenanceStatus: "settings",
  isFinFeatureEnabled: "settings",
  applyFinanceFeatureVisibility: "settings",
  syncFinancialFeatureModesFromList: "settings",
  renderFinanceFeatureControl: "settings",
  loadFinancialFeatureFlags: "settings",
  saveFinanceFeatureMode: "settings",
  handleFinancialAlertDetail: "finance",
  renderFinancialAlerts: "finance",
  renderLedgerTransactionsTable: "finance",
  applyLedgerFinanceSummary: "finance",
  loadLedgerFinanceSummary: "finance",
  financeRiskLevel: "finance",
  financeLedgerTypeLabel: "finance",
  normalizeFinanceRow: "finance",
  financeExtractReceiptRef: "finance",
  validateFinanceCollectAmount: "finance",
  showFinanceReceiptRef: "finance",
  copyFinanceReceiptRef: "finance",
  updateFinanceRoundingHint: "finance",
  financeNotifyBadgeHtml: "finance",
  getFinanceDriver: "finance",
  patchFinanceDriver: "finance",
  updateFinanceKpis: "finance",
  renderFinanceTable: "finance",
  closeFinanceDrawer: "finance",
  renderFinanceDrawerLedger: "finance",
  loadFinanceDrawerLedger: "finance",
  syncFinanceDrawerMeta: "finance",
  financeNotifyStatusText: "finance",
  loadFinanceDailyReport: "finance",
  exportFinanceDailyReportCsv: "finance",
  openFinanceBulkModal: "finance",
  closeFinanceBulkModal: "finance",
  runBulkCollectExec: "finance",
  collectAllFinanceDebts: "finance",
  sendFinanceReminder: "finance",
  openFinanceDrawer: "finance",
  submitFinanceCollect: "finance",
  setupFinanceDrawerUi: "finance",
  loadFinancePanel: "finance",
  loadTreasury: "finance",
  renderLiveProfitCards: "dashboard",
  recomputeLiveProfitDelivered: "dashboard",
  applyLiveProfitOnOrderPatch: "dashboard",
  syncLiveProfitFromStats: "dashboard",
  isCancelledOrderClient: "dashboard",
  orderBillableAmountClient: "dashboard",
  isDeliveredStatusClient: "dashboard",
  isActiveDeliveryStatusClient: "dashboard",
  isCreatedTodayClient: "dashboard",
  orderStatusRaw: "dashboard",
  isPendingLikeStatus: "dashboard",
  getOrderSlaLevel: "dashboard",
  isPendingTooLong: "dashboard",
  slaLevelLabel: "dashboard",
  collectSmartAlerts: "dashboard",
  renderSmartAlerts: "dashboard",
  startAdminAlertsTimer: "dashboard",
  adminMapDotIcon: "dashboard",
  ensureLiveMap: "dashboard",
  removeLiveMapMarker: "dashboard",
  upsertLiveMapMarker: "dashboard",
  syncLiveMapMarkers: "dashboard",
  applyDriverGpsToActiveOrders: "dashboard",
  updateLiveSocketPulse: "dashboard",
  classifyOrderStatusLive: "dashboard",
  updateLiveClock: "dashboard",
  refreshLiveDriversAndMap: "dashboard",
  scheduleAdminLiveStatsRefresh: "dashboard",
  refreshLiveDashboard: "dashboard",
  applyStatsToDom: "dashboard",
  loadStats: "dashboard",
  orderNeedsDriver: "dashboard",
  orderStatusMapColor: "dashboard",
  driverStatusLabel: "dashboard",
  driverMarkerColor: "dashboard",
  findCurrentOrderForDriver: "dashboard",
  buildDriverPopupHtml: "dashboard",
  buildOrderMapPopupHtml: "dashboard",
  haversineKm: "dashboard",
  getOrderTargetLatLng: "dashboard",
  canExecuteOnOrder: "orders",
  getAssignableDrivers: "orders",
  suggestNearestDriver: "orders",
  getOrderById: "orders",
  mergeOrderIntoCache: "orders",
  adminAssignDriver: "orders",
  adminTransferDriver: "orders",
  adminCancelOrder: "orders",
  runAssignDriver: "orders",
  renderExecDriverModalUi: "orders",
  openExecDriverModal: "orders",
  closeExecDriverModal: "orders",
  buildOrderExecPopupActions: "orders",
  renderOrderExecButtons: "orders",
  setupExecUi: "orders",
  focusLiveOrderRow: "orders",
  findCacheOrderIndex: "orders",
  buildLiveOrderRow: "orders",
  fillLiveOrderRowContent: "orders",
  applyLiveOrderRowState: "orders",
  adminRealtimeJoinTrackedOrders: "orders",
  handleAdminOrderPatch: "orders",
  handleAdminOrderLive: "orders",
  silentLoadRecentOrdersForRealtime: "orders",
  loadRecentOrders: "orders",
  renderRecentOrders: "orders",
  updateDriver: "drivers",
  loadDrivers: "drivers",
  renderDrivers: "drivers",
  handleAdminDriverUpdate: "drivers",
  adminDashboardSocketConnected: "sockets",
  getAdminSocketOrigin: "sockets",
  startAdminSocketFallbackPolling: "sockets",
  initAdminDashboardSocket: "sockets",
  loadNotifications: "panels",
  renderNotifications: "panels",
  loadCustomers: "panels",
  renderCustomers: "panels",
  loadStores: "panels",
  renderStores: "panels",
  loadJobs: "panels",
  renderJobs: "panels",
  loadComplaints: "panels",
  renderComplaints: "panels",
};

function parseFunctions(source) {
  const re = /(^|\n)(async )?function ([a-zA-Z_$][\w$]*)\s*\(/g;
  const hits = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    hits.push({ name: m[3], async: !!m[2], start: m.index + m[1].length });
  }
  const chunks = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].start;
    const end = i + 1 < hits.length ? hits[i + 1].start : source.length;
    let code = source.slice(start, end).trim();
    chunks.push({ name: hits[i].name, code });
  }
  return chunks;
}

const bootstrapMarker = "document.getElementById(\"reloadDriversBtn\")";
const bootstrapIdx = jsRaw.indexOf(bootstrapMarker);
const jsMain = bootstrapIdx >= 0 ? jsRaw.slice(0, bootstrapIdx).trim() : jsRaw;
const jsBoot = bootstrapIdx >= 0 ? jsRaw.slice(bootstrapIdx).trim() : "";

const fnChunks = parseFunctions(jsMain);
const allFnNames = fnChunks.map((c) => c.name);
const preamble = jsMain.slice(0, fnChunks[0] ? jsMain.indexOf(fnChunks[0].code) : jsMain.length).trim();

function rewrite(code, defName, { refs = false } = {}) {
  let out = code;
  out = out.replace(/window\.__ERVENOW_FETCH_TIMEOUT_MS/g, "globalThis.__ERVENOW_FETCH_TIMEOUT_MS");
  out = out.replace(/window\.PlatformAPI/g, "app.PlatformAPI");
  for (const v of STATE_VARS) {
    out = out.replace(new RegExp(`\\bvar ${v}\\b`, "g"), `app.${v}`);
    out = out.replace(new RegExp(`\\blet ${v}\\b`, "g"), `app.${v}`);
    out = out.replace(new RegExp(`\\bconst ${v}\\b`, "g"), `app.${v}`);
    out = out.replace(new RegExp(`(?<!app\\.)\\b${v}\\b`, "g"), `app.${v}`);
  }
  for (const fn of allFnNames) {
    if (fn === defName) continue;
    out = out.replace(new RegExp(`(?<!app\\.)\\b${fn}\\s*\\(`, "g"), `app.${fn}(`);
    if (refs) {
      out = out.replace(new RegExp(`(?<!app\\.)\\b${fn}\\b`, "g"), `app.${fn}`);
    }
  }
  if (defName) {
    out = out.replace(
      new RegExp(`^(async )?function ${defName}\\s*\\(`, "m"),
      `app.${defName} = $1function (`
    );
  }
  return out;
}

const byMod = { shared: [], settings: [], finance: [], dashboard: [], orders: [], drivers: [], sockets: [], panels: [], bootstrap: [] };

for (const chunk of fnChunks) {
  const mod = FN_TO_MOD[chunk.name] || "shared";
  byMod[mod].push(rewrite(chunk.code, chunk.name));
}

let preambleOut = preamble
  .replace(/^\s*window\.__ERVENOW_FETCH_TIMEOUT_MS\s*=\s*30000;\s*\n?/m, "")
  .split("\n")
  .map((line) => {
    let l = line;
    for (const v of STATE_VARS) {
      l = l.replace(new RegExp(`^var ${v}\\b`), `app.${v}`);
      l = l.replace(new RegExp(`^let ${v}\\b`), `app.${v}`);
      l = l.replace(new RegExp(`^const ${v}\\b`), `app.${v}`);
    }
    return l;
  })
  .join("\n");

const safeClickFn = `
app.safeClick = function safeClick(fn) {
  var locked = false;
  return async function () {
    if (locked) return;
    locked = true;
    try {
      await fn.apply(this, arguments);
    } finally {
      locked = false;
    }
  };
};
`;

const sharedHeader = `/** Shared state & utilities — Admin Dashboard */
export const app = {
  PlatformAPI: globalThis.PlatformAPI,
};

${preambleOut}

${safeClickFn}

export function bindToWindow() {
  for (const key of Object.keys(app)) {
    if (typeof app[key] === "function") {
      globalThis[key] = app[key];
    }
  }
}

`;

fs.mkdirSync(modDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "admin-dashboard.css"), css + "\n");
fs.writeFileSync(path.join(modDir, "shared.js"), sharedHeader + byMod.shared.join("\n\n") + "\n");

const apiJs = `/** PlatformAPI wrapper — all admin HTTP calls go through here */
import { app } from "./shared.js";

export function adminApi(path, options) {
  return app.PlatformAPI.api(path, options);
}

export function adminApiUrl(path) {
  return app.PlatformAPI.apiUrl(path);
}

app.adminApi = adminApi;
app.adminApiUrl = adminApiUrl;
`;
fs.writeFileSync(path.join(modDir, "api.js"), apiJs);

for (const mod of ["settings", "finance", "dashboard", "orders", "drivers", "sockets", "panels"]) {
  const body = byMod[mod].join("\n\n");
  fs.writeFileSync(
    path.join(modDir, `${mod}.js`),
    `/** Admin Dashboard — ${mod} */\nimport { app } from "./shared.js";\nimport "./api.js";\n\n${body}\n`
  );
}

if (jsBoot) {
  fs.writeFileSync(
    path.join(modDir, "bootstrap.js"),
    `/** UI wiring & boot */\nimport { app, bindToWindow } from "./shared.js";\nimport "./settings.js";\nimport "./finance.js";\nimport "./dashboard.js";\nimport "./orders.js";\nimport "./drivers.js";\nimport "./sockets.js";\nimport "./panels.js";\n\n${rewrite(jsBoot, null, { refs: true })}\n\nbindToWindow();\n`
  );
}

fs.writeFileSync(
  path.join(outDir, "admin-dashboard.js"),
  `/** Admin Dashboard entry */
import "./modules/shared.js";
import "./modules/api.js";
import "./modules/dashboard.js";
import "./modules/finance.js";
import "./modules/orders.js";
import "./modules/drivers.js";
import "./modules/settings.js";
import "./modules/sockets.js";
import "./modules/panels.js";
import "./modules/bootstrap.js";

globalThis.__ERVENOW_FETCH_TIMEOUT_MS = 30000;
`
);

const headBeforeStyle = lines.slice(0, lines.findIndex((l) => l.trim() === "<style>"));
const bodyLines = lines.slice(
  lines.findIndex((l) => l.trim() === "<body>"),
  lines.findIndex((l) => l.trim() === "</body>") + 1
);
const html = [
  ...headBeforeStyle,
  '    <link rel="stylesheet" href="/admin/admin-dashboard.css" />',
  "  </head>",
  ...bodyLines,
  '    <script src="/assets/api-config.js"></script>',
  '    <script src="/assets/api.js"></script>',
  '    <script src="https://cdn.socket.io/4.8.1/socket.io.min.js" crossorigin="anonymous"></script>',
  '    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
  '    <script type="module" src="/admin/admin-dashboard.js"></script>',
  "  </body>",
  "</html>",
  "",
].join("\n");

fs.writeFileSync(path.join(outDir, "admin-dashboard.html"), html);
console.log("OK:", outDir);
console.log("Functions:", allFnNames.length, "bootstrap:", bootstrapIdx >= 0);
