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

  function storeBits(store) {
    store = store || {};
    return {
      name: store.name || store.store_name || "",
      id: store.id || "",
      phone: store.phone || "",
      type: store.type || "",
    };
  }

  function supportMessage(store, note) {
    var s = storeBits(store);
    return [
      "بلاغ عطل — ERVENOW",
      "المتجر: " + (s.name || "—"),
      "المعرف: " + (s.id || "—"),
      "جوال المتجر: " + (s.phone || "—"),
      "النوع: " + (s.type || "—"),
      "وصف العطل: " + (String(note || "").trim() || "—"),
    ].join("\n");
  }

  function renderHtml(opts) {
    opts = opts || {};
    var roleLine = opts.portalTitle || opts.roleLabel || "";
    var year = new Date().getFullYear();
    if (opts.compact) return renderSlim(opts, roleLine, year);
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

  function renderSlim(opts, roleLine, year) {
    var s = storeBits(opts.store);
    return (
      '<footer class="pf-portal-footer pf-portal-footer--slim" role="contentinfo" aria-label="معلومات منصة ERVENOW">' +
      '<div class="pf-portal-footer__inner">' +
      '<div class="pf-portal-footer__brand">' +
      '<strong class="pf-portal-footer__name">' +
      esc(PLATFORM.name) +
      "</strong>" +
      '<span class="pf-portal-footer__tag">' +
      esc(PLATFORM.tag) +
      "</span>" +
      (roleLine ? '<span class="pf-portal-footer__portal">' + esc(roleLine) + "</span>" : "") +
      '<span class="pf-portal-footer__motto">' +
      esc(PLATFORM.motto) +
      "</span></div>" +
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
      '<button type="button" class="pf-portal-footer__link pf-portal-footer__support" data-pf-support-open>تواصل مع المنصة</button>' +
      "</div>" +
      '<p class="pf-portal-footer__copy">© ' +
      year +
      " ERVENOW</p>" +
      "</div>" +
      '<div class="pf-support" data-pf-support hidden>' +
      '<form class="pf-support__card" data-pf-support-form>' +
      "<h3>تواصل مع المنصة</h3>" +
      '<p class="pf-support__meta">المتجر: ' +
      esc(s.name || "—") +
      "<br>المعرف: " +
      esc(s.id || "—") +
      "<br>الجوال: " +
      esc(s.phone || "—") +
      "</p>" +
      '<label for="pfSupportNote">وصف العطل</label>' +
      '<textarea id="pfSupportNote" name="note" rows="3" required placeholder="مثال: الكاشير لا يطبع الفاتورة"></textarea>' +
      '<div class="pf-support__actions">' +
      '<button type="button" class="pf-portal-footer__link" data-pf-support-close>إغلاق</button>' +
      '<button type="submit" class="pf-portal-footer__link pf-portal-footer__support">إرسال عبر واتساب</button>' +
      "</div></form></div></footer>"
    );
  }

  function bindSupport(root) {
    if (!root || root.dataset.supportBound) return;
    root.dataset.supportBound = "1";
    root.addEventListener("click", function (ev) {
      var open = ev.target.closest("[data-pf-support-open]");
      var close = ev.target.closest("[data-pf-support-close]");
      var panel = root.querySelector("[data-pf-support]");
      if (open && panel) panel.hidden = false;
      if (close && panel) panel.hidden = true;
      if (ev.target === panel) panel.hidden = true;
    });
    root.addEventListener("submit", function (ev) {
      var form = ev.target.closest("[data-pf-support-form]");
      if (!form) return;
      ev.preventDefault();
      var note = form.querySelector("textarea");
      var text = supportMessage(bindSupport.store, note ? note.value : "");
      var url = PLATFORM.wa + "?text=" + encodeURIComponent(text);
      global.open(url, "_blank", "noopener");
    });
  }

  function mount(host, opts) {
    if (!host) return;
    opts = opts || {};
    bindSupport.store = opts.store || null;
    host.innerHTML = renderHtml(opts);
    bindSupport(host);
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalFooter = {
    renderHtml: renderHtml,
    mount: mount,
    PLATFORM: PLATFORM,
  };
})(typeof window !== "undefined" ? window : global);
