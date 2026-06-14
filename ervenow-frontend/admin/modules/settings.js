/** Admin Dashboard — settings */
import { app } from "./shared.js";
import "./api.js";

app.ensureAdminAccess = async function () {
  var token = app.getAnyToken();
  if (!token) {
    window.location.href = "/admin-login";
    return false;
  }
  if (app.PlatformAPI && typeof app.PlatformAPI.setToken === "function") {
    app.PlatformAPI.setToken(token);
  }
  try {
    var me = await fetch(app.PlatformAPI.apiUrl("/api/core/me"), {
      headers: { Authorization: "Bearer " + token },
    });
    var data = await me.json().catch(function () {
      return {};
    });
    var role = data && data.profile && data.profile.role;
    if (!role && data && data.user && data.user.role) role = data.user.role;
    if (!me.ok || !data || String(role || "").toLowerCase() !== "admin") {
      window.location.href = "/admin-login";
      return false;
    }
    return true;
  } catch (e) {
    window.location.href = "/admin-login";
    return false;
  }
}

app.applyAdminPermissionsFallback = function (reason) {
  app.adminPermissions = app.ADMIN_DEFAULT_PERMISSIONS.slice();
  app.adminLevel = "full";
  var who = document.getElementById("adminWho");
  if (who) {
    who.textContent =
      "مالك المنصة — " +
      app.levelLabel(app.adminLevel) +
      (reason ? " (وضع احتياطي)" : "");
  }
}

app.loadAdminProfile = async function () {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var j = await app.PlatformAPI.api("/api/admin/me");
      var perms = Array.isArray(j.permissions) ? j.permissions : [];
      if (!perms.length) {
        app.applyAdminPermissionsFallback(true);
        return;
      }
      app.adminPermissions = perms;
      app.adminLevel = j.level || "full";
      var who = document.getElementById("adminWho");
      if (who) who.textContent = "مالك المنصة — " + app.levelLabel(app.adminLevel);
      return;
    } catch (e) {
      if (attempt < 2) {
        await new Promise(function (r) {
          setTimeout(r, 500 + attempt * 400);
        });
        continue;
      }
      app.applyAdminPermissionsFallback(true);
      app.showError(
        (e && e.message) ||
          "تعذّر تحميل صلاحيات الأدمن — تم تفعيل الوضع الاحتياطي (لوحة + صيانة)"
      );
    }
  }
}

app.updateSiteMaintenanceBtn = function (enabled) {
  app.siteMaintenanceEnabled = !!enabled;
  app.updateSettingsMaintenanceStatus();
  var b = document.getElementById("siteMaintenanceBtn");
  if (!b) return;
  if (app.siteMaintenanceEnabled) {
    b.className = "btn btn-primary";
    b.textContent = "تشغيل الموقع للزوار";
    b.title = "إيقاف صفحة «تحت التطوير» وإعادة الموقع للزوار";
  } else {
    b.className = "btn btn-ghost";
    b.textContent = "تعطيل الموقع";
    b.title = "إظهار «تحت التطوير» على ervenow.com فقط — localhost للتطوير";
  }
}

app.loadSiteMaintenanceState = async function () {
  var btn = document.getElementById("siteMaintenanceBtn");
  if (!btn) return;
  btn.style.display = "";
  btn.disabled = false;
  try {
    var j = await app.PlatformAPI.api("/api/admin/site-maintenance");
    app.updateSiteMaintenanceBtn(j.enabled);
  } catch (e) {
    app.showError(
      (e && e.message) ||
        "تعذّر قراءة وضع الصيانة — يمكنك الضغط على «تعطيل الموقع» للمحاولة"
    );
  }
}

app.toggleSiteMaintenance = async function () {
  app.touchAdminActivity();
  try {
    var next = !app.siteMaintenanceEnabled;
    if (next && !confirm("سيتم إظهار «تحت التطوير» على ervenow.com / www.ervenow.com فقط. localhost:4000 يبقى للتطوير. لوحة الإدارة تبقى متاحة. متابعة؟")) {
      return;
    }
    var j = await app.PlatformAPI.api("/api/admin/site-maintenance", {
      method: "POST",
      body: { enabled: next },
    });
    app.updateSiteMaintenanceBtn(j.enabled);
    app.showSuccess(
      j.enabled ? "الموقع معطّل على ervenow.com — localhost للتطوير" : "تم تفعيل الموقع للزوار على الإنتاج"
    );
  } catch (e) {
    app.showError(e.message || "فشل تحديث وضع الموقع");
  }
}

