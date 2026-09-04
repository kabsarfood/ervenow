/** Shared state & utilities — Admin Dashboard */
export const app = {
  PlatformAPI: globalThis.PlatformAPI,
};

app.ADMIN_DEFAULT_PERMISSIONS = [
  "dashboard",
  "drivers",
  "customers",
  "complaints",
  "stores",
  "jobs",
  "finance",
  "providers",
  "notifications",
  "orders",
  "admin_accounts",
];


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


export function bindToWindow() {
  for (const key of Object.keys(app)) {
    if (typeof app[key] === "function") {
      globalThis[key] = app[key];
    }
  }
}

app.showSuccess = function (msg) {
  var el = document.createElement("div");
  el.textContent = String(msg || "");
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:fixed;bottom:20px;left:20px;right:20px;max-width:420px;margin:0 auto;background:#166534;color:#fff;padding:12px 14px;border-radius:10px;z-index:99999;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.2)";
  document.body.appendChild(el);
  setTimeout(function () {
    try {
      el.remove();
    } catch (_r) {}
  }, 3500);
}

app.showError = function (msg) {
  var el = document.createElement("div");
  el.textContent = String(msg || "حدث خطأ");
  el.setAttribute("role", "alert");
  el.style.cssText =
    "position:fixed;bottom:20px;left:20px;right:20px;max-width:420px;margin:0 auto;background:#b91c1c;color:#fff;padding:12px 14px;border-radius:10px;z-index:99999;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.2)";
  document.body.appendChild(el);
  setTimeout(function () {
    try {
      el.remove();
    } catch (_r) {}
  }, 5000);
}

app.setBadge = function (id, count) {
  var el = document.getElementById(id);
  if (!el) return;
  var n = Number(count) || 0;
  el.innerText = n;
  if (n > 0) el.classList.remove("zero");
  else el.classList.add("zero");
}

app.showPanel = function (panelId) {
  var panels = document.querySelectorAll(".admin-panel");
  for (var i = 0; i < panels.length; i++) {
    if (panelId && panels[i].id === panelId) panels[i].classList.add("active");
    else panels[i].classList.remove("active");
  }
  var btns = document.querySelectorAll(".panel-btn");
  for (var j = 0; j < btns.length; j++) {
    if (panelId && btns[j].getAttribute("data-panel") === panelId) btns[j].classList.add("active");
    else btns[j].classList.remove("active");
  }
  app.activePanelId = panelId || "";
  if (typeof history !== "undefined" && history.replaceState) {
    var base = location.pathname + location.search;
    if (panelId) {
      var nextHash = "#" + panelId;
      if (location.hash !== nextHash) history.replaceState(null, "", base + nextHash);
    } else if (location.hash) {
      history.replaceState(null, "", base);
    }
  }
}

app.adminPermissions = [];
app.adminLevel = "full";
app.FULL_ADMIN_IDLE_MS = 45 * 60 * 1000;
app.fullAdminIdleTimer = null;
app.lastAdminActivityAt = Date.now();
app.fullAdminForcedLogout = false;
app.cacheOrders = [];
app.adminSocket = null;
app.adminSocketFallbackTimer = null;
app.adminLiveStatsDebounceTimer = null;
app.adminDriverSilentRefreshTimer = null;
app.STATS_POLL_MS = 45000;
app.LEDGER_TX_POLL_MS = 30000;
app.ADMIN_CACHE_TTL_MS = 28000;
app.activePanelId = "";
app.ledgerFinanceSummary = null;
app.financialFeatureModes = {};
app.liveProfit = { ordersToday: 0, revenueDeliveredToday: 0 };
app.liveMap = null;
app.liveMapMarkersLayer = null;
app.liveMapDriverMarkers = {};
app.liveMapOrderMarkers = {};
app.liveMapStoreMarkers = {};
app.cacheMapStores = [];
app.liveMapSelectedCityId = "all";
app.liveMapAutoFitEnabled = true;
app.liveMapUserLocked = false;
app.liveMapSyncTimer = null;
app.liveMapControlsWired = false;
app.adminAlertsTimer = null;
app.PENDING_SLA_WARNING_MS = 5 * 60 * 1000;
app.PENDING_SLA_CRITICAL_MS = 10 * 60 * 1000;
app.PENDING_SLA_FAILURE_MS = 20 * 60 * 1000;
app.execModalOrder = null;
app.execModalMode = "assign";
app.execSuggestedDriver = null;
app.ORDER_MAP_COLORS = {
  pending: "#f59e0b",
  late: "#ef4444",
  delivering: "#3b82f6",
  delivered: "#9ca3af",
  noDriver: "#dc2626",
  accepted: "#8b5cf6",
  picked: "#06b6d4",
  driverFree: "#3b82f6",
  driverBusy: "#22c55e",
};
app.cacheNotifications = [];
app.cacheDrivers = [];
app.cacheComplaints = [];
app.cacheCustomers = [];
app.cacheStores = [];
app.cacheJobs = [];
app.cacheAdminAccounts = [];
app.cacheFinanceDrivers = [];
app.financeDebtLimit = 300;
app.financeLoadBusy = false;
app.financeDrawerDriverId = null;
app.financeDrawerLedgerCache = [];
app.financeAlertThreshold = 150;
app.financeCollectAllBusy = false;
app.financeLastDailyReport = null;
app.financeBulkPending = null;
app.siteMaintenanceEnabled = false;

