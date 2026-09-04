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
var reloadLaunchReadinessBtn = document.getElementById("reloadLaunchReadinessBtn");
if (reloadLaunchReadinessBtn) reloadLaunchReadinessBtn.onclick = app.loadLaunchReadinessPanel;
var btnEnablePublicOrdering = document.getElementById("btnEnablePublicOrdering");
if (btnEnablePublicOrdering) {
  btnEnablePublicOrdering.onclick = function () {
    void app.togglePublicOrdering(true);
  };
}
var btnDisablePublicOrdering = document.getElementById("btnDisablePublicOrdering");
if (btnDisablePublicOrdering) {
  btnDisablePublicOrdering.onclick = function () {
    void app.togglePublicOrdering(false);
  };
}
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
var reloadBroadcastBtn = document.getElementById("reloadBroadcastBtn");
if (reloadBroadcastBtn) reloadBroadcastBtn.onclick = app.loadBroadcastPanel;
var reloadOffersBtn = document.getElementById("reloadOffersBtn");
if (reloadOffersBtn) reloadOffersBtn.onclick = app.loadOffersPanel;
var reloadHeroBannersBtn = document.getElementById("reloadHeroBannersBtn");
if (reloadHeroBannersBtn) {
  reloadHeroBannersBtn.onclick = function () {
    app.loadHeroBannersPanel({ force: true });
  };
}
var saveOffersBtn = document.getElementById("saveOffersBtn");
if (saveOffersBtn) saveOffersBtn.onclick = app.safeClick(app.saveOffersPanel);
var reloadServicesBtn = document.getElementById("reloadServicesBtn");
if (reloadServicesBtn) reloadServicesBtn.onclick = app.loadServicesPanel;
var reloadTransportBtn = document.getElementById("reloadTransportBtn");
if (reloadTransportBtn) reloadTransportBtn.onclick = app.loadTransportPanel;
var searchServicesEl = document.getElementById("searchServices");
if (searchServicesEl) searchServicesEl.addEventListener("input", function () {
  void app.loadServicesPanel();
});
var searchTransportEl = document.getElementById("searchTransport");
if (searchTransportEl) searchTransportEl.addEventListener("input", function () {
  void app.loadTransportPanel();
});
var saveErvenowPaySettingsBtn = document.getElementById("saveErvenowPaySettingsBtn");
if (saveErvenowPaySettingsBtn) saveErvenowPaySettingsBtn.onclick = app.safeClick(app.saveErvenowPaySettings);
var reloadPlatformModulesBtn = document.getElementById("reloadPlatformModulesBtn");
if (reloadPlatformModulesBtn) reloadPlatformModulesBtn.onclick = app.loadPlatformModulesPanel;
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
var liveMapPublicToggleBtn = document.getElementById("liveMapPublicToggleBtn");
if (liveMapPublicToggleBtn) {
  liveMapPublicToggleBtn.onclick = function () {
    void app.toggleLiveMapPublic();
  };
}
document.querySelectorAll(".panel-btn[data-panel]").forEach(function (btn) {
  if (btn.getAttribute("data-panel-wired") === "1") return;
  btn.setAttribute("data-panel-wired", "1");
  btn.addEventListener("click", function () {
    var panelId = btn.getAttribute("data-panel");
    if (!panelId) return;
    var isActive = btn.classList.contains("active");
    if (isActive) {
      app.showPanel("");
      return;
    }
    app.showPanel(panelId);
    void app.loadPanelById(panelId);
  });
});
document.querySelectorAll("[data-panel-jump]").forEach(function (link) {
  if (link.getAttribute("data-panel-jump-wired") === "1") return;
  link.setAttribute("data-panel-jump-wired", "1");
  link.addEventListener("click", function (e) {
    e.preventDefault();
    var panelId = link.getAttribute("data-panel-jump");
    if (!panelId || !document.getElementById(panelId)) return;
    app.showPanel(panelId);
    void app.loadPanelById(panelId);
    var el = document.getElementById(panelId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
  app.setupExecUi();
  app.initAdminDashboardSocket();
  app.startAdminAlertsTimer();
  var hashPanel = String(location.hash || "").replace(/^#/, "").trim();
  if (hashPanel && document.getElementById(hashPanel)) {
    app.showPanel(hashPanel);
    void app.loadPanelById(hashPanel);
    var hashEl = document.getElementById(hashPanel);
    if (hashEl) hashEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  void app.refreshLiveDashboard();
  if (app.hasPermission("dashboard")) {
    void app.loadMapCategoryColors();
    void app.loadLiveMapPublicState();
  }
  app.updateLiveSocketPulse();
  if (app.hasPermission("finance")) {
    app.loadFinancialFeatureFlags();
    app.loadLedgerFinanceSummary();
  }
  setTimeout(function () {
    void app.loadCommandCenter();
  }, 2500);
  setInterval(function () {
    if (app.hasPermission("dashboard")) {
      app.loadStats();
      void app.refreshLiveDashboard();
    }
    void app.loadCommandCenter();
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
