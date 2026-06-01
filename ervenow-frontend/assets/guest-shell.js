(function (global) {
  var TOKEN_STORAGE_KEYS = ["ervenow_access_token", "erwenow_access_token", "token"];
  var _activeNavKey = "";

  /** روابط الهيدر حسب الدور (من القائمة → الهيدر) */
  function buildNavLinks(role, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var r = String(role || "").toLowerCase();
    if (r === "user") r = "customer";
    var links = [{ key: "home", href: "/", label: "الرئيسية" }];
    links.push({ key: "guest", href: "/dashboard", label: "لوحة الزائر" });
    if (opts.authenticated) {
      if (r === "driver") {
        links.push({ key: "my_orders", href: "/orders", label: "طلباتي" });
      } else if (r === "customer" || r === "user" || !r) {
        links.push({ key: "my_orders", href: "/my-orders", label: "طلباتي" });
      }
    }
    if (r === "admin" && opts.authenticated) {
      links.push({
        key: "control",
        href: "/admin-dashboard",
        label: "لوحة التحكم",
      });
    } else if (r === "driver" && opts.authenticated) {
      links.push({
        key: "track",
        href: "/driver-app",
        label: "تتبع الحي",
      });
    } else {
      links.push({
        key: "track",
        href: "/track",
        label: "تتبع الحي",
      });
    }
    if (!opts.authenticated) {
      links.push({
        key: "login",
        href: "/login?role=customer",
        label: "دخول",
        cta: true,
      });
    }
    return links;
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

  function syncGuestBrowseMode() {
    if (!hasToken()) return;
    try {
      if (global.ErvenowGuestBrowse && ErvenowGuestBrowse.setActive) {
        ErvenowGuestBrowse.setActive(false);
      } else {
        localStorage.removeItem("ervenow_guest_browse");
      }
    } catch (e) {}
    var note = document.getElementById("guestNote");
    if (note) note.style.display = "none";
  }

  function fmtWalletMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) x = 0;
    try {
      return x.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      return x.toFixed(2);
    }
  }

  function refreshCartBadge() {
    if (typeof global.updateCartCount === "function") global.updateCartCount();
    var badge = document.getElementById("cartCount");
    if (!badge) return;
    var n = parseInt(badge.textContent, 10) || 0;
    badge.setAttribute("data-empty", n > 0 ? "false" : "true");
  }

  async function refreshHeaderWallet(role) {
    var box = document.getElementById("dashHeaderWallet");
    var amountEl = document.getElementById("dashHeaderWalletAmount");
    if (!box || !amountEl) return;
    role = String(role || "").toLowerCase();
    if (!hasToken()) {
      box.hidden = false;
      box.setAttribute("href", "/login?role=customer");
      amountEl.textContent = "—";
      return;
    }
    if (role === "admin") {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var href = "/wallet.html";
    if (role === "driver") href = "/driver-wallet";
    if (role === "merchant" || role === "restaurant") href = "/store-dashboard#wallet";
    box.setAttribute("href", href);
    amountEl.textContent = "…";
    try {
      var bal = 0;
      if (role === "driver") {
        var j = await global.PlatformAPI.api("/api/driver/wallet");
        bal = Number(j.balance) || 0;
      } else if (role === "merchant" || role === "restaurant") {
        try {
          var md = await global.PlatformAPI.api("/api/store/merchant-dashboard");
          bal = Number((md.wallet && md.wallet.balance) || 0);
        } catch (em) {
          var w2 = await global.PlatformAPI.api("/api/wallet");
          bal = Number(w2.balance) || 0;
        }
      } else {
        var w = await global.PlatformAPI.api("/api/wallet");
        bal = Number(w.balance) || 0;
      }
      amountEl.textContent = fmtWalletMoney(bal);
    } catch (e) {
      amountEl.textContent = "—";
    }
  }

  function setAccountButtonLoggedOut(switchAccount) {
    if (!switchAccount) return;
    switchAccount.style.display = "";
    switchAccount.textContent = "تسجيل الدخول";
    switchAccount.className =
      "dash-site-header__btn dash-site-header__btn--primary switch-account--nav-only";
    switchAccount.setAttribute("href", "/login?role=customer");
    switchAccount.removeAttribute("aria-label");
  }

  function setAccountButtonLoggedIn(switchAccount, role, serviceType) {
    if (!switchAccount) return;
    role = String(role || "customer").toLowerCase();
    if (role === "user") role = "customer";
    if (role === "provider") role = "service";
    var home =
      global.ErvenowAccountDest && ErvenowAccountDest.homeFor
        ? ErvenowAccountDest.homeFor(role, serviceType)
        : { path: "/dashboard", label: "لوحة زائر المنصة", short: "حسابي" };
    switchAccount.style.display = "";
    switchAccount.textContent = home.short || "حسابي";
    switchAccount.className = "dash-site-header__btn dash-site-header__btn--primary";
    switchAccount.classList.remove("switch-account--nav-only");
    switchAccount.setAttribute("href", home.path);
    switchAccount.setAttribute("aria-label", "فتح " + (home.label || "لوحة حسابك"));
    switchAccount.setAttribute("title", home.label || "");
    if (!switchAccount.getAttribute("data-erv-account-wired")) {
      switchAccount.setAttribute("data-erv-account-wired", "1");
      switchAccount.addEventListener("click", function (e) {
        if (global.ErvenowAccountDest && ErvenowAccountDest.goHome) {
          e.preventDefault();
          ErvenowAccountDest.goHome();
        }
      });
    }
  }

  async function initAuthHeader() {
    var switchAccount = document.getElementById("switchAccount");
    if (!hasToken()) {
      setAccountButtonLoggedOut(switchAccount);
      await refreshHeaderWallet("");
      paintHeaderNav(_activeNavKey, "", { authenticated: false });
      paintIndexNav("", { authenticated: false });
      return;
    }
    syncGuestBrowseMode();
    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      if (global.ErvenowAccountDest && ErvenowAccountDest.setSessionFromMe) {
        ErvenowAccountDest.setSessionFromMe(me);
      }
      var role = (me.profile && me.profile.role) || "customer";
      role = String(role).toLowerCase();
      var serviceType = me.profile && me.profile.service_type;
      setAccountButtonLoggedIn(switchAccount, role, serviceType);
      await refreshHeaderWallet(role);
      paintHeaderNav(_activeNavKey, role, { authenticated: true });
      paintIndexNav(role, { authenticated: true });
      if (role === "driver") {
        document.querySelectorAll(".dash-header-cart").forEach(function (a) {
          a.style.display = "none";
        });
      }
    } catch (e) {
      setAccountButtonLoggedIn(switchAccount, "customer");
      await refreshHeaderWallet("customer");
      paintHeaderNav(_activeNavKey, "", { authenticated: false });
      paintIndexNav("", { authenticated: false });
    }
  }

  function syncHeaderLayoutMetrics() {
    if (global.ErvenowViewport && typeof ErvenowViewport.syncHeaderHeight === "function") {
      ErvenowViewport.syncHeaderHeight();
    }
  }

  function paintHeaderNav(activeNav, role, opts) {
    var box = document.querySelector(".dash-site-header__links");
    if (!box) return;
    box.innerHTML = buildNavLinks(role, opts)
      .map(function (l) {
        return navLinkHtml(l, activeNav || "");
      })
      .join("\n");
    syncHeaderLayoutMetrics();
  }

  function lpNavLinkHtml(link) {
    var cls = link.cta ? ' class="lp-nav__cta"' : "";
    return (
      '<a href="' +
      link.href +
      '" data-nav="' +
      link.key +
      '"' +
      cls +
      ">" +
      link.label +
      "</a>"
    );
  }

  function paintIndexNav(role, opts) {
    var wrap = document.getElementById("lpNavWrap");
    if (!wrap) return;
    wrap.innerHTML =
      '<nav class="lp-nav" aria-label="التنقل الرئيسي">' +
      buildNavLinks(role, opts)
        .map(lpNavLinkHtml)
        .join("") +
      "</nav>";
    var mobileQuick = document.getElementById("lpMobileQuickNav");
    if (mobileQuick) {
      mobileQuick.innerHTML = buildNavLinks(role, opts)
        .map(function (l) {
          return (
            '<a role="menuitem" class="lp-dd-item' +
            (l.cta ? " lp-dd-item--cta" : "") +
            '" href="' +
            l.href +
            '" data-nav="' +
            l.key +
            '"><span class="lp-dd-ic" aria-hidden="true">•</span><span class="lp-dd-link__text">' +
            l.label +
            "</span></a>"
          );
        })
        .join("");
    }
    var controlMenu = document.getElementById("lpNavControlMenu");
    if (controlMenu) {
      var extra = buildNavLinks(role, opts).filter(function (l) {
        return l.key === "track" || l.key === "control";
      })[0];
      if (extra) {
        controlMenu.href = extra.href;
        controlMenu.setAttribute("aria-label", extra.label);
        controlMenu.setAttribute("data-nav", extra.key);
        var ic = controlMenu.querySelector(".lp-dd-ic");
        if (ic) ic.textContent = extra.key === "track" ? "📍" : "🔒";
        var txt = controlMenu.querySelector(".lp-dd-link__text");
        if (txt) txt.textContent = extra.label;
      }
    }
  }

  function setActiveNav(key) {
    if (!key) return;
    document.querySelectorAll(".dash-site-header__link[data-nav]").forEach(function (a) {
      var on = a.getAttribute("data-nav") === key;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function navLinkHtml(link, activeNav) {
    var on = link.key === activeNav;
    var cls =
      "dash-site-header__link" +
      (on ? " is-active" : "") +
      (link.cta ? " dash-site-header__link--cta" : "");
    return (
      '<a class="' +
      cls +
      '" href="' +
      link.href +
      '" data-nav="' +
      link.key +
      '"' +
      (on ? ' aria-current="page"' : "") +
      ">" +
      link.label +
      "</a>"
    );
  }

  function renderHeader(opts) {
    opts = opts || {};
    var pageTag = opts.pageTag || "ERVENOW";
    var activeNav = opts.activeNav || "";
    var links = buildNavLinks("", { authenticated: false })
      .map(function (l) {
        return navLinkHtml(l, activeNav);
      })
      .join("\n            ");
    return (
      '<header class="dash-site-header">' +
      '<div class="dash-site-header__inner">' +
      '<div class="dash-site-header__brand">' +
      '<a class="dash-site-header__logo" href="/">' +
      "ERVENOW" +
      '<span class="dash-site-header__logo-dot" aria-hidden="true"></span>' +
      "</a>" +
      '<p class="dash-site-header__tag" id="guestShellPageTag">' +
      pageTag +
      "</p>" +
      "</div>" +
      '<nav class="dash-site-header__nav" aria-label="التنقل الرئيسي">' +
      '<div class="dash-site-header__links">' +
      links +
      "</div>" +
      "</nav>" +
      '<div class="dash-site-header__tools">' +
      '<a class="dash-header-wallet" id="dashHeaderWallet" href="/wallet.html" hidden aria-label="المحفظة">' +
      '<span class="dash-header-wallet__label">محفظة</span>' +
      '<span class="dash-header-wallet__val" id="dashHeaderWalletAmount">—</span>' +
      '<span class="dash-header-wallet__cur">ر.س</span>' +
      "</a>" +
      '<a class="dash-header-cart" href="/cart" aria-label="السلة — الدفع">' +
      '<span aria-hidden="true">🛒</span>' +
      '<span class="dash-header-cart__label">السلة</span>' +
      '<span class="dash-header-cart__badge" id="cartCount" data-empty="true">0</span>' +
      "</a>" +
      "</div>" +
      '<a class="dash-site-header__btn dash-site-header__btn--primary switch-account--nav-only" href="/login?role=customer" id="switchAccount">تسجيل الدخول</a>' +
      "</div>" +
      "</header>"
    );
  }

  function renderFooter() {
    return (
      '<footer class="dash-site-footer">' +
      '<div class="dash-site-footer__logo">ERVENOW</div>' +
      '<nav class="dash-site-footer__links" aria-label="روابط سفلية">' +
      '<a class="dash-site-footer__link" href="/restaurants">مطاعم</a>' +
      '<a class="dash-site-footer__link" href="/stores">متاجر</a>' +
      '<a class="dash-site-footer__link" href="/delivery-services.html">توصيل</a>' +
      '<a class="dash-site-footer__link" href="/services">خدمات</a>' +
      '<a class="dash-site-footer__link" href="/delivery-map">طلب من الخريطة</a>' +
      '<a class="dash-site-footer__link" href="/start-now.html">ابدأ الآن</a>' +
      '<a class="dash-site-footer__link" href="/">الرئيسية</a>' +
      "</nav>" +
      '<p class="dash-site-footer__copy">© 2026 ERVENOW — جميع الحقوق محفوظة</p>' +
      "</footer>"
    );
  }

  function mountShell(opts) {
    opts = opts || {};
    var headerMount = document.getElementById("guestShellHeader");
    var footerMount = document.getElementById("guestShellFooter");
    if (headerMount) headerMount.outerHTML = renderHeader(opts);
    if (footerMount) footerMount.outerHTML = renderFooter();
    init(opts);
    syncHeaderLayoutMetrics();
  }

  function loadPlatformAccessScript() {
    if (document.querySelector("script[data-erv-platform-access]")) return;
    var s = document.createElement("script");
    s.src = "/assets/platform-access.js";
    s.defer = true;
    s.setAttribute("data-erv-platform-access", "1");
    document.head.appendChild(s);
  }

  function loadAccountDestScript() {
    if (document.querySelector("script[data-erv-account-dest]")) return;
    var s = document.createElement("script");
    s.src = "/assets/account-destinations.js";
    s.defer = true;
    s.setAttribute("data-erv-account-dest", "1");
    document.head.appendChild(s);
  }

  function loadToggleUi(cb) {
    if (global.ErvenowToggle) {
      global.ErvenowToggle.boot();
      if (cb) cb();
      return;
    }
    if (document.querySelector('script[src*="ervenow-toggle.js"]')) {
      if (cb) cb();
      return;
    }
    var s = document.createElement("script");
    s.src = "/assets/ervenow-toggle.js";
    s.async = true;
    s.onload = function () {
      if (global.ErvenowToggle) global.ErvenowToggle.boot();
      if (cb) cb();
    };
    document.head.appendChild(s);
  }

  function ensureCartStyles() {
    if (!document.querySelector('link[href*="cart-luxe.css"]')) {
      var l1 = document.createElement("link");
      l1.rel = "stylesheet";
      l1.href = "/assets/cart-luxe.css";
      document.head.appendChild(l1);
    }
    if (!document.querySelector('link[href*="cart-shell.css"]')) {
      var l2 = document.createElement("link");
      l2.rel = "stylesheet";
      l2.href = "/assets/cart-shell.css";
      document.head.appendChild(l2);
    }
  }

  function mountUnifiedHeaderCart() {
    if (document.getElementById("lpCartWrap")) return;
    var tools = document.querySelector(".dash-site-header__tools");
    var link = tools && tools.querySelector(".dash-header-cart");
    if (tools && link && global.ErvenowCartUI) {
      global.ErvenowCartUI.mountGuestHeaderCart(tools, link);
    }
  }

  function loadCartUi(cb) {
    if (!document.body.classList.contains("guest-shell-page")) {
      if (cb) cb();
      return;
    }
    ensureCartStyles();
    if (global.ErvenowCartUI) {
      mountUnifiedHeaderCart();
      if (cb) cb();
      return;
    }
    if (document.querySelector('script[src*="cart-ui.js"]')) {
      mountUnifiedHeaderCart();
      if (cb) cb();
      return;
    }
    var s = document.createElement("script");
    s.src = "/assets/cart-ui.js";
    s.async = true;
    s.onload = function () {
      mountUnifiedHeaderCart();
      if (cb) cb();
    };
    document.head.appendChild(s);
  }

  function init(opts) {
    opts = opts || {};
    _activeNavKey = opts.activeNav || "";
    if (opts.pageTag) {
      var tag = document.getElementById("guestShellPageTag");
      if (tag) tag.textContent = opts.pageTag;
    }
    paintHeaderNav(_activeNavKey, "", { authenticated: hasToken() });
    paintIndexNav("", { authenticated: hasToken() });
    refreshCartBadge();
    loadToggleUi();
    loadCartUi();
    loadPlatformAccessScript();
    loadAccountDestScript();
    whenPlatformApiReady(function () {
      initAuthHeader();
    });
  }

  function onStorageAuth(ev) {
    if (!ev || !ev.key) return;
    if (TOKEN_STORAGE_KEYS.indexOf(ev.key) === -1 && ev.key !== "ervenow_guest_browse") return;
    whenPlatformApiReady(function () {
      initAuthHeader();
    });
  }

  global.addEventListener("storage", onStorageAuth);
  global.addEventListener("ervenow:auth-changed", function () {
    whenPlatformApiReady(function () {
      initAuthHeader();
    });
  });

  global.ErvenowGuestShell = {
    init: init,
    mountShell: mountShell,
    renderHeader: renderHeader,
    renderFooter: renderFooter,
    buildNavLinks: buildNavLinks,
    paintHeaderNav: paintHeaderNav,
    paintIndexNav: paintIndexNav,
    refreshCartBadge: refreshCartBadge,
    refreshHeaderWallet: refreshHeaderWallet,
    refreshAuthHeader: function () {
      whenPlatformApiReady(function () {
        initAuthHeader();
      });
    },
    setActiveNav: setActiveNav,
  };
})(window);