app.getSearch = function (id) {
  var el = document.getElementById(id);
  return String(el && el.value ? el.value : "").trim().toLowerCase();
}

app.hasQueryMatch = function (q, parts) {
  if (!q) return true;
  var text = parts
    .map(function (x) { return String(x || "").toLowerCase(); })
    .join(" ");
  return text.indexOf(q) !== -1;
}

app.clearSessionTokens = function () {
  localStorage.removeItem("ervenow_access_token");
  localStorage.removeItem("erwenow_access_token");
  localStorage.removeItem("token");
}

app.teardownAdminRealtime = function () {
  if (app.adminDriverSilentRefreshTimer) {
    clearTimeout(app.adminDriverSilentRefreshTimer);
    app.adminDriverSilentRefreshTimer = null;
  }
  if (app.adminLiveStatsDebounceTimer) {
    clearTimeout(app.adminLiveStatsDebounceTimer);
    app.adminLiveStatsDebounceTimer = null;
  }
  if (app.adminSocketFallbackTimer) {
    clearInterval(app.adminSocketFallbackTimer);
    app.adminSocketFallbackTimer = null;
  }
  if (app.adminSocket) {
    try {
      app.adminSocket.removeAllListeners();
      app.adminSocket.disconnect();
    } catch (_d) {}
    app.adminSocket = null;
  }
  if (app.adminAlertsTimer) {
    clearInterval(app.adminAlertsTimer);
    app.adminAlertsTimer = null;
  }
}

app.forceAdminLogout = function (reason) {
  if (app.fullAdminForcedLogout) return;
  app.fullAdminForcedLogout = true;
  if (app.fullAdminIdleTimer) {
    clearTimeout(app.fullAdminIdleTimer);
    app.fullAdminIdleTimer = null;
  }
  app.teardownAdminRealtime();
  app.clearSessionTokens();
  if (app.PlatformAPI && typeof app.PlatformAPI.setToken === "function") {
    app.PlatformAPI.setToken("");
  }
  if (reason) {
    alert(reason);
  }
  location.href = "/admin-login";
}

app.touchAdminActivity = function () {
  if (app.adminLevel !== "full" || app.fullAdminForcedLogout) return;
  app.lastAdminActivityAt = Date.now();
  if (app.fullAdminIdleTimer) clearTimeout(app.fullAdminIdleTimer);
  app.fullAdminIdleTimer = setTimeout(function () {
    app.forceAdminLogout("تم تسجيل الخروج تلقائياً بعد دقيقتين بدون نشاط. يرجى إعادة الدخول بالرمز.");
  }, app.FULL_ADMIN_IDLE_MS);
}

