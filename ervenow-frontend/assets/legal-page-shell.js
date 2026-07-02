(function () {
  var SOCIAL_SVG = {
    x: '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>',
    snap:
      '<path d="M12 2c-2.2 0-4.5.45-6.1 2.05C4.3 5.7 4 7.9 4 9.5c0 1.1.2 2 .5 2.8-.9.3-1.7.7-2.3 1.2-.5.4-.2 1 .6 1 1.1 0 2.1-.2 3-.6-.3 1.5-.5 2.8 0 3.8.4.8 1.2 1.2 2.2 1.5-.3.9-.4 1.7 0 2.2.5.6 1.4.4 2.5 0 1.2-.5 2.6-1.2 4-1.2s2.8.7 4 1.2c1.1.4 2 .6 2.5 0 .4-.5.3-1.3 0-2.2 1-.3 1.8-.7 2.2-1.5.5-1 .3-2.3 0-3.8.9.4 1.9.6 3 .6.8 0 1.1-.6.6-1-.6-.5-1.4-.9-2.3-1.2.3-.8.5-1.7.5-2.8 0-1.6-.3-3.8-1.9-5.45C16.5 2.45 14.2 2 12 2z"/>',
    tg: '<path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>',
    wa: '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>',
  };

  var CHANNELS = [
    { href: "https://x.com/ervenow", label: "منصة X", icon: "x" },
    { href: "https://www.snapchat.com/add/ervenow", label: "سناب شات", icon: "snap" },
    { href: "https://t.me/ervenow", label: "تلغرام", icon: "tg" },
    { href: "https://wa.me/966505745650", label: "واتساب", icon: "wa" },
  ];

  var LEGAL_LINKS = [
    { href: "/privacy-policy", label: "سياسة الخصوصية" },
    { href: "/payments-refund-policy", label: "سياسة المدفوعات والإلغاء والاسترجاع" },
    { href: "/terms-of-use", label: "سياسة الاستخدام" },
  ];

  function socialLinksHtml() {
    return CHANNELS.map(function (ch) {
      return (
        '<a href="' +
        ch.href +
        '" target="_blank" rel="noopener noreferrer" aria-label="' +
        ch.label +
        '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        SOCIAL_SVG[ch.icon] +
        "</svg></a>"
      );
    }).join("");
  }

  function legalLinkHtml(page, href, label) {
    var active = page === href ? ' class="lp-footer__legal-link is-active" aria-current="page"' : ' class="lp-footer__legal-link"';
    return '<a' + active + ' href="' + href + '">' + label + "</a>";
  }

  function legalLinksHtml(currentPage) {
    return (
      '<div class="lp-footer__legal-links">' +
      LEGAL_LINKS.map(function (link) {
        return legalLinkHtml(currentPage, link.href, link.label);
      }).join("") +
      "</div>"
    );
  }

  function channelsBlockHtml() {
    return (
      '<div class="lp-footer__channels">' +
      '<p class="lp-footer__channels-title">قنوات التواصل</p>' +
      '<div class="lp-footer__social lp-footer__social--channels" aria-label="قنوات التواصل">' +
      socialLinksHtml() +
      "</div></div>"
    );
  }

  function footerHtml(currentPage) {
    var legalLinks = legalLinksHtml(currentPage);
    var channels = channelsBlockHtml();
    var year = String(new Date().getFullYear());
    var rights =
      '<p class="lp-footer__rights">© <span class="lp-footer__year">' +
      year +
      "</span> ERVENOW — جميع الحقوق محفوظة</p>";

    return (
      '<footer class="lp-footer" aria-label="فوتر الصفحة">' +
      '<div class="lp-footer__inner">' +
      '<div class="lp-footer__desktop-only lp-footer__desktop-panel" aria-label="فوتر الدسكتوب">' +
      '<p class="lp-footer__brand">ERVENOW</p>' +
      legalLinks +
      channels +
      rights +
      "</div>" +
      '<div class="lp-footer__mobile-only" aria-label="فوتر الجوال">' +
      '<p class="lp-footer__brand">ERVENOW</p>' +
      legalLinks +
      channels +
      rights +
      "</div></div></footer>"
    );
  }

  function mountFooter() {
    var body = document.body;
    if (!body || !body.classList.contains("legal-page-shell")) return;
    if (document.querySelector("body.legal-page-shell .lp-footer")) return;

    var currentPage = body.getAttribute("data-legal-page") || "";
    var main = document.querySelector(".dash-main");
    if (!main) return;

    main.insertAdjacentHTML("afterend", footerHtml(currentPage));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFooter);
  } else {
    mountFooter();
  }
})();
