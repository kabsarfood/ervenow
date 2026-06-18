/** Admin — Platform Modules Foundation */
import { app } from "./shared.js";

var platformModulesCache = [];

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function statusLabel(status) {
  var s = String(status || "").toLowerCase();
  if (s === "enabled") return "مفعّل";
  if (s === "beta") return "تجريبي";
  return "معطّل";
}

function statusBadgeCls(status) {
  var s = String(status || "").toLowerCase();
  if (s === "enabled") return "finance-status-badge ok";
  if (s === "beta") return "finance-status-badge warn";
  return "finance-status-badge muted";
}

app.renderPlatformModulesPanel = function () {
  var root = document.getElementById("platformModulesList");
  var hint = document.getElementById("platformModulesHint");
  if (hint) {
    hint.textContent =
      platformModulesCache.length > 0
        ? platformModulesCache.length + " وحدة — Enabled · Disabled · Beta"
        : "—";
  }
  if (!root) return;
  if (!platformModulesCache.length) {
    root.innerHTML = '<p class="ledger-tx-updated">لا توجد وحدات.</p>';
    return;
  }
  root.innerHTML = platformModulesCache
    .map(function (m) {
      return (
        '<div class="item platform-module-item" data-module-id="' +
        esc(m.id) +
        '">' +
        '<div class="line"><strong>' +
        esc(m.label_ar || m.label) +
        "</strong> <span class=\"muted\">(" +
        esc(m.label) +
        ")</span></div>" +
        '<div class="line">' +
        esc(m.description || "—") +
        "</div>" +
        '<div class="line">الحالة: <span class="' +
        statusBadgeCls(m.status) +
        '">' +
        statusLabel(m.status) +
        "</span></div>" +
        '<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-primary platform-module-set" data-status="enabled" data-id="' +
        esc(m.id) +
        '" style="min-height:44px">تفعيل</button>' +
        '<button type="button" class="btn btn-ghost platform-module-set" data-status="beta" data-id="' +
        esc(m.id) +
        '" style="min-height:44px">تجريبي</button>' +
        '<button type="button" class="btn btn-ghost platform-module-set" data-status="disabled" data-id="' +
        esc(m.id) +
        '" style="min-height:44px">تعطيل</button>' +
        "</div></div>"
      );
    })
    .join("");

  root.querySelectorAll(".platform-module-set").forEach(function (btn) {
    btn.onclick = app.safeClick(async function () {
      var id = btn.getAttribute("data-id");
      var status = btn.getAttribute("data-status");
      if (!id || !status) return;
      try {
        await app.PlatformAPI.api("/api/admin/platform-modules/" + encodeURIComponent(id), {
          method: "PATCH",
          body: { status: status },
        });
        app.showSuccess("تم تحديث حالة " + id);
        await app.loadPlatformModulesPanel({ force: true });
      } catch (e) {
        app.showError((e && e.message) || "تعذر تحديث الوحدة");
      }
    });
  });
};

app.loadPlatformModulesPanel = async function (opts) {
  opts = opts || {};
  var root = document.getElementById("platformModulesList");
  if (!root) return;
  if (!opts.force && platformModulesCache.length) {
    app.renderPlatformModulesPanel();
    return;
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/platform-modules");
    platformModulesCache = j.modules || [];
    app.renderPlatformModulesPanel();
  } catch (e) {
    app.showError((e && e.message) || "تعذر تحميل وحدات المنصة");
  }
};
