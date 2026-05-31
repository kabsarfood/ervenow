/** UI wiring & boot */
import { app, bindToWindow } from "./shared.js";
import "./settings.js";
import "./finance.js";
import "./dashboard.js";
import "./orders.js";
import "./drivers.js";
import "./sockets.js";
import "./panels.js";
import "./approvals.js";

document.getElementById("reloadDriversBtn").onclick = app.loadDrivers;
document.getElementById("reloadComplaintsBtn").onclick = app.loadComplaints;
document.getElementById("reloadOrdersBtn").onclick = app.loadRecentOrders;
document.getElementById("reloadNotificationsBtn").onclick = app.loadNotifications;
document.getElementById("reloadCustomersBtn").onclick = app.loadCustomers;
document.getElementById("reloadStoresBtn").onclick = app.loadStores;
document.getElementById("reloadJobsBtn").onclick = app.loadJobs;
var reloadAdminAccountsBtn = document.getElementById("reloadAdminAccountsBtn");
if (reloadAdminAccountsBtn) reloadAdminAccountsBtn.onclick = app.loadAdminAccounts;
var reloadFinanceBtn = document.getElementById("reloadFinanceBtn");
if (reloadFinanceBtn) reloadFinanceBtn.onclick = app.loadFinancePanel;
var reloadErvenowPayBtn = document.getElementById("reloadErvenowPayBtn");
if (reloadErvenowPayBtn) reloadErvenowPayBtn.onclick = app.loadErvenowPayPanel;
var reloadOffersBtn = document.getElementById("reloadOffersBtn");
if (reloadOffersBtn) reloadOffersBtn.onclick = app.loadOffersPanel;
var saveOffersBtn = document.getElementById("saveOffersBtn");
if (saveOffersBtn) saveOffersBtn.onclick = app.safeClick(app.saveOffersPanel);
var reloadServicesBtn = document.getElementById("reloadServicesBtn");
if (reloadServicesBtn) reloadServicesBtn.onclick = app.loadServicesPanel;
var saveErvenowPaySettingsBtn = document.getElementById("saveErvenowPaySettingsBtn");
if (saveErvenowPaySettingsBtn) saveErvenowPaySettingsBtn.onclick = app.safeClick(app.saveErvenowPaySettings);
var reloadSettingsBtn = document.getElementById("reloadSettingsBtn");
if (reloadSettingsBtn) reloadSettingsBtn.onclick = app.loadSettingsPanel;
var openAdminAccountsBtn = document.getElementById("openAdminAccountsBtn");
if (openAdminAccountsBtn) {
  openAdminAccountsBtn.onclick = function () {
    app.showPanel("panelAdminAccounts");
    void app.loadAdminAccounts();
  };
}
var searchBind = [
  ["searchOrders", app.renderRecentOrders],
  ["searchNotifications", app.renderNotifications],
  ["searchDrivers", app.renderDrivers],
  ["searchComplaints", app.renderComplaints],
  ["searchCustomers", app.renderCustomers],
  ["searchStores", app.renderStores],
  ["searchApprovals", app.renderApprovalsList],
  ["searchJobs", app.renderJobs],
  ["searchAdminAccounts", app.renderAdminAccounts],
  ["financeSearch", app.renderFinanceTable],
];
var financeFilterEl = document.getElementById("financeFilter");
if (financeFilterEl) financeFilterEl.addEventListener("change", app.renderFinanceTable);
app.setupFinanceDrawerUi();
searchBind.forEach(function (pair) {
  var el = document.getElementById(pair[0]);
  if (!el) return;
  el.addEventListener("input", pair[1]);
});
var logoutAdminBtn = document.getElementById("logoutAdminBtn");
if (logoutAdminBtn) {
  logoutAdminBtn.onclick = function () {
    app.forceAdminLogout("");
  };
}
var siteMaintenanceBtn = document.getElementById("siteMaintenanceBtn");
if (siteMaintenanceBtn) {
  siteMaintenanceBtn.onclick = function () {
    app.toggleSiteMaintenance();
  };
}
document.querySelectorAll(".panel-btn[data-panel]").forEach(function (btn) {
  if (btn.getAttribute("data-panel-wired") === "1") return;
  btn.setAttribute("data-panel-wired", "1");
  btn.addEventListener("click", function () {
    var panelId = btn.getAttribute("data-panel");
    if (!panelId) return;
    var isActive = btn.classList.contains("active");
    app.showPanel(isActive ? "" : panelId);
    if (!isActive && panelId) void app.loadPanelById(panelId);
  });
});
var closeBtn = document.getElementById("closePanelsBtn");
if (closeBtn) {
  closeBtn.addEventListener("click", function () {
    app.showPanel("");
  });
}

(async function () {
  var ok = await app.ensureAdminAccess();
  if (!ok) return;
  await app.loadAdminProfile();
  await app.loadSiteMaintenanceState();
  app.setupFullAdminIdleGuard();
  app.applyPermissionVisibility();
  app.showPanel("");
  if (app.hasPermission("dashboard")) app.loadStats();
  else if (app.hasPermission("finance")) app.loadLedgerFinanceSummary();
  if (app.hasPermission("orders")) app.loadRecentOrders();
  if (app.hasPermission("drivers")) app.loadDrivers();
  if (
    app.hasPermission("customers") ||
    app.hasPermission("stores") ||
    app.hasPermission("drivers") ||
    app.hasPermission("providers")
  ) {
    void app.loadApprovalsPanel();
  }
  if (app.hasPermission("finance") && typeof app.refreshTopupPendingBadgeOnly === "function") {
    void app.refreshTopupPendingBadgeOnly();
  }
  var offersHeader = document.getElementById("adminHeaderOffers");
  if (offersHeader) {
    offersHeader.addEventListener("click", function (e) {
      e.preventDefault();
      app.showPanel("panelOffers");
      void app.loadOffersPanel();
      var el = document.getElementById("panelOffers");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  var payHeader = document.getElementById("adminNavErvenowPay");
  if (payHeader) {
    payHeader.addEventListener("click", function (e) {
      e.preventDefault();
      app.showPanel("panelErvenowPay");
      void app.loadErvenowPayPanel();
      var el = document.getElementById("panelErvenowPay");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  app.setupExecUi();
  app.initAdminDashboardSocket();
  app.startAdminAlertsTimer();
  void app.refreshLiveDashboard();
  app.updateLiveSocketPulse();
  if (app.hasPermission("finance")) {
    app.loadFinancialFeatureFlags();
    app.loadLedgerFinanceSummary();
  }
  setInterval(function () {
    if (app.hasPermission("dashboard")) {
      app.loadStats();
      void app.refreshLiveDashboard();
    }
  }, app.STATS_POLL_MS);
  setInterval(function () {
    if (app.hasPermission("finance")) {
      app.loadFinancialFeatureFlags();
      app.loadLedgerFinanceSummary();
      if (typeof app.refreshTopupPendingBadgeOnly === "function") void app.refreshTopupPendingBadgeOnly();
    }
  }, app.LEDGER_TX_POLL_MS);
})();

bindToWindow();
