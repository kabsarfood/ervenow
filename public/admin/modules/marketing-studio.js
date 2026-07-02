/** ERVENOW Marketing Studio — Home Experience Manager (M1) */
import { app } from "./shared.js";

var STATUS_LABELS = {
  visible: "ظاهر",
  hidden: "مخفي",
  scheduled: "مجدول",
};

var AUDIENCE_LABELS = {
  all: "الجميع",
  guest: "زوار",
  logged_in: "مسجّلون",
};

app.loadMarketingStudioPanel = async function () {
  var root = document.getElementById("marketingStudioModules");
  var auditRoot = document.getElementById("marketingStudioAudit");
  if (!root) return;
  root.innerHTML = '<div class="item muted">جارٍ التحميل…</div>';
  try {
    var j = await app.PlatformAPI.api("/api/admin/marketing/experiences/home");
    app.cacheMarketingExperience = j.experience || null;
    app.renderMarketingStudioPanel();
    if (auditRoot) {
      var audit = await app.PlatformAPI.api("/api/admin/marketing/audit-log?surface=home&limit=12");
      app.renderMarketingStudioAudit(audit.items || []);
    }
  } catch (e) {
    root.innerHTML = '<div class="item">فشل التحميل: ' + app.escapeHtml(e.message || e) + "</div>";
  }
};

app.renderMarketingStudioPanel = function () {
  var root = document.getElementById("marketingStudioModules");
  var exp = app.cacheMarketingExperience;
  if (!root || !exp || !exp.modules) return;
  var modules = exp.modules.slice().sort(function (a, b) {
    return (a.display_order || 0) - (b.display_order || 0);
  });
  root.innerHTML = modules
    .map(function (mod, idx) {
      var locked = !!mod.locked;
      var statusOpts = ["visible", "hidden", "scheduled"]
        .map(function (s) {
          return (
            '<option value="' +
            s +
            '"' +
            (mod.status === s ? " selected" : "") +
            ">" +
            (STATUS_LABELS[s] || s) +
            "</option>"
          );
        })
        .join("");
      var audOpts = ["all", "guest", "logged_in"]
        .map(function (a) {
          return (
            '<option value="' +
            a +
            '"' +
            (mod.target_audience === a ? " selected" : "") +
            ">" +
            (AUDIENCE_LABELS[a] || a) +
            "</option>"
          );
        })
        .join("");
      return (
        '<div class="item marketing-studio-row" data-module-id="' +
        app.escapeHtml(mod.id) +
        '" draggable="' +
        (!locked && mod.reorderable !== false ? "true" : "false") +
        '">' +
        '<div class="line"><strong>' +
        app.escapeHtml(mod.name_ar || mod.name) +
        "</strong>" +
        (locked ? ' <span class="badge">مثبّت</span>' : "") +
        ' <span class="muted">#' +
        app.escapeHtml(mod.id) +
        "</span></div>" +
        '<div class="line marketing-studio-controls">' +
        '<label>الحالة <select class="ms-status"' +
        (locked ? " disabled" : "") +
        ">" +
        statusOpts +
        "</select></label>" +
        '<label>الترتيب <input type="number" class="ms-order" min="0" max="999" value="' +
        Number(mod.display_order || 0) +
        '"' +
        (locked ? " disabled" : "") +
        " /></label>" +
        '<label>الأولوية <input type="number" class="ms-priority" min="0" max="999" value="' +
        Number(mod.priority || 0) +
        '"' +
        (locked ? " disabled" : "") +
        " /></label>" +
        '<label>الجمهور <select class="ms-audience"' +
        (locked ? " disabled" : "") +
        ">" +
        audOpts +
        "</select></label>" +
        "</div>" +
        '<div class="line muted">الحاوية: ' +
        app.escapeHtml(mod.parent || "body") +
        " · جاهز للسحب والإفلات</div>" +
        "</div>"
      );
    })
    .join("");
};

app.renderMarketingStudioAudit = function (items) {
  var root = document.getElementById("marketingStudioAudit");
  if (!root) return;
  if (!items || !items.length) {
    root.innerHTML = '<div class="item muted">لا سجلات تدقيق بعد.</div>';
    return;
  }
  root.innerHTML = items
    .map(function (row) {
      return (
        '<div class="item">' +
        '<div class="line"><strong>' +
        app.escapeHtml(row.change_type || "—") +
        "</strong> · " +
        app.escapeHtml(row.module_id || "") +
        "</div>" +
        '<div class="line muted">' +
        app.escapeHtml(row.actor_phone || row.actor_id || "—") +
        " · " +
        app.fmtWhen(row.at) +
        "</div>" +
        "</div>"
      );
    })
    .join("");
};

app.collectMarketingStudioModules = function () {
  var rows = document.querySelectorAll(".marketing-studio-row");
  var out = [];
  rows.forEach(function (row) {
    var id = row.getAttribute("data-module-id");
    if (!id) return;
    out.push({
      id: id,
      status: row.querySelector(".ms-status")?.value || "visible",
      display_order: parseInt(row.querySelector(".ms-order")?.value || "0", 10),
      priority: parseInt(row.querySelector(".ms-priority")?.value || "0", 10),
      target_audience: row.querySelector(".ms-audience")?.value || "all",
    });
  });
  return out;
};

app.saveMarketingStudioPanel = async function () {
  var modules = app.collectMarketingStudioModules();
  try {
    var j = await app.PlatformAPI.api("/api/admin/marketing/experiences/home", {
      method: "PUT",
      body: { modules: modules },
    });
    app.cacheMarketingExperience = j.experience || app.cacheMarketingExperience;
    app.showSuccess(j.message || "تم حفظ تجربة الصفحة الرئيسية");
    await app.loadMarketingStudioPanel();
  } catch (e) {
    app.showError(e.message || "فشل الحفظ");
  }
};

(function wireMarketingStudioPanel() {
  var btn = document.getElementById("panelMarketingStudioBtn");
  var panel = document.getElementById("panelMarketingStudio");
  if (!btn || !panel) return;
  var saveBtn = document.getElementById("saveMarketingStudioBtn");
  var reloadBtn = document.getElementById("reloadMarketingStudioBtn");
  if (saveBtn) saveBtn.onclick = app.safeClick(app.saveMarketingStudioPanel);
  if (reloadBtn) reloadBtn.onclick = function () {
    void app.loadMarketingStudioPanel();
  };
})();
