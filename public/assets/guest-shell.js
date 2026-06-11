(function (global) {
  var TOKEN_STORAGE_KEYS = ["ervenow_access_token", "erwenow_access_token", "token"];
  var _activeNavKey = "";
  var _storePreviewMode = false;
  var _liveMapPublicEnabled = true;

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
        label: "⚙️ لوحة التحكم",
      });
    } else if (r === "driver" && opts.authenticated) {
      links.push({
        key: "track",
        href: "/driver-app",
        label: "تتبع الحي",
      });
    } else if (opts.liveMapPublicEnabled !== false) {
      links.push({
        key: "live_map",
        href: "/live-map",
        label: "الخريطة الحية",
      });
    }
    if (!opts.authenticated) {
      links.push({
        key: "login",
        href: "/login?role=customer",
        label: "دخول",
        cta: true,
      });
    } else {
      links.push({
        key: "logout",
        href: "#",
        label: "خروج",
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
    if (global.ErvenowOrderDraftBadge && typeof global.ErvenowOrderDraftBadge.enforceCheckoutNav === "function") {
      global.ErvenowOrderDraftBadge.enforceCheckoutNav();
      return;
    }
    if (global.ErvenowOrderDraftBadge && typeof global.ErvenowOrderDraftBadge.sync === "function") {
      global.ErvenowOrderDraftBadge.sync();
      return;
    }
    var badge = document.getElementById("cartCount");
    if (!badge) return;
    badge.setAttribute("data-empty", "true");
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
    var host = document.getElementById("dashHeaderNotifications");
    if (!host || host.getAttribute("data-erv-notif-mounted") === "1") return;
    if (!global.ErvenowNotificationCenter || typeof global.ErvenowNotificationCenter.mount !== "function") {
      setTimeout(mountNotificationCenter, 120);
      return;
    }
    host.setAttribute("data-erv-notif-mounted", "1");
    global.ErvenowNotificationCenter.mount({ mount: host, key: "guest-shell-header" });
  }

  function walletHrefForRole(role) {
    role = String(role || "").toLowerCase();
    if (role === "driver") return "/driver-wallet";
    if (role === "store" || role === "merchant" || role === "restaurant") return "/store-dashboard#wallet";
    return "/wallet.html";
  }

  async function fetchWalletBalanceForRole(role) {
    role = String(role || "").toLowerCase();
    var bal = 0;
    if (role === "driver") {
      var j = await global.PlatformAPI.api("/api/driver/wallet");
      bal = Number(j.balance) || 0;
    } else if (role === "store" || role === "merchant" || role === "restaurant") {
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
    return bal;
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
    box.setAttribute("href", walletHrefForRole(role));
    amountEl.textContent = "…";
    try {
      amountEl.textContent = fmtWalletMoney(await fetchWalletBalanceForRole(role));
    } catch (e) {
      amountEl.textContent = "—";
    }
  }

  async function refreshIndexNavWallet(role) {
    if (indexHasHeaderWallet()) return;
    var box = document.getElementById("lpNavWallet");
    var amountEl = document.getElementById("lpNavWalletAmount");
    if (!box || !amountEl) return;
    role = String(role || "").toLowerCase();
    if (!hasToken() || role === "admin") return;
    box.setAttribute("href", walletHrefForRole(role));
    amountEl.textContent = "…";
    try {
      amountEl.textContent = fmtWalletMoney(await fetchWalletBalanceForRole(role));
    } catch (e) {
      amountEl.textContent = "—";
    }
  }

  function clearGuestSessionState() {
    try {
      if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.clearPlatformDraftState === "function") {
        global.ErvenowOrderDraft.clearPlatformDraftState();
      }
    } catch (_eDraft) {}
    try {
      if (global.ErvenowAuthGuard && typeof global.ErvenowAuthGuard.clearSession === "function") {
        global.ErvenowAuthGuard.clearSession();
      }
    } catch (_e) {}
    try {
      if (global.PlatformAPI && typeof global.PlatformAPI.setToken === "function") {
        global.PlatformAPI.setToken("");
      }
    } catch (_e2) {}
    TOKEN_STORAGE_KEYS.forEach(function (k) {
      try {
        localStorage.removeItem(k);
      } catch (_e3) {}
    });
    try {
      localStorage.removeItem("userId");
      localStorage.removeItem("userPhone");
      localStorage.removeItem("guest");
      localStorage.removeItem("ervenow_guest_browse");
    } catch (_e4) {}
    try {
      if (global.ErvenowGuestBrowse && global.ErvenowGuestBrowse.setActive) {
        global.ErvenowGuestBrowse.setActive(false);
      }
    } catch (_e5) {}
    try {
      document.cookie = "auth_token=; path=/; max-age=0; SameSite=Lax";
    } catch (_e6) {}
  }

  function performGuestLogout() {
    try {
      if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.markSessionEnded === "function") {
        global.ErvenowOrderDraft.markSessionEnded();
      }
    } catch (_eMark) {}

    var finish = function () {
      clearGuestSessionState();
      try {
        global.__ervSessionMe = null;
      } catch (_eMe) {}
      try {
        global.dispatchEvent(new CustomEvent("ervenow:auth-changed"));
      } catch (_e) {}
      if (global.ErvenowOrderDraftBadge && typeof global.ErvenowOrderDraftBadge.enforceCheckoutNav === "function") {
        global.ErvenowOrderDraftBadge.enforceCheckoutNav();
      } else if (global.ErvenowOrderDraftBadge && typeof global.ErvenowOrderDraftBadge.sync === "function") {
        global.ErvenowOrderDraftBadge.sync();
      }
      try {
        global.location.reload();
      } catch (_e2) {
        global.location.href = "/";
      }
    };

    if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.prepareLogoutDraftState === "function") {
      global.ErvenowOrderDraft.prepareLogoutDraftState()
        .then(finish)
        .catch(finish);
      return;
    }
    finish();
  }

  function wireSwitchAccountButton(btn) {
    if (!btn || btn.getAttribute("data-erv-switch-wired") === "1") return;
    btn.setAttribute("data-erv-switch-wired", "1");
    btn.addEventListener("click", function (e) {
      if (btn.getAttribute("data-erv-switch-mode") === "logout") {
        e.preventDefault();
        performGuestLogout();
      }
    });
  }

  function setAccountButtonLoggedOut(switchAccount) {
    if (!switchAccount) return;
    switchAccount.style.display = "";
    switchAccount.textContent = "تسجيل الدخول";
    switchAccount.className =
      "dash-site-header__btn dash-site-header__btn--primary switch-account--nav-only";
    switchAccount.setAttribute("data-erv-switch-mode", "login");
    switchAccount.setAttribute("href", "/login?role=customer");
    switchAccount.removeAttribute("aria-label");
    switchAccount.removeAttribute("title");
    wireSwitchAccountButton(switchAccount);
  }

  function setAccountButtonLoggedIn(switchAccount) {
    if (!switchAccount) return;
    switchAccount.style.display = "";
    switchAccount.textContent = "تسجيل الخروج";
    switchAccount.className =
      "dash-site-header__btn dash-site-header__btn--primary switch-account--logout";
    switchAccount.classList.remove("switch-account--nav-only");
    switchAccount.setAttribute("data-erv-switch-mode", "logout");
    switchAccount.setAttribute("href", "#");
    switchAccount.setAttribute("aria-label", "تسجيل الخروج");
    switchAccount.setAttribute("title", "تسجيل الخروج");
    wireSwitchAccountButton(switchAccount);
  }

  function paintStorePreviewHeader() {
    var nav = document.querySelector(".dash-site-header__nav");
    if (nav) nav.hidden = true;
    var tools = document.querySelector(".dash-site-header__tools");
    if (tools) tools.hidden = true;
    var switchAccount = document.getElementById("switchAccount");
    if (switchAccount) switchAccount.hidden = true;
    var links = document.querySelector(".dash-site-header__links");
    if (links) links.innerHTML = "";
    var logo = document.querySelector(".dash-site-header__logo");
    if (logo) logo.setAttribute("href", "/store-dashboard");
    syncHeaderLayoutMetrics();
  }

  function navOpts(extra) {
    extra = extra && typeof extra === "object" ? extra : {};
    extra.liveMapPublicEnabled = _liveMapPublicEnabled;
    return extra;
  }

  async function fetchLiveMapPublicEnabled() {
    try {
      if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") return _liveMapPublicEnabled;
      var j = await global.PlatformAPI.api("/api/core/live-map-public");
      _liveMapPublicEnabled = !!(j && j.enabled !== false);
    } catch (_e) {
      _liveMapPublicEnabled = true;
    }
    return _liveMapPublicEnabled;
  }

  async function paintNavWithFlags(activeNav, role, opts) {
    await fetchLiveMapPublicEnabled();
    paintHeaderNav(activeNav, role, navOpts(opts));
    paintIndexNav(role, navOpts(opts));
  }

  async function initAuthHeader() {
    if (_storePreviewMode) {
      paintStorePreviewHeader();
      return;
    }
    var switchAccount = document.getElementById("switchAccount");
    if (!hasToken()) {
      setAccountButtonLoggedOut(switchAccount);
      await refreshHeaderWallet("");
      await paintNavWithFlags(_activeNavKey, "", { authenticated: false });
      return;
    }
    syncGuestBrowseMode();
    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      if (global.ErvenowAccountDest && ErvenowAccountDest.setSessionFromMe) {
        ErvenowAccountDest.setSessionFromMe(me);
      }
      if (me && me.user && me.user.id) {
        try {
          localStorage.setItem("userId", String(me.user.id));
        } catch (_uid) {}
        if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.restoreDraftAfterLogin === "function") {
          global.ErvenowOrderDraft.restoreDraftAfterLogin();
        }
      }
      var role = (me.profile && me.profile.role) || "customer";
      role = String(role).toLowerCase();
      var serviceType = me.profile && me.profile.service_type;
      setAccountButtonLoggedIn(switchAccount);
      await refreshHeaderWallet(role);
      await paintNavWithFlags(_activeNavKey, role, { authenticated: true });
      if (role === "driver") {
        document.querySelectorAll(".dash-header-cart").forEach(function (a) {
          a.style.display = "none";
        });
      }
      mountNotificationCenter();
    } catch (e) {
      setAccountButtonLoggedIn(switchAccount);
      await refreshHeaderWallet("customer");
      await paintNavWithFlags(_activeNavKey, "", { authenticated: false });
    }
  }

  function syncHeaderLayoutMetrics() {
    if (global.ErvenowViewport && typeof ErvenowViewport.syncHeaderHeight === "function") {
      ErvenowViewport.syncHeaderHeight();
    }
  }

  /** ترتيب DOM: شعار → أدوات → تنقل (يتوافق مع شبكة الجوال) */
  function normalizeSiteHeaderDomOrder() {
    var inner = document.querySelector(".dash-site-header__inner");
    if (!inner) return;
    var brand = inner.querySelector(".dash-site-header__brand");
    var tools = inner.querySelector(".dash-site-header__tools");
    var nav = inner.querySelector(".dash-site-header__nav");
    var accountBtn =
      inner.querySelector("#switchAccount") ||
      inner.querySelector(".dash-site-header__btn--primary");
    if (!brand || !tools || !nav) return;
    inner.appendChild(brand);
    inner.appendChild(tools);
    inner.appendChild(nav);
    if (accountBtn) inner.appendChild(accountBtn);
    syncHeaderLayoutMetrics();
  }

  function shouldHideNavAuthLink() {
    if (!document.getElementById("switchAccount")) return false;
    try {
      return !window.matchMedia(
        "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))"
      ).matches;
    } catch (e) {
      return true;
    }
  }

  function wireNavLogoutLinks(root) {
    if (!root) return;
    root.querySelectorAll('[data-nav="logout"]').forEach(function (a) {
      if (a.getAttribute("data-erv-logout-wired") === "1") return;
      a.setAttribute("data-erv-logout-wired", "1");
      a.addEventListener("click", function (e) {
        e.preventDefault();
        performGuestLogout();
      });
    });
  }

  function indexHasHeaderWallet() {
    return !!document.getElementById("lpHeaderWallet");
  }

  function buildIndexNavLinks(role, opts) {
    var links = buildNavLinks(role, opts);
    if (
      opts &&
      opts.authenticated &&
      String(role || "").toLowerCase() !== "admin" &&
      !indexHasHeaderWallet()
    ) {
      var i = -1;
      for (var k = 0; k < links.length; k++) {
        if (links[k].key === "logout") {
          i = k;
          break;
        }
      }
      var walletLink = {
        key: "wallet",
        href: walletHrefForRole(role),
        label: "رصيدك",
        walletChip: true,
      };
      if (i >= 0) links.splice(i, 0, walletLink);
      else links.push(walletLink);
    }
    return links;
  }

  function lpNavLinkHtml(link) {
    if (link.walletChip) {
      return (
        '<a class="lp-nav-wallet" id="lpNavWallet" href="' +
        link.href +
        '" data-nav="wallet">' +
        '<span class="lp-nav-wallet__label">رصيدك</span> ' +
        '<span class="lp-nav-wallet__val" id="lpNavWalletAmount">…</span> ' +
        '<span class="lp-nav-wallet__cur">ر.س</span></a>'
      );
    }
    var cls = link.cta ? ' class="lp-nav__cta"' : "";
    var href = link.key === "logout" ? "#" : link.href;
    return (
      '<a href="' +
      href +
      '" data-nav="' +
      link.key +
      '"' +
      cls +
      ">" +
      link.label +
      "</a>"
    );
  }

  function paintHeaderNav(activeNav, role, opts) {
    var box = document.querySelector(".dash-site-header__links");
    if (!box) return;
    var links = buildNavLinks(role, opts);
    if (shouldHideNavAuthLink()) {
      links = links.filter(function (l) {
        return l.key !== "login" && l.key !== "logout";
      });
    }
    box.innerHTML = links
      .map(function (l) {
        return navLinkHtml(l, activeNav || "");
      })
      .join("\n");
    wireNavLogoutLinks(box);
    syncHeaderLayoutMetrics();
  }

  function paintIndexNav(role, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var navLinks = buildIndexNavLinks(role, opts);
    var wrap = document.getElementById("lpNavWrap");
    if (wrap) {
      wrap.innerHTML =
        '<nav class="lp-nav" aria-label="التنقل الرئيسي">' +
        navLinks.map(lpNavLinkHtml).join("") +
        "</nav>";
      wireNavLogoutLinks(wrap);
      if (opts.authenticated) {
        refreshIndexNavWallet(role);
      }
    }
    var mobileQuick = document.getElementById("lpMobileQuickNav");
    if (mobileQuick) {
      mobileQuick.innerHTML = buildNavLinks(role, opts)
        .map(function (l) {
          var href = l.key === "logout" ? "#" : l.href;
          return (
            '<a role="menuitem" class="lp-dd-item' +
            (l.cta ? " lp-dd-item--cta" : "") +
            '" href="' +
            href +
            '" data-nav="' +
            l.key +
            '"><span class="lp-dd-ic" aria-hidden="true">•</span><span class="lp-dd-link__text">' +
            l.label +
            "</span></a>"
          );
        })
        .join("");
      wireNavLogoutLinks(mobileQuick);
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
      '<div class="dash-site-header__tools">' +
      '<div id="dashHeaderNotifications"></div>' +
      '<a class="dash-header-wallet" id="dashHeaderWallet" href="/wallet.html" hidden aria-label="المحفظة">' +
      '<span class="dash-header-wallet__label">محفظة</span>' +
      '<span class="dash-header-wallet__val" id="dashHeaderWalletAmount">—</span>' +
      '<span class="dash-header-wallet__cur">ر.س</span>' +
      "</a>" +
      '<a class="dash-header-cart" href="/checkout" aria-label="تأكيد الطلب — الدفع">' +
      '<span aria-hidden="true">🛒</span>' +
      '<span class="dash-header-cart__label">الطلب</span>' +
      '<span class="dash-header-cart__badge" id="cartCount" data-empty="true">0</span>' +
      "</a>" +
      "</div>" +
      '<nav class="dash-site-header__nav" aria-label="التنقل الرئيسي">' +
      '<div class="dash-site-header__links">' +
      links +
      "</div>" +
      "</nav>" +
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

  function loadDraftBadge(cb) {
    if (!document.body.classList.contains("guest-shell-page")) {
      if (cb) cb();
      return;
    }
    if (global.ErvenowOrderDraftBadge) {
      if (typeof global.ErvenowOrderDraftBadge.enforceCheckoutNav === "function") {
        global.ErvenowOrderDraftBadge.enforceCheckoutNav();
      } else if (typeof global.ErvenowOrderDraftBadge.boot === "function") {
        global.ErvenowOrderDraftBadge.boot();
      } else if (typeof global.ErvenowOrderDraftBadge.sync === "function") {
        global.ErvenowOrderDraftBadge.sync();
      }
      if (cb) cb();
      return;
    }
    if (document.querySelector('script[src*="order-draft-badge.js"]')) {
      if (cb) cb();
      return;
    }
    var s1 = document.createElement("script");
    s1.src = "/assets/order-draft-store.js";
    s1.async = true;
    s1.onload = function () {
      var s2 = document.createElement("script");
      s2.src = "/assets/order-draft-badge.js";
      s2.async = true;
      s2.onload = function () {
        refreshCartBadge();
        if (cb) cb();
      };
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  }

  function ensureMobileFoundation() {
    if (!global.__ervMobileFoundationScript) {
      global.__ervMobileFoundationScript = true;
      var s = document.createElement("script");
      s.src = "/assets/mobile-foundation.js";
      s.defer = true;
      s.onload = function () {
        loadMobileHarmony();
      };
      document.head.appendChild(s);
    } else if (global.ErvenowMobileFoundation) {
      global.ErvenowMobileFoundation.apply();
      loadMobileHarmony();
    }
  }

  function loadMobileHarmony() {
    if (global.__ervMobileHarmonyScript) {
      if (global.ErvenowMobileHarmony) global.ErvenowMobileHarmony.init();
      return;
    }
    global.__ervMobileHarmonyScript = true;
    if (!document.querySelector('link[href*="mobile-harmony.css"]')) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = "/assets/mobile-harmony.css";
      document.head.appendChild(l);
    }
    if (global.ErvenowMobileHarmony) {
      global.ErvenowMobileHarmony.init();
      return;
    }
    var h = document.createElement("script");
    h.src = "/assets/mobile-harmony.js";
    h.defer = true;
    h.onload = function () {
      if (global.ErvenowMobileHarmony) global.ErvenowMobileHarmony.init();
    };
    document.head.appendChild(h);
  }

  function init(opts) {
    opts = opts || {};
    ensureMobileFoundation();
    _storePreviewMode = !!(opts.storePreview || (global.ErvenowStorePreview && ErvenowStorePreview.isActive()));
    normalizeSiteHeaderDomOrder();
    _activeNavKey = opts.activeNav || "";
    if (opts.pageTag) {
      var tag = document.getElementById("guestShellPageTag");
      if (tag) tag.textContent = opts.pageTag;
    }
    if (_storePreviewMode) {
      paintStorePreviewHeader();
      syncHeaderLayoutMetrics();
      return;
    }
    paintNavWithFlags(_activeNavKey, "", { authenticated: hasToken() });
    refreshCartBadge();
    loadToggleUi();
    loadDraftBadge();
    ensureNotificationCenterAssets();
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
    refreshIndexNavWallet: refreshIndexNavWallet,
    performGuestLogout: performGuestLogout,
    clearGuestSessionState: clearGuestSessionState,
    refreshAuthHeader: function () {
      whenPlatformApiReady(function () {
        initAuthHeader();
      });
    },
    syncHeaderLayout: syncHeaderLayoutMetrics,
    normalizeSiteHeaderDomOrder: normalizeSiteHeaderDomOrder,
    setActiveNav: setActiveNav,
  };
})(window);
