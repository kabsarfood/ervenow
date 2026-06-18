/**
 * ERVENOW Portal Framework v1 — PortalWidgets
 * Shared dashboard widgets: KPI, Quick Actions, Health Status, Recent Activity.
 */
(function (global) {
  "use strict";

  var RC = function () {
    return global.ErvenowPortalFramework && ErvenowPortalFramework.RoleContext;
  };

  function esc(s) {
    var r = RC();
    return r ? r.esc(s) : String(s || "");
  }

  function kpiCard(opts) {
    opts = opts || {};
    return (
      '<div class="pf-kpi">' +
      '<span class="pf-kpi__lbl">' +
      esc(opts.label || "") +
      '</span><span class="pf-kpi__val">' +
      esc(opts.value != null ? opts.value : "—") +
      (opts.suffix ? '<span class="pf-kpi__suffix">' + esc(opts.suffix) + "</span>" : "") +
      "</span></div>"
    );
  }

  function kpiGrid(items) {
    var html = (items || [])
      .map(function (item) {
        return kpiCard(item);
      })
      .join("");
    return '<div class="pf-kpi-grid">' + html + "</div>";
  }

  function quickActions(items) {
    var html = (items || [])
      .map(function (item) {
        var href = item.href || "#";
        var section = item.section ? ' data-pf-section="' + esc(item.section) + '"' : "";
        var tag = item.href && item.href !== "#" ? "a" : "button";
        var extra = tag === "button" ? ' type="button"' + section : ' href="' + esc(href) + '"';
        return (
          "<" +
          tag +
          ' class="pf-quick-card"' +
          extra +
          "><span>" +
          esc(item.label || "") +
          "</span>" +
          (item.sub ? "<small>" + esc(item.sub) + "</small>" : "") +
          "</" +
          tag +
          ">"
        );
      })
      .join("");
    return '<div class="pf-quick-grid">' + html + "</div>";
  }

  function healthStatus(items) {
    var html = (items || [])
      .map(function (item) {
        var ok = item.ok !== false;
        return (
          '<div class="pf-ops-item' +
          (ok ? "" : " is-warn") +
          '"><span>' +
          (ok ? "🟢" : "🟠") +
          "</span><span>" +
          esc(item.label || "") +
          "</span></div>"
        );
      })
      .join("");
    return (
      '<div class="pf-card pf-health">' +
      '<h3 class="pf-card__title">الحالة التشغيلية</h3>' +
      '<div class="pf-ops-grid">' +
      html +
      "</div></div>"
    );
  }

  function recentActivity(opts) {
    opts = opts || {};
    var rows = opts.items || [];
    var body = rows.length
      ? rows
          .map(function (row) {
            return typeof row === "string" ? row : row.html || "";
          })
          .join("")
      : '<p class="pf-empty">' + esc(opts.emptyText || "لا يوجد نشاط حديث.") + "</p>";
    var head =
      '<div class="pf-recent__head">' +
      '<h3 class="pf-card__title" style="margin:0">' +
      esc(opts.title || "آخر النشاط") +
      "</h3>" +
      (opts.viewAllSection
        ? '<button type="button" class="pf-btn" data-pf-section="' +
          esc(opts.viewAllSection) +
          '">' +
          esc(opts.viewAllLabel || "عرض الكل") +
          "</button>"
        : opts.viewAllHref
          ? '<a class="pf-btn" href="' + esc(opts.viewAllHref) + '">' + esc(opts.viewAllLabel || "عرض الكل") + "</a>"
          : "") +
      "</div>";
    return '<div class="pf-recent">' + head + body + "</div>";
  }

  function sectionHeader(title, subtitle) {
    return (
      '<h2 class="pf-section-title">' +
      esc(title || "") +
      "</h2>" +
      (subtitle ? '<p class="pf-section-sub">' + esc(subtitle) + "</p>" : "")
    );
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalWidgets = {
    kpiCard: kpiCard,
    kpiGrid: kpiGrid,
    quickActions: quickActions,
    healthStatus: healthStatus,
    recentActivity: recentActivity,
    sectionHeader: sectionHeader,
  };
})(typeof window !== "undefined" ? window : global);
