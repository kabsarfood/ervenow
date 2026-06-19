/**
 * ERVENOW Portal Framework — تذييل موحّد لجميع البوابات التشغيلية
 */
(function (global) {
  "use strict";

  var PLATFORM = {
    name: "ERVENOW",
    tag: "المنصة الذكية",
    motto: "طلبك إلى باب بيتك.",
    phone: "0505745650",
    phoneE164: "+966505745650",
    wa: "https://wa.me/966505745650",
    email: "support@ervenow.com",
    site: "https://ervenow.com",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function renderHtml(opts) {
    opts = opts || {};
    var roleLine = opts.portalTitle || opts.roleLabel || "";
    var year = new Date().getFullYear();

    return (
      '<footer class="pf-portal-footer" role="contentinfo" aria-label="معلومات منصة ERVENOW">' +
      '<div class="pf-portal-footer__inner">' +
      '<div class="pf-portal-footer__brand">' +
      '<strong class="pf-portal-footer__name">' +
      esc(PLATFORM.name) +
      "</strong>" +
      '<span class="pf-portal-footer__tag">' +
      esc(PLATFORM.tag) +
      "</span>" +
      (roleLine
        ? '<span class="pf-portal-footer__portal">' + esc(roleLine) + "</span>"
        : "") +
      '<p class="pf-portal-footer__motto">' +
      esc(PLATFORM.motto) +
      "</p>" +
      "</div>" +
      '<div class="pf-portal-footer__contacts" aria-label="قنوات التواصل">' +
      '<a class="pf-portal-footer__link" href="tel:' +
      esc(PLATFORM.phoneE164) +
      '">📞 ' +
      esc(PLATFORM.phone) +
      "</a>" +
      '<a class="pf-portal-footer__link" href="' +
      esc(PLATFORM.wa) +
      '" target="_blank" rel="noopener noreferrer">💬 واتساب</a>' +
      '<a class="pf-portal-footer__link" href="mailto:' +
      esc(PLATFORM.email) +
      '">✉️ ' +
      esc(PLATFORM.email) +
      "</a>" +
      '<a class="pf-portal-footer__link" href="' +
      esc(PLATFORM.site) +
      '" target="_blank" rel="noopener noreferrer">🌐 ervenow.com</a>' +
      "</div>" +
      '<p class="pf-portal-footer__copy">© ' +
      year +
      " " +
      esc(PLATFORM.name) +
      " — جميع الحقوق محفوظة</p>" +
      "</div></footer>"
    );
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalFooter = {
    renderHtml: renderHtml,
    PLATFORM: PLATFORM,
  };
})(typeof window !== "undefined" ? window : global);