app.adminAccountAction = async function (slot, action) {
  await app.PlatformAPI.api("/api/admin/admin-accounts/" + encodeURIComponent(slot) + "/action", {
    method: "POST",
    body: { action: action },
  });
}

app.loadAdminAccounts = async function () {
  if (!app.hasPermission("admin_accounts")) return;
  try {
    var j = await app.PlatformAPI.api("/api/admin/admin-accounts");
    app.cacheAdminAccounts = j.admins || [];
    app.renderAdminAccounts();
  } catch (e) {
    var list = document.getElementById("adminAccountsList");
    if (!list) return;
    list.innerHTML = '<div class="item">تعذر تحميل إدارة الأدمنات</div>';
  }
}

app.renderAdminAccounts = function () {
  var list = document.getElementById("adminAccountsList");
  if (!list) return;
  var q = app.getSearch("searchAdminAccounts");
  var rows = app.cacheAdminAccounts.filter(function (a) {
    return app.hasQueryMatch(q, [a.slot, a.phone, a.role, a.status]);
  });
  list.innerHTML = "";
  rows.forEach(function (a) {
    var item = document.createElement("div");
    item.className = "item";
    var phone = a.phone || "غير مضبوط";
    var st = String(a.status || "missing");
    item.innerHTML =
      "<strong>" + app.adminSlotLabel(a.slot) + "</strong>" +
      "<div>الرقم: " + phone + "</div>" +
      "<div>الحالة: " + st + "</div>" +
      "<div>الدور: " + (a.role || "—") + "</div>";
    if (a.slot === "limited1" || a.slot === "limited2") {
      var row = document.createElement("div");
      row.className = "row";
      row.appendChild(app.mkAction("خروج", "btn-ghost", app.safeClick(async function () {
        try { await app.adminAccountAction(a.slot, "logout"); app.showSuccess("تم إخراج " + app.adminSlotLabel(a.slot)); app.loadAdminAccounts(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
      row.appendChild(app.mkAction("حظر", "btn-ghost", app.safeClick(async function () {
        try { await app.adminAccountAction(a.slot, "block"); app.showSuccess("تم حظر " + app.adminSlotLabel(a.slot)); app.loadAdminAccounts(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
      row.appendChild(app.mkAction("تفعيل", "btn-primary", app.safeClick(async function () {
        try { await app.adminAccountAction(a.slot, "activate"); app.showSuccess("تم تفعيل " + app.adminSlotLabel(a.slot)); app.loadAdminAccounts(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
      item.appendChild(row);
    }
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا توجد بيانات أدمنات مطابقة</div>';
}

app.updateSettingsMaintenanceStatus = function () {
  var el = document.getElementById("settingsMaintenanceStatus");
  if (!el) return;
  el.textContent = app.siteMaintenanceEnabled
    ? "الموقع معطّل على ervenow.com — «تحت التطوير»"
    : "الموقع مفعّل للزوار على الإنتاج";
}

app.loadSettingsPanel = async function () {
  app.setPanelLoading("panelSettings", true);
  try {
    if (app.hasPermission("finance")) await app.loadFinancialFeatureFlags();
    app.updateSettingsMaintenanceStatus();
  } finally {
    app.setPanelLoading("panelSettings", false);
  }
}

app.FINANCE_FEATURE_DESCS = {
  auto_freeze: "تجميد محافظ تلقائي عند تجاوز حد الدين (محجوز للتوسع)",
  auto_payout: "صرف وتحويل تلقائي للأرصدة (محجوز للتوسع)",
  financial_alerts: "تنبيهات دين عالي / سحب كبير / نشاط غير طبيعي",
  finance_charts: "مؤشرات KPI المالية من ervenow_ledger",
  withdraw_system: "طلبات السحب وموافقة الإدارة",
};

app.isFinFeatureEnabled = function (key) {
  var m = Number(app.financialFeatureModes[key]);
  return m === 1 || m === 2;
}

app.applyFinanceFeatureVisibility = function () {
  var kpi = document.getElementById("ledgerFinanceKpiGrid");
  var alerts = document.getElementById("financialAlertsWrap");
  if (kpi) kpi.style.display = app.isFinFeatureEnabled("finance_charts") ? "" : "none";
  if (alerts) alerts.style.display = app.isFinFeatureEnabled("financial_alerts") ? "" : "none";
}

app.syncFinancialFeatureModesFromList = function (list) {
  app.financialFeatureModes = {};
  app.financialFeatureConfigs = {};
  (list || []).forEach(function (f) {
    if (f && f.key != null) {
      app.financialFeatureModes[f.key] = Number(f.mode);
      if (f.config) app.financialFeatureConfigs[f.key] = f.config;
    }
  });
  var af = app.financialFeatureConfigs.auto_freeze;
  if (af) {
    app.FINANCE_FEATURE_DESCS.auto_freeze =
      "تحذير عند " +
      af.warn_threshold +
      " ر.س — إيقاف عند " +
      af.freeze_threshold +
      " ر.س (AUTO)";
  }
}

app.financialFeatureConfigs = {};

app.renderFinanceFeatureControl = function (features) {
  var root = document.getElementById("financeFeatureControlList");
  var hint = document.getElementById("financeFeatureControlHint");
  if (!root) return;
  var list = Array.isArray(features) ? features : [];
  if (!list.length) {
    root.innerHTML =
      '<p class="financial-alert-empty">لا توجد ميزات — نفّذ migration_platform_feature_flags.sql</p>';
    return;
  }
  if (hint) {
    hint.textContent = "0=OFF · 1=ON · 2=AUTO — GET/POST /api/admin/features";
  }
  root.innerHTML = list
    .map(function (f) {
      var key = f.key || "";
      var label = app.FINANCE_FEATURE_LABELS[key] || f.label || key;
      var desc = app.FINANCE_FEATURE_DESCS[key] || "";
      var mode = Number(f.mode);
      if (!Number.isFinite(mode) || mode < 0 || mode > 2) mode = 0;
      return (
        '<div class="finance-feature-row">' +
        '<div><div class="finance-feature-row__label">' +
        app.escapeHtml(label) +
        "</div>" +
        (desc ? '<div class="finance-feature-row__desc">' + app.escapeHtml(desc) + "</div>" : "") +
        "</div>" +
        '<select class="finance-feature-mode-select" data-feature-key="' +
        app.escapeHtml(key) +
        '">' +
        '<option value="0"' +
        (mode === 0 ? " selected" : "") +
        ">OFF</option>" +
        '<option value="1"' +
        (mode === 1 ? " selected" : "") +
        ">ON</option>" +
        '<option value="2"' +
        (mode === 2 ? " selected" : "") +
        ">AUTO</option>" +
        "</select></div>"
      );
    })
    .join("");
  root.querySelectorAll(".finance-feature-mode-select").forEach(function (sel) {
    sel.onchange = function () {
      void app.saveFinanceFeatureMode(sel.getAttribute("data-feature-key"), Number(sel.value));
    };
  });
}

app.FINANCE_FEATURE_LABELS = {
  auto_freeze: "تجميد تلقائي",
  auto_payout: "صرف تلقائي",
  financial_alerts: "تنبيهات مالية",
  finance_charts: "رسوم / مؤشرات مالية",
  withdraw_system: "نظام السحب",
};

app.loadFinancialFeatureFlags = async function () {
  if (!app.hasPermission("finance")) return;
  var hint = document.getElementById("financeFeatureControlHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/features");
    var list = Array.isArray(j) ? j : [];
    app.syncFinancialFeatureModesFromList(list);
    app.renderFinanceFeatureControl(list);
    app.applyFinanceFeatureVisibility();
    if (hint && list.length) hint.textContent = "0=OFF · 1=ON · 2=AUTO — GET/POST /api/admin/features";
  } catch (e) {
    var msg = String(e.message || e || "");
    if (hint) {
      hint.textContent = /migration|feature_flags/i.test(msg)
        ? "Feature Control: القيم الافتراضية — نفّذ migration_platform_feature_flags.sql عند الحاجة"
        : msg || "تعذّر تحميل Feature Control";
    }
    var root = document.getElementById("financeFeatureControlList");
    if (root) {
      root.innerHTML =
        '<p class="financial-alert-empty">' + app.escapeHtml(e.message || "تعذّر التحميل") + "</p>";
    }
  }
}

app.saveFinanceFeatureMode = async function (key, mode) {
  if (!key || !app.hasPermission("finance")) return;
  var hint = document.getElementById("financeFeatureControlHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/features/update", {
      method: "POST",
      body: { key: key, mode: mode },
    });
    if (j && j.key) {
      app.financialFeatureModes[j.key] = Number(j.mode);
      var list = await app.PlatformAPI.api("/api/admin/features");
      if (Array.isArray(list)) {
        app.syncFinancialFeatureModesFromList(list);
        app.renderFinanceFeatureControl(list);
      }
    }
    app.applyFinanceFeatureVisibility();
    if (key === "financial_alerts" || key === "finance_charts") await app.loadLedgerFinanceSummary();
    if (hint) hint.textContent = "تم الحفظ — " + key + " = " + mode;
  } catch (e) {
    if (hint) hint.textContent = e.message || "تعذّر الحفظ";
    await app.loadFinancialFeatureFlags();
  }
}
