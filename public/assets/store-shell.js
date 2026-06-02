(function (global) {
  var TOKEN_KEYS = ["ervenow_access_token", "erwenow_access_token", "token"];
  var SUPPORT_PHONE = "966505745650";
  var SUPPORT_PHONE_DISPLAY = "0505745650";
  var SUPPORT_EMAIL = "support@ervenow.com";

  var PARTNER_TAGS = {
    merchant: "بوابة المتجر والتاجر",
    restaurant: "بوابة المطاعم والمقاهي",
    service: "بوابة مزودي الخدمة والشركات",
    default: "بوابة الشركاء — متاجر · مطاعم · خدمات",
  };

  var _opts = {};
  var _publicStoreUrl = "";
  var _sessionRole = "merchant";

  function whatsappUrl(context) {
    var text = "مرحباً ERVENOW — استفسار من " + (context || "بوابة الشريك");
    return "https://wa.me/" + SUPPORT_PHONE + "?text=" + encodeURIComponent(text);
  }

  function hasToken() {
    try {
      return !!(global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

  function whenPlatformApiReady(cb, tries) {
    tries = tries || 0;
    if (global.PlatformAPI && typeof global.PlatformAPI.getToken === "function") {
      cb();
      return;
    }
    if (tries > 100) return;
    setTimeout(function () {
      whenPlatformApiReady(cb, tries + 1);
    }, 40);
  }

  function fmtMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) x = 0;
    try {
      return x.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      return x.toFixed(2);
    }
  }

  function normalizeRole(role) {
    var r = String(role || "merchant").trim().toLowerCase();
    if (r === "user") return "customer";
    if (r === "provider") return "service";
    return r || "merchant";
  }

  function pageTagForRole(role) {
    role = normalizeRole(role);
    return PARTNER_TAGS[role] || PARTNER_TAGS.default;
  }

  function buildStoreNavLinks(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var role = normalizeRole(opts.role || _sessionRole);
    var links = [
      { key: "home", href: "/", label: "الرئيسية" },
      { key: "store", href: "/store-dashboard", label: "لوحة الشريك" },
      { key: "merchant", href: "/merchant-dashboard", label: "الطلبات والإيرادات" },
    ];
    if (role === "service") {
      links.push({ key: "services", href: "/services-provider", label: "خدماتي" });
    }
    if (_publicStoreUrl) {
      links.push({ key: "public", href: _publicStoreUrl, label: "صفحتي للعملاء" });
    }
    links.push({ key: "support", href: "#storeSupport", label: "تواصل المنصة" });
    if (!opts.authenticated) {
      links.push({ key: "login", href: "/login?role=merchant", label: "دخول الشريك", cta: true });
    }
    return links;
  }

  function navLinkHtml(link, activeNav) {
    var on = link.key === activeNav;
    var cls =
      "dash-site-header__link" +
      (on ? " is-active" : "") +
      (link.cta ? " dash-site-header__link--cta" : "");
    var extra = link.key === "public" ? ' target="_blank" rel="noopener"' : "";
    return (
      '<a class="' +
      cls +
      '" href="' +
      link.href +
      '" data-nav="' +
      link.key +
      '"' +
      extra +
      (on ? ' aria-current="page"' : "") +
      ">" +
      link.label +
      "</a>"
    );
  }

  function mobileNavItemHtml(link) {
    var extra = link.key === "public" ? ' target="_blank" rel="noopener"' : "";
    return (
      '<a class="store-mobile-nav__item' +
      (link.cta ? " store-mobile-nav__item--cta" : "") +
      '" href="' +
      link.href +
      '" data-nav="' +
      link.key +
      '"' +
      extra +
      ">" +
      link.label +
      "</a>"
    );
  }

  function renderHeader(opts) {
    opts = opts || {};
    var pageTag = opts.pageTag || PARTNER_TAGS.default;
    var activeNav = opts.activeNav || "store";
    var links = buildStoreNavLinks({ authenticated: hasToken(), role: _sessionRole })
      .map(function (l) {
        return navLinkHtml(l, activeNav);
      })
      .join("\n            ");
    var mobileLinks = buildStoreNavLinks({ authenticated: hasToken(), role: _sessionRole })
      .map(mobileNavItemHtml)
      .join("");
    return (
      '<header class="dash-site-header store-site-header">' +
      '<div class="dash-site-header__inner">' +
      '<div class="dash-site-header__brand">' +
      '<a class="dash-site-header__logo" href="/">' +
      "ERVENOW" +
      '<span class="dash-site-header__logo-dot" aria-hidden="true"></span>' +
      "</a>" +
      '<p class="dash-site-header__tag" id="storeShellPageTag">' +
      pageTag +
      "</p>" +
      "</div>" +
      '<nav class="dash-site-header__nav store-site-header__nav" aria-label="تنقل بوابة الشريك">' +
      '<div class="dash-site-header__links">' +
      links +
      "</div>" +
      "</nav>" +
      '<div class="dash-site-header__tools store-site-header__tools">' +
      '<div id="storeHeaderNotifications"></div>' +
      '<a class="dash-header-wallet store-header-wallet" id="storeHeaderWallet" href="#walletAnchor" aria-label="المحفظة المالية">' +
      '<span class="dash-header-wallet__icon" aria-hidden="true">💰</span>' +
      '<span class="dash-header-wallet__meta">' +
      '<span class="dash-header-wallet__label">المحفظة</span>' +
      '<span class="dash-header-wallet__row">' +
      '<span class="dash-header-wallet__val" id="storeHeaderWalletAmount">—</span>' +
      '<span class="dash-header-wallet__cur">ر.س</span>' +
      "</span>" +
      "</span>" +
      "</a>" +
      '<a class="store-header-support-btn" href="#storeSupport" aria-label="تواصل مع المنصة">' +
      '<span aria-hidden="true">📞</span><span class="store-header-support-btn__txt">دعم</span>' +
      "</a>" +
      '<button type="button" class="store-mobile-nav-btn" id="storeMobileNavBtn" aria-expanded="false" aria-controls="storeMobileNavPanel" aria-label="فتح القائمة">' +
      '<span aria-hidden="true">☰</span>' +
      "</button>" +
      "</div>" +
      '<a class="dash-site-header__btn dash-site-header__btn--primary" href="/login?role=merchant" id="storeSwitchAccount">تسجيل الدخول</a>' +
      "</div>" +
      '<div class="store-mobile-nav-panel" id="storeMobileNavPanel" hidden>' +
      mobileLinks +
      "</div>" +
      "</header>"
    );
  }

  function ensureNotificationCenterAssets() {
    if (!document.querySelector('link[data-erv-notification-center-css="1"]')) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = "/assets/notification-center.css";
      l.setAttribute("data-erv-notification-center-css", "1");
      document.head.appendChild(l);
    }
    if (!document.querySelector('script[data-erv-notification-center-js="1"]')) {
      var s = document.createElement("script");
      s.src = "/assets/notification-center.js";
      s.defer = true;
      s.setAttribute("data-erv-notification-center-js", "1");
      document.head.appendChild(s);
    }
  }

  function mountNotificationCenter() {
    if (!hasToken()) return;
    var host = document.getElementById("storeHeaderNotifications");
    if (!host || host.getAttribute("data-erv-notif-mounted") === "1") return;
    if (!global.ErvenowNotificationCenter || typeof global.ErvenowNotificationCenter.mount !== "function") {
      setTimeout(mountNotificationCenter, 120);
      return;
    }
    host.setAttribute("data-erv-notif-mounted", "1");
    global.ErvenowNotificationCenter.mount({ mount: host, key: "store-shell-header" });
  }

  function renderFooter() {
    var wa = whatsappUrl("بوابة الشريك");
    return (
      '<footer class="dash-site-footer store-site-footer">' +
      '<div class="store-site-footer__intro">' +
      "<strong>ERVENOW</strong> — شريكك في التجارة، التوصيل، والخدمات" +
      '<p class="store-site-footer__tagline">متاجر · مطاعم · صيدليات · محطات · شركات نقل · مزودو خدمات</p>' +
      "</div>" +
      '<div class="store-footer__grid">' +
      '<div class="store-footer__col">' +
      "<h3>خدمات أصحاب المتاجر والشركاء</h3>" +
      '<div class="store-footer__links">' +
      '<a href="/store-dashboard">لوحة تحكم الشريك</a>' +
      '<a href="/merchant-dashboard">الطلبات والإيرادات</a>' +
      '<a href="#walletAnchor">المحفظة المالية</a>' +
      '<a href="#withdrawCard">سحب الأرباح</a>' +
      '<a href="#productsAnchor">المنتجات والعروض</a>' +
      '<a href="/register-store.html">تسجيل متجر أو مطعم</a>' +
      '<a href="/partner-portal.html">بوابة الشركاء</a>' +
      "</div>" +
      "</div>" +
      '<div class="store-footer__col">' +
      "<h3>تواصل مع المنصة</h3>" +
      "<p>فريق ERVENOW يرافقك في التفعيل، العمولات، السحب، والدعم التشغيلي على مدار اليوم.</p>" +
      '<a class="store-footer__contact-chip" href="' +
      wa +
      '" target="_blank" rel="noopener">💬 واتساب ' +
      SUPPORT_PHONE_DISPLAY +
      "</a>" +
      '<a class="store-footer__contact-chip" href="mailto:' +
      SUPPORT_EMAIL +
      '">✉️ ' +
      SUPPORT_EMAIL +
      "</a>" +
      '<a class="store-footer__contact-chip" href="#storeSupport">📋 جميع قنوات التواصل</a>' +
      "</div>" +
      '<div class="store-footer__col">' +
      "<h3>استفسارات شائعة</h3>" +
      '<div class="store-footer__links">' +
      '<a href="#storeSupport">كيف أتواصل مع الإدارة؟</a>' +
      '<a href="#walletAnchor">متى يُضاف الرصيد للمحفظة؟</a>' +
      '<a href="#withdrawCard">طلب سحب الأرباح</a>' +
      '<a href="/register-store.html">انضمام متجر جديد</a>' +
      '<a href="/stores">دليل المتاجر</a>' +
      '<a href="/restaurants">دليل المطاعم</a>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<nav class="store-footer__quick" aria-label="روابط سريعة">' +
      '<a href="/">الرئيسية</a>' +
      '<a href="/dashboard">لوحة الزائر</a>' +
      '<a href="/delivery-services.html">خدمات التوصيل</a>' +
      '<a href="/services">الخدمات</a>' +
      "</nav>" +
      '<p class="dash-site-footer__copy">© 2026 ERVENOW — جميع الحقوق محفوظة</p>' +
      "</footer>"
    );
  }

  function wireMobileNav() {
    var btn = document.getElementById("storeMobileNavBtn");
    var panel = document.getElementById("storeMobileNavPanel");
    if (!btn || !panel || btn.getAttribute("data-wired") === "1") return;
    btn.setAttribute("data-wired", "1");
    btn.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (ev) {
      if (!panel || panel.hidden) return;
      if (panel.contains(ev.target) || btn.contains(ev.target)) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function paintNav(activeNav, authenticated, role) {
    var box = document.querySelector(".store-shell-page .dash-site-header__links");
    var panel = document.getElementById("storeMobileNavPanel");
    var links = buildStoreNavLinks({ authenticated: authenticated, role: role || _sessionRole });
    if (box) {
      box.innerHTML = links
        .map(function (l) {
          return navLinkHtml(l, activeNav || "store");
        })
        .join("\n");
    }
    if (panel) {
      panel.innerHTML = links.map(mobileNavItemHtml).join("");
    }
  }

  function setPageTag(role) {
    var tag = document.getElementById("storeShellPageTag");
    if (tag) tag.textContent = pageTagForRole(role);
  }

  function setAccountButton(authenticated, role, serviceType) {
    var btn = document.getElementById("storeSwitchAccount");
    if (!btn) return;
    if (!authenticated) {
      btn.textContent = "تسجيل الدخول";
      btn.setAttribute("href", "/login?role=merchant");
      btn.className = "dash-site-header__btn dash-site-header__btn--primary";
      btn.removeAttribute("title");
      return;
    }
    role = normalizeRole(role);
    var home =
      global.ErvenowAccountDest && ErvenowAccountDest.homeFor
        ? ErvenowAccountDest.homeFor(role, serviceType)
        : { path: "/store-dashboard", label: "لوحة الشريك", short: "حسابي" };
    btn.textContent = home.short || "حسابي";
    btn.setAttribute("href", home.path || "/store-dashboard");
    btn.setAttribute("title", home.label || "لوحة الشريك");
    btn.className = "dash-site-header__btn dash-site-header__btn--primary";
    if (!btn.getAttribute("data-erv-account-wired") && global.ErvenowAccountDest && ErvenowAccountDest.goHome) {
      btn.setAttribute("data-erv-account-wired", "1");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        ErvenowAccountDest.goHome({ role: role, serviceType: serviceType });
      });
    }
  }

  async function refreshWalletFromApi(role) {
    var amountEl = document.getElementById("storeHeaderWalletAmount");
    var box = document.getElementById("storeHeaderWallet");
    if (!amountEl || !box) return;
    role = normalizeRole(role || _sessionRole);
    if (!hasToken()) {
      amountEl.textContent = "—";
      box.setAttribute("href", "/login?role=merchant");
      return;
    }
    box.setAttribute("href", "#walletAnchor");
    amountEl.textContent = "…";
    try {
      var bal = 0;
      if (role === "merchant" || role === "restaurant") {
        var md = await global.PlatformAPI.api("/api/store/merchant-dashboard");
        bal = Number((md.wallet && md.wallet.balance) || 0);
      } else {
        try {
          var w = await global.PlatformAPI.api("/api/wallet");
          bal = Number(w.balance) || 0;
        } catch (_w) {
          var md2 = await global.PlatformAPI.api("/api/store/merchant-dashboard");
          bal = Number((md2.wallet && md2.wallet.balance) || 0);
        }
      }
      amountEl.textContent = fmtMoney(bal);
    } catch (e) {
      amountEl.textContent = "—";
    }
  }

  async function initAuthHeader() {
    if (!hasToken()) {
      _sessionRole = "merchant";
      setAccountButton(false);
      setPageTag(_sessionRole);
      paintNav(_opts.activeNav || "store", false, _sessionRole);
      await refreshWalletFromApi(_sessionRole);
      return;
    }
    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      if (global.ErvenowAccountDest && ErvenowAccountDest.setSessionFromMe) {
        ErvenowAccountDest.setSessionFromMe(me);
      }
      var profile = (me && me.profile) || {};
      var role = normalizeRole(profile.role || "merchant");
      _sessionRole = role;
      setPageTag(role);
      setAccountButton(true, role, profile.service_type);
      paintNav(_opts.activeNav || "store", true, role);
      await refreshWalletFromApi(role);
      mountNotificationCenter();
    } catch (e) {
      _sessionRole = "merchant";
      setAccountButton(false);
      setPageTag(_sessionRole);
      paintNav(_opts.activeNav || "store", false, _sessionRole);
      await refreshWalletFromApi(_sessionRole);
    }
  }

  function loadAccountDestScript() {
    if (document.querySelector("script[data-erv-account-dest]")) return;
    var s = document.createElement("script");
    s.src = "/assets/account-destinations.js";
    s.defer = true;
    s.setAttribute("data-erv-account-dest", "1");
    document.head.appendChild(s);
  }

  function mountShell(opts) {
    _opts = opts || {};
    var headerMount = document.getElementById("storeShellHeader");
    var footerMount = document.getElementById("storeShellFooter");
    if (headerMount) headerMount.outerHTML = renderHeader(_opts);
    if (footerMount) footerMount.outerHTML = renderFooter();
    wireMobileNav();
    init(_opts);
  }

  function init(opts) {
    _opts = opts || {};
    if (opts.pageTag) {
      var tag = document.getElementById("storeShellPageTag");
      if (tag) tag.textContent = opts.pageTag;
    }
    ensureNotificationCenterAssets();
    loadAccountDestScript();
    whenPlatformApiReady(function () {
      initAuthHeader();
    });
  }

  global.addEventListener("storage", function (ev) {
    if (!ev || !ev.key || TOKEN_KEYS.indexOf(ev.key) === -1) return;
    whenPlatformApiReady(initAuthHeader);
  });
  global.addEventListener("ervenow:auth-changed", function () {
    whenPlatformApiReady(initAuthHeader);
  });

  global.ErvenowStoreShell = {
    mountShell: mountShell,
    init: init,
    refreshWallet: function (balance) {
      var amountEl = document.getElementById("storeHeaderWalletAmount");
      if (!amountEl) return;
      if (balance == null || balance === "") {
        void refreshWalletFromApi(_sessionRole);
        return;
      }
      amountEl.textContent = fmtMoney(balance);
    },
    setPublicStoreUrl: function (url) {
      _publicStoreUrl = String(url || "").trim();
      paintNav(_opts.activeNav || "store", hasToken(), _sessionRole);
    },
    refreshAuthHeader: function () {
      whenPlatformApiReady(initAuthHeader);
    },
    setPageTag: setPageTag,
  };
})(window);
