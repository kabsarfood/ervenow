(function (global) {
  var TOKEN_KEYS = ["ervenow_access_token", "erwenow_access_token", "token"];
  var SUPPORT_PHONE = "966505745650";
  var SUPPORT_PHONE_DISPLAY = "0505745650";
  var SUPPORT_EMAIL = "support@ervenow.com";
  var STORE_LOGIN_URL = "/login?role=store";

  var PARTNER_TAGS = {
    store: "حساب المتجر — Store Account",
    merchant: "بوابة المتجر والتاجر",
    restaurant: "بوابة المطاعم والمقاهي",
    service: "بوابة مزودي الخدمة والشركات",
    default: "بوابة الشركاء — متاجر · مطاعم · خدمات",
  };

  var _opts = {};
  var _publicStoreUrl = "";
  var _sessionRole = "store";

  function appendStorePreviewParam(url) {
    var u = String(url || "").trim();
    if (!u) return u;
    if (/[?&]preview=/.test(u)) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "preview=1";
  }

  function buildPublicStoreUrl(storeId) {
    if (!storeId) return "";
    return appendStorePreviewParam("/store.html?id=" + encodeURIComponent(storeId));
  }

  function isStoreAccountRole(role) {
    var r = String(role || "").trim().toLowerCase();
    return r === "store" || r === "merchant" || r === "restaurant";
  }

  function whatsappUrl(context) {
    var text = "مرحباً ERVENOW — استفسار من " + (context || "لوحة المتجر");
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
    var r = String(role || "store").trim().toLowerCase();
    if (r === "user") return "customer";
    if (r === "provider") return "service";
    if (isStoreAccountRole(r)) return r === "store" ? "store" : r;
    return r || "store";
  }

  function pageTagForRole(role) {
    role = normalizeRole(role);
    if (isStoreAccountRole(role)) return PARTNER_TAGS.store || PARTNER_TAGS.default;
    return PARTNER_TAGS[role] || PARTNER_TAGS.default;
  }

  function buildStoreNavLinks(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var role = normalizeRole(opts.role || _sessionRole);
    var links = [
      { key: "store", href: "/store-dashboard", label: "لوحة المتجر" },
      { key: "order-board", href: "/order-board", label: "لوحة الطلبات" },
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
      links.push({ key: "login", href: STORE_LOGIN_URL, label: "دخول المتجر", cta: true });
    }
    return links;
  }

  function buildMobileNavLinks(opts) {
    var links = buildStoreNavLinks(opts);
    if (opts.authenticated) {
      links.push({ key: "logout", href: "#", label: "🚪 خروج", cta: true });
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
    var mobileLinks = buildMobileNavLinks({ authenticated: hasToken(), role: _sessionRole })
      .map(mobileNavItemHtml)
      .join("");
    return (
      '<header class="dash-site-header store-site-header">' +
      '<div class="dash-site-header__inner">' +
      '<div class="dash-site-header__brand">' +
      '<a class="dash-site-header__logo" href="/store-dashboard">' +
      "ERVENOW" +
      '<span class="dash-site-header__logo-dot" aria-hidden="true"></span>' +
      "</a>" +
      '<p class="dash-site-header__tag" id="storeShellPageTag">' +
      pageTag +
      "</p>" +
      "</div>" +
      '<nav class="dash-site-header__nav store-site-header__nav" aria-label="تنقل لوحة المتجر">' +
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
      '<a class="dash-site-header__btn dash-site-header__btn--primary" href="' +
      STORE_LOGIN_URL +
      '" id="storeSwitchAccount">تسجيل الدخول</a>' +
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
    return "";
  }

  function isMarketplaceHomeHref(href) {
    var p = String(href || "")
      .trim()
      .split("#")[0]
      .split("?")[0]
      .replace(/\/+$/, "");
    if (!p || p === "" || p === "/") return true;
    if (p === "/index.html" || p === "/index") return true;
    return false;
  }

  function isStoreShellBlockedFooterHref(href) {
    var p = String(href || "")
      .trim()
      .split("#")[0]
      .split("?")[0];
    if (isMarketplaceHomeHref(p)) return true;
    if (
      p === "/dashboard" ||
      p === "/cart" ||
      p === "/cart.html" ||
      p === "/checkout" ||
      p === "/checkout.html" ||
      p === "/partner-portal.html" ||
      p === "/partner-portal" ||
      p === "/register-store.html" ||
      p === "/register-store"
    ) {
      return true;
    }
    return false;
  }

  function disableFooterLink(anchor) {
    if (!anchor || anchor.getAttribute("data-store-footer-blocked") === "1") return;
    anchor.setAttribute("data-store-footer-blocked", "1");
    anchor.removeAttribute("href");
    anchor.classList.add("store-footer-link--disabled");
    anchor.setAttribute("aria-disabled", "true");
    anchor.setAttribute("tabindex", "-1");
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /** منع أي رابط في فوتر Store Account يؤدي للسوق أو الرئيسية */
  function wireStoreShellFooterGuard() {
    var root = document.querySelector(".store-shell-page");
    if (!root) return;
    root.querySelectorAll(".store-site-footer a[href], .store-footer__quick a[href]").forEach(function (a) {
      if (isStoreShellBlockedFooterHref(a.getAttribute("href"))) {
        disableFooterLink(a);
      }
    });
    root.querySelectorAll(".store-footer__quick").forEach(function (el) {
      el.hidden = true;
      el.style.display = "none";
    });
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
      var mobileLinks = buildMobileNavLinks({ authenticated: authenticated, role: role || _sessionRole });
      panel.innerHTML = mobileLinks.map(mobileNavItemHtml).join("");
      panel.querySelectorAll('[data-nav="logout"]').forEach(function (el) {
        wireStoreLogoutBtn(el);
      });
    }
  }

  function setPageTag(role) {
    var tag = document.getElementById("storeShellPageTag");
    if (tag) tag.textContent = pageTagForRole(role);
  }

  function performStoreLogout() {
    try {
      if (global.ErvenowAuthGuard && typeof global.ErvenowAuthGuard.clearSession === "function") {
        global.ErvenowAuthGuard.clearSession();
      } else {
        try {
          if (global.PlatformAPI && typeof global.PlatformAPI.setToken === "function") {
            global.PlatformAPI.setToken("");
          }
          TOKEN_KEYS.forEach(function (k) {
            try {
              localStorage.removeItem(k);
            } catch (_e) {}
          });
          localStorage.removeItem("userId");
          localStorage.removeItem("userPhone");
        } catch (_e2) {}
        try {
          document.cookie = "auth_token=; path=/; max-age=0; SameSite=Lax";
        } catch (_e3) {}
      }
    } catch (_e4) {}
    try {
      global.dispatchEvent(new CustomEvent("ervenow:auth-changed"));
    } catch (_e5) {}
    global.location.replace(STORE_LOGIN_URL);
  }

  function wireStoreLogoutBtn(btn) {
    if (!btn || btn.getAttribute("data-store-logout-wired") === "1") return;
    btn.setAttribute("data-store-logout-wired", "1");
    btn.addEventListener("click", function (e) {
      if (!hasToken()) return;
      e.preventDefault();
      performStoreLogout();
    });
  }

  function setAccountButton(authenticated) {
    var btn = document.getElementById("storeSwitchAccount");
    if (!btn) return;
    if (!authenticated) {
      btn.removeAttribute("data-store-logout-wired");
      btn.textContent = "تسجيل الدخول";
      btn.setAttribute("href", STORE_LOGIN_URL);
      btn.className = "dash-site-header__btn dash-site-header__btn--primary";
      btn.removeAttribute("title");
      return;
    }
    btn.textContent = "🚪 خروج";
    btn.setAttribute("href", STORE_LOGIN_URL);
    btn.setAttribute("title", "تسجيل الخروج");
    btn.className = "dash-site-header__btn dash-site-header__btn--primary store-header-logout-btn";
    wireStoreLogoutBtn(btn);
  }

  async function refreshWalletFromApi(role) {
    var amountEl = document.getElementById("storeHeaderWalletAmount");
    var box = document.getElementById("storeHeaderWallet");
    if (!amountEl || !box) return;
    role = normalizeRole(role || _sessionRole);
    if (!hasToken()) {
      amountEl.textContent = "—";
      box.setAttribute("href", "/login?role=store");
      return;
    }
    var walletHref =
      global.location &&
      (String(global.location.pathname || "").indexOf("merchant-dashboard") >= 0 ||
        String(global.location.pathname || "").indexOf("order-board") >= 0)
        ? "/store-dashboard#walletAnchor"
        : "#walletAnchor";
    box.setAttribute("href", walletHref);
    amountEl.textContent = "…";
    try {
      var bal = 0;
      if (isStoreAccountRole(role)) {
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
      _sessionRole = "store";
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
      var role = normalizeRole(profile.role || "store");
      _sessionRole = role;
      setPageTag(role);
      setAccountButton(true);
      paintNav(_opts.activeNav || "store", true, role);
      await refreshWalletFromApi(role);
      mountNotificationCenter();
    } catch (e) {
      _sessionRole = "store";
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
    wireStoreShellFooterGuard();
    if (hasToken()) {
      setAccountButton(true);
      var mobilePanel = document.getElementById("storeMobileNavPanel");
      if (mobilePanel) {
        mobilePanel.querySelectorAll('[data-nav="logout"]').forEach(function (el) {
          wireStoreLogoutBtn(el);
        });
      }
    }
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
      _publicStoreUrl = appendStorePreviewParam(String(url || "").trim());
      paintNav(_opts.activeNav || "store", hasToken(), _sessionRole);
    },
    buildPublicStoreUrl: buildPublicStoreUrl,
    appendStorePreviewParam: appendStorePreviewParam,
    refreshAuthHeader: function () {
      whenPlatformApiReady(initAuthHeader);
    },
    setPageTag: setPageTag,
  };
})(window);
