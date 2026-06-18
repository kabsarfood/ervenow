/** Admin — Role Separation Monitor · Preview Monitor · Role Registry */
import { app } from "./shared.js";
import "./api.js";

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return app.fmtWhen ? app.fmtWhen(iso) : new Date(iso).toLocaleString("ar-SA");
  } catch (_e) {
    return String(iso);
  }
}

function kpiCard(label, value, sub) {
  return (
    '<div class="card readiness-kpi" style="margin:0;padding:12px">' +
    '<div class="sub">' +
    esc(label) +
    "</div>" +
    '<div class="stat">' +
    esc(value) +
    "</div>" +
    (sub ? '<div class="ledger-tx-updated">' + esc(sub) + "</div>" : "") +
    "</div>"
  );
}

app.loadRoleSeparationMonitor = async function () {
  var root = document.getElementById("roleSeparationMonitorBody");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var j = await app.PlatformAPI.api("/api/admin/role-separation-monitor");
    var sl = j.soft_launch || {};
    var roles = j.role_counts || {};
    var labels = j.role_labels || {};
    var roleKeys = ["customer", "merchant", "driver", "service", "transport", "admin"];
    var softHtml =
      '<div class="item" style="margin-bottom:14px;border:1px solid rgba(34,139,34,.35);background:rgba(34,139,34,.06);border-radius:12px;padding:12px">' +
      "<strong>🟢 Soft Launch " +
      (sl.enabled ? "مفعّل" : "متوقف") +
      "</strong>" +
      (sl.started_at ? " · بدء: " + fmtWhen(sl.started_at) : "") +
      (sl.hours_since_start != null ? " · منذ " + sl.hours_since_start + " ساعة" : "") +
      ' · <button type="button" class="btn btn-primary" id="loadSoftLaunchReportBtn" style="margin-inline-start:8px;min-height:36px">تقرير ' +
      (sl.report_ready ? "48 ساعة" : "التشغيل") +
      "</button>" +
      '<div id="softLaunchReportBox" style="margin-top:10px"></div></div>';

    var roleHtml =
      '<h4 style="margin:0 0 10px">المستخدمون حسب الدور</h4><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">';
    roleKeys.forEach(function (k) {
      roleHtml += kpiCard(labels[k] || k, roles[k] != null ? roles[k] : "0");
    });
    roleHtml += "</div>";

    var previews = j.preview_visits || j.portal_visits || {};
    var portalLabels = j.portal_labels || {};
    var previewKeys = ["merchant", "driver", "service", "transport"];
    var portalHtml =
      '<h4 style="margin:0 0 10px">Portal Visits (Preview)</h4><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px">';
    previewKeys.forEach(function (k) {
      var row = previews[k] || {};
      portalHtml += kpiCard(
        portalLabels[k] || k,
        row.unique_users != null ? row.unique_users : 0,
        "زيارات: " + (row.visits || 0) + " · نشط: " + (row.active_users || 0) + " · آخر: " + fmtWhen(row.last_at)
      );
    });
    portalHtml += "</div>";

    var rs = j.redirect_statistics || {};
    var redirectHtml =
      '<h4 style="margin:0 0 10px">Redirect Events</h4>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px">' +
      kpiCard("إجمالي", rs.total || 0) +
      kpiCard("ناجح", rs.success || 0) +
      kpiCard("فاشل", rs.failed || 0) +
      kpiCard("نسبة النجاح", (rs.success_rate != null ? rs.success_rate : 100) + "%") +
      "</div>";
    var events = j.redirect_events || [];
    if (events.length) {
      redirectHtml +=
        '<ul class="readiness-error-list">' +
        events
          .slice(0, 12)
          .map(function (e) {
            return (
              "<li>" +
              fmtWhen(e.at) +
              " · " +
              esc(e.portal || "—") +
              " → " +
              esc(e.path || "—") +
              " · " +
              (e.success ? "✓" : "✗") +
              (e.role ? " · " + esc(e.role) : "") +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    } else {
      redirectHtml += '<div class="sub">لا توجد أحداث توجيه مسجّلة بعد.</div>';
    }

    var err = j.redirect_errors || {};
    var errHtml = '<h4 style="margin:0 0 10px">أخطاء التوجيه</h4><div class="readiness-errors">';
    [
      ["unknown_role", "Unknown Role"],
      ["failed_redirect", "Failed Redirect"],
      ["unauthorized_portal", "Unauthorized Portal Access"],
    ].forEach(function (pair) {
      var row = err[pair[0]] || {};
      errHtml +=
        '<div class="item"><strong>' +
        esc(pair[1]) +
        "</strong> — " +
        esc(row.count || 0) +
        " حدث";
      var recent = row.recent || [];
      if (recent.length) {
        errHtml +=
          '<ul class="readiness-error-list">' +
          recent
            .slice(0, 5)
            .map(function (r) {
              return (
                "<li>" +
                fmtWhen(r.at) +
                " · " +
                esc(r.path || "—") +
                (r.role ? " · " + esc(r.role) : "") +
                (r.portal ? " · " + esc(r.portal) : "") +
                "</li>"
              );
            })
            .join("") +
          "</ul>";
      }
      errHtml += "</div>";
    });
    errHtml += "</div>";

    var legacy = j.legacy_access || {};
    var legacyLabels = j.legacy_labels || {};
    var legacyHtml =
      '<h4 style="margin:0 0 10px">Legacy Access</h4><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">';
    Object.keys(legacyLabels).forEach(function (k) {
      var row = legacy[k] || {};
      legacyHtml += kpiCard(
        legacyLabels[k],
        row.unique_users != null ? row.unique_users : 0,
        "زيارات: " + (row.visits || 0)
      );
    });
    legacyHtml += "</div>";

    root.innerHTML = softHtml + roleHtml + portalHtml + redirectHtml + errHtml + legacyHtml;
    var hint = document.getElementById("roleSeparationMonitorHint");
    if (hint) hint.textContent = "آخر تحديث: " + fmtWhen(j.updated_at);

    var reportBtn = document.getElementById("loadSoftLaunchReportBtn");
    if (reportBtn) {
      reportBtn.onclick = function () {
        void app.loadSoftLaunchReport();
      };
    }
  } catch (e) {
    root.innerHTML = '<div class="item">' + esc(e.message || "فشل التحميل") + "</div>";
  }
};

app.loadSoftLaunchReport = async function () {
  var box = document.getElementById("softLaunchReportBox");
  if (!box) return;
  box.innerHTML = '<div class="sub">جارٍ إنشاء التقرير…</div>';
  try {
    var r = await app.PlatformAPI.api("/api/admin/role-separation-report?hours=48");
    var html = '<div class="sub" style="line-height:1.6">';
    html += "<strong>تقرير " + esc(r.period_hours) + " ساعة</strong> (من " + fmtWhen(r.period_since) + ")<br>";
    html += "توجيه: ناجح " + esc(r.redirect_statistics.success) + " / فاشل " + esc(r.redirect_statistics.failed);
    html += " · Unknown: " + esc((r.redirect_errors.unknown_role && r.redirect_errors.unknown_role.count) || 0);
    html += "<ul style='margin:8px 0;padding-inline-start:18px'>";
    (r.recommendations || []).forEach(function (rec) {
      html += "<li>[" + esc(rec.level) + "] " + esc(rec.text) + "</li>";
    });
    html += "</ul>";
    html +=
      "<strong>الاستمرار في Soft Launch؟</strong> " + (r.continue_soft_launch ? "نعم ✓" : "يحتاج مراجعة");
    html += "</div>";
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = '<div class="sub">' + esc(e.message || "فشل التقرير") + "</div>";
  }
};

app.loadPreviewMonitor = async function () {
  var root = document.getElementById("previewMonitorBody");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var j = await app.PlatformAPI.api("/api/admin/preview-monitor");
    var previews = j.previews || {};
    var keys = ["merchant", "driver", "service", "transport"];
    var html =
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">';
    keys.forEach(function (k) {
      var row = previews[k] || {};
      html += kpiCard(
        row.label || k,
        row.active_users != null ? row.active_users : 0,
        "زيارات: " +
          (row.visits || 0) +
          " · مستخدمون: " +
          (row.unique_users || 0) +
          " · آخر: " +
          fmtWhen(row.last_at)
      );
      html +=
        '<div class="sub" style="margin:-6px 0 12px 4px"><a href="' +
        esc(row.path || "#") +
        '" target="_blank" rel="noopener">فتح المعاينة</a></div>';
    });
    html += "</div>";
    root.innerHTML = html;
    var hint = document.getElementById("previewMonitorHint");
    if (hint) hint.textContent = "آخر تحديث: " + fmtWhen(j.updated_at);
  } catch (e) {
    root.innerHTML = '<div class="item">' + esc(e.message || "فشل التحميل") + "</div>";
  }
};

app.loadRoleRegistry = async function () {
  var root = document.getElementById("roleRegistryList");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var q = app.getSearch("searchRoleRegistry");
    var url = "/api/admin/role-registry?limit=200";
    if (q) url += "&q=" + encodeURIComponent(q);
    var j = await app.PlatformAPI.api(url);
    var rows = j.items || [];
    if (!rows.length) {
      root.innerHTML = '<div class="item">لا توجد سجلات مطابقة.</div>';
      return;
    }
    root.innerHTML =
      '<div class="finance-table-wrap"><table class="finance-table" aria-label="سجل الأدوار">' +
      "<thead><tr><th>المستخدم</th><th>الدور</th><th>البوابة</th><th>آخر دخول</th></tr></thead><tbody>" +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.name) +
            "<br><span class='sub'>" +
            esc(r.phone) +
            "</span></td><td>" +
            esc(r.role_bucket_label || r.role) +
            (r.service_type_label ? "<br><span class='sub'>" + esc(r.service_type_label) + "</span>" : "") +
            "</td><td><code>" +
            esc(r.portal) +
            "</code></td><td>" +
            fmtWhen(r.last_login) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
    var hint = document.getElementById("roleRegistryHint");
    if (hint) hint.textContent = "عرض فقط — " + (j.total || rows.length) + " سجل";
  } catch (e) {
    root.innerHTML = '<div class="item">' + esc(e.message || "فشل التحميل") + "</div>";
  }
};

(function wireReadinessPanels() {
  var r1 = document.getElementById("reloadRoleSeparationBtn");
  if (r1) r1.onclick = function () {
    void app.loadRoleSeparationMonitor();
  };
  var r2 = document.getElementById("reloadPreviewMonitorBtn");
  if (r2) r2.onclick = function () {
    void app.loadPreviewMonitor();
  };
  var r3 = document.getElementById("reloadRoleRegistryBtn");
  if (r3) r3.onclick = function () {
    void app.loadRoleRegistry();
  };
  var search = document.getElementById("searchRoleRegistry");
  if (search) {
    search.oninput = function () {
      void app.loadRoleRegistry();
    };
  }
})();
