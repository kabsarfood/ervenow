/**
 * Store Preview Mode — معاينة صفحة المتجر من لوحة Store Account (preview=1).
 * يخفّي عناصر تجربة العميل/الزائر ويبقي محتوى المتجر فقط.
 */
(function (global) {
  function isActive(search) {
    try {
      var params =
        search != null
          ? new URLSearchParams(String(search).replace(/^\?/, ""))
          : new URLSearchParams(global.location.search);
      var v = String(params.get("preview") || "").trim().toLowerCase();
      return v === "1" || v === "true" || v === "yes";
    } catch (e) {
      return false;
    }
  }

  function appendToStoreUrl(url) {
    var u = String(url || "").trim();
    if (!u) return u;
    if (/[?&]preview=/.test(u)) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "preview=1";
  }

  function isMarketplaceCustomerHref(href) {
    var raw = String(href || "").trim();
    if (!raw || raw.charAt(0) !== "/") return false;
    var path = raw.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
    if (path === "/" || path === "/index" || path === "/index.html") return true;
    var blocked = [
      "/dashboard",
      "/cart",
      "/cart.html",
      "/stores",
      "/restaurants",
      "/services",
      "/delivery-services.html",
      "/delivery-map",
      "/track",
      "/login",
      "/register-store",
      "/register-store.html",
      "/start-now.html",
      "/browse",
      "/wallet.html",
      "/partner-portal",
      "/partner-portal.html",
    ];
    return blocked.indexOf(path) >= 0 || /^\/login/.test(path);
  }

  function applyPage() {
    if (!isActive()) return false;

    document.documentElement.classList.add("store-preview-mode");
    document.body.classList.add("store-preview-mode");

    var logo = document.querySelector(".dash-site-header__logo");
    if (logo) logo.setAttribute("href", "/store-dashboard");

    if (!document.getElementById("storePreviewBanner")) {
      var banner = document.createElement("div");
      banner.className = "store-preview-banner";
      banner.id = "storePreviewBanner";
      banner.setAttribute("role", "status");
      banner.innerHTML =
        '<div class="store-preview-banner__inner">' +
        '<p class="store-preview-banner__text">' +
        "<strong>👁 معاينة المتجر</strong> — كما تظهر صفحتك للعملاء. عناصر المنصة للزوار مخفية في هذه المعاينة." +
        "</p>" +
        '<a class="store-preview-banner__back btn btn-ghost" href="/store-dashboard">← العودة للوحة المتجر</a>' +
        "</div>";
      var header = document.querySelector(".dash-site-header");
      if (header && header.parentNode) {
        header.parentNode.insertBefore(banner, header.nextSibling);
      }
    }

    var breadcrumb = document.querySelector(".store-breadcrumb");
    if (breadcrumb) breadcrumb.hidden = true;

    var storeCartLink = document.getElementById("storeCartLink");
    if (storeCartLink) storeCartLink.hidden = true;

    var reviewLoginHint = document.getElementById("reviewLoginHint");
    if (reviewLoginHint) reviewLoginHint.hidden = true;

    document.querySelectorAll(".dash-site-footer__link").forEach(function (a) {
      if (isMarketplaceCustomerHref(a.getAttribute("href"))) {
        a.hidden = true;
      }
    });

    return true;
  }

  global.ErvenowStorePreview = {
    isActive: isActive,
    appendToStoreUrl: appendToStoreUrl,
    applyPage: applyPage,
    isMarketplaceCustomerHref: isMarketplaceCustomerHref,
  };
})(window);