app.setupFullAdminIdleGuard = function () {
  if (app.fullAdminIdleTimer) {
    clearTimeout(app.fullAdminIdleTimer);
    app.fullAdminIdleTimer = null;
  }
  if (app.adminLevel !== "full" || app.fullAdminForcedLogout) return;
  app.lastAdminActivityAt = Date.now();
  var events = ["click", "keydown", "mousemove", "scroll", "touchstart"];
  events.forEach(function (eventName) {
    document.addEventListener(eventName, touchAdminActivity, { passive: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") app.touchAdminActivity();
  });
  app.touchAdminActivity();
}

app.hasPermission = function (p) {
  return app.adminPermissions.indexOf(p) !== -1;
}

app.levelLabel = function (level) {
  if (level === "limited1") return "أدمن 1 (مقيد)";
  if (level === "limited2") return "أدمن 2 (مقيد)";
  return "مدير كامل الصلاحيات";
}

app.adminSlotLabel = function (slot) {
  if (slot === "limited1") return "أدمن 1";
  if (slot === "limited2") return "أدمن 2";
  return "مدير";
}

app.getAnyToken = function () {
  return (
    localStorage.getItem("ervenow_access_token") ||
    localStorage.getItem("erwenow_access_token") ||
    localStorage.getItem("token") ||
    ""
  );
}

app.applyPermissionVisibility = function () {
  var panelToPermission = {
    panelDrivers: "drivers",
    panelOrders: "orders",
    panelNotifications: "notifications",
    panelBroadcast: "notifications",
    panelComplaints: "complaints",
    panelCustomers: "customers",
    panelStores: "stores",
    panelApprovals: null,
    panelJobs: "jobs",
    panelAdminAccounts: "admin_accounts",
    panelSettings: null,
    panelPlatformModules: "dashboard",
    panelOffers: "dashboard",
    panelHeroBanners: "dashboard",
    panelMarketingStudio: "dashboard",
    panelServices: "providers",
    panelTransport: "providers",
    panelRoleSeparation: "dashboard",
    panelPreviewMonitor: "dashboard",
    panelRoleRegistry: "dashboard",
    panelErvenowPay: "finance",
    financePanel: "finance",
  };
  var btns = document.querySelectorAll(".panel-btn");
  for (var i = 0; i < btns.length; i++) {
    var panelId = btns[i].getAttribute("data-panel");
    if (!panelId) continue;
    var need = panelToPermission[panelId];
    var show = true;
    if (panelId === "panelSettings") {
      show =
        app.hasPermission("finance") ||
        app.hasPermission("dashboard") ||
        app.hasPermission("admin_accounts");
    } else if (panelId === "panelApprovals") {
      show =
        app.hasPermission("customers") ||
        app.hasPermission("stores") ||
        app.hasPermission("drivers") ||
        app.hasPermission("providers") ||
        app.hasPermission("dashboard");
    } else if (need) {
      show = app.hasPermission(need);
    }
    btns[i].style.display = show ? "" : "none";
    var panelEl = document.getElementById(panelId);
    if (panelEl) panelEl.style.display = show ? "" : "none";
  }
  var fin = app.hasPermission("finance");
  var finBtn = document.getElementById("financePanelBtn");
  if (finBtn) finBtn.style.display = fin ? "" : "none";
  if (typeof app.applyErvenowPayVisibility === "function") app.applyErvenowPayVisibility();
  if (typeof app.applyOffersPanelVisibility === "function") app.applyOffersPanelVisibility();
  if (typeof app.applyHeroBannersPanelVisibility === "function") app.applyHeroBannersPanelVisibility();
  if (typeof app.applyServicesPanelVisibility === "function") app.applyServicesPanelVisibility();
  var lfp = document.getElementById("ledgerFinancePanel");
  if (lfp) lfp.style.display = fin ? "block" : "none";
  var fcw = document.getElementById("financeFeatureControlWrap");
  if (fcw) fcw.style.display = fin ? "" : "none";
  var sab = document.getElementById("settingsAdminAccountsBlock");
  if (sab) sab.style.display = app.hasPermission("admin_accounts") ? "" : "none";
  var live = document.getElementById("liveDashboard");
  if (live) live.style.display = app.hasPermission("dashboard") || app.hasPermission("orders") ? "" : "none";
}

app.setPanelLoading = function (panelId, on) {
  var panel = document.getElementById(panelId);
  if (!panel) return;
  var lid = panelId + "Loader";
  var el = document.getElementById(lid);
  if (on) {
    if (!el) {
      el = document.createElement("div");
      el.id = lid;
      el.className = "panel-loader";
      el.setAttribute("role", "status");
      el.textContent = "جارٍ التحميل…";
      panel.insertBefore(el, panel.firstChild);
    }
    el.style.display = "";
  } else if (el) {
    el.style.display = "none";
  }
}

app.loadPanelById = function (panelId) {
  if (!panelId) return Promise.resolve();
  app.setPanelLoading(panelId, true);
  var done = function (p) {
    return (p || Promise.resolve()).finally(function () {
      app.setPanelLoading(panelId, false);
    });
  };
  switch (panelId) {
    case "panelLaunchReadiness":
      return done(app.loadLaunchReadinessPanel());
    case "panelOrders":
      return done(app.loadRecentOrders());
    case "panelNotifications":
      return done(app.loadNotifications());
    case "panelBroadcast":
      return done(app.loadBroadcastPanel());
    case "panelDrivers":
      return done(app.loadDrivers());
    case "panelComplaints":
      return done(app.loadComplaints());
    case "panelCustomers":
      return done(app.loadCustomers());
    case "panelStores":
      return done(app.loadStores());
    case "panelApprovals":
      return done(app.loadApprovalsPanel());
    case "panelJobs":
      return done(app.loadJobs());
    case "panelAdminAccounts":
      return done(app.loadAdminAccounts());
    case "panelSettings":
      return done(app.loadSettingsPanel());
    case "panelPlatformModules":
      return done(app.loadPlatformModulesPanel());
    case "panelOffers":
      return done(app.loadOffersPanel());
    case "panelHeroBanners":
      return done(app.loadHeroBannersPanel());
    case "panelMarketingStudio":
      return done(app.loadMarketingStudioPanel());
    case "panelServices":
      return done(app.loadServicesPanel());
    case "panelTransport":
      return done(app.loadTransportPanel());
    case "panelRoleSeparation":
      return done(app.loadRoleSeparationMonitor());
    case "panelPreviewMonitor":
      return done(app.loadPreviewMonitor());
    case "panelRoleRegistry":
      return done(app.loadRoleRegistry());
    case "panelErvenowPay":
      return done(app.loadErvenowPayPanel());
    case "financePanel":
      return done(app.loadFinancePanel());
    default:
      app.setPanelLoading(panelId, false);
      return Promise.resolve();
  }
}

app.mkAction = function (label, cls, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "btn " + cls;
  b.innerText = label;
  b.onclick = fn;
  return b;
}

app.confirmAccountBlock = function () {
  return window.confirm("حظر هذا الحساب؟ لن يتمكن من دخول الأعضاء أو استخدام خدمات المنصة.");
}

app.confirmAccountActivate = function () {
  return window.confirm("تفعيل هذا الحساب؟ سيتمكن من دخول الأعضاء واستخدام المنصة.");
}

/** حالة زائر/متسوق في لوحة إدارة الزوار */
app.customerAccountMeta = function (u) {
  var status = String((u && u.status) || "active").trim().toLowerCase();
  var role = String((u && u.role) || "").trim().toLowerCase();
  var blocked = status === "blocked" || role === "blocked";
  var pending = status === "pending";
  var rejected = status === "rejected";
  var approved = !blocked && !pending && !rejected;
  var stLabel = blocked ? "محظور" : pending ? "بانتظار الموافقة" : rejected ? "مرفوض" : "معتمد";
  var badgeCls = blocked
    ? "finance-status-badge--blocked"
    : pending
      ? "finance-status-badge--pending"
      : rejected
        ? "finance-status-badge--blocked"
        : "finance-status-badge--active";
  return { status: status, role: role, blocked: blocked, pending: pending, rejected: rejected, approved: approved, stLabel: stLabel, badgeCls: badgeCls };
}

app.patchCustomerInCache = function (id, patch) {
  if (!id) return;
  app.cacheCustomers = (app.cacheCustomers || []).map(function (row) {
    if (row.id !== id) return row;
    return Object.assign({}, row, patch || {});
  });
}

app.fmtMoney = function (v) {
  var n = Number(v || 0);
  return n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ريال";
}

app.fmtMoneyShort = function (v) {
  var n = Number(v || 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

app.roundMoney2 = function (n) {
  var x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

app.escapeHtml = function (s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.fmtWhen = function (v) {
  try {
    if (!v) return "—";
    return new Date(v).toLocaleString("ar-SA");
  } catch (_e) {
    return String(v || "—");
  }
}

app.liveTickBusy = false;

/** Live dashboard: pending ≠ delivering/delivered — نعرض pending للحالات المبكرة */
