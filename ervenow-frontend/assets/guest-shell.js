(function (global) {
  var NAV_LINKS = [
    { key: "guest", href: "/dashboard", label: "لوحة الزائر" },
    { key: "restaurants", href: "/restaurants", label: "مطاعم" },
    { key: "stores", href: "/stores", label: "متاجر" },
    { key: "delivery", href: "/delivery-services.html", label: "توصيل" },
    { key: "services", href: "/services", label: "خدمات" },
    { key: "home", href: "/", label: "الرئيسية" },
  ];

  var TOKEN_STORAGE_KEYS = ["ervenow_access_token", "erwenow_access_token", "token"];

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
    switchAccount.className = "dash-site-header__btn dash-site-header__btn--primary";
    switchAccount.setAttribute("href", "/login?role=customer");
    switchAccount.removeAttribute("aria-label");
  }

  function setAccountButtonLoggedIn(switchAccount, role) {
    if (!switchAccount) return;
    role = String(role || "customer").toLowerCase();
    switchAccount.style.display = "";
    switchAccount.textContent = "حسابي";
    switchAccount.className = "dash-site-header__btn dash-site-header__btn--primary";
    switchAccount.setAttribute("aria-label", "الانتقال إلى لوحة حسابك");
    if (role === "driver") switchAccount.setAttribute("href", "/driver");
    else if (role === "merchant" || role === "restaurant") switchAccount.setAttribute("href", "/store-dashboard");
    else if (role === "service") switchAccount.setAttribute("href", "/services-provider.html");
    else if (role === "admin") switchAccount.setAttribute("href", "/admin");
    else switchAccount.setAttribute("href", "/dashboard");
  }

  async function initAuthHeader() {
    var switchAccount = document.getElementById("switchAccount");
    if (!hasToken()) {
      setAccountButtonLoggedOut(switchAccount);
      await refreshHeaderWallet("");
      return;
    }
    syncGuestBrowseMode();
    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      var role = (me.profile && me.profile.role) || "customer";
      setAccountButtonLoggedIn(switchAccount, role);
      await refreshHeaderWallet(role);
    } catch (e) {
      setAccountButtonLoggedIn(switchAccount, "customer");
      await refreshHeaderWallet("customer");
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
    return (
      '<a class="dash-site-header__link' +
      (on ? " is-active" : "") +
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
    var links = NAV_LINKS.map(function (l) {
      return navLinkHtml(l, activeNav);
    }).join("\n            ");
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
      '<a class="dash-site-header__btn dash-site-header__btn--primary" href="/login?role=customer" id="switchAccount">تسجيل الدخول</a>' +
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
      '<a class="dash-site-footer__link" href="/dashboard#dashDeliveryTitle">طلب من الخريطة</a>' +
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
  }

  function init(opts) {
    opts = opts || {};
    if (opts.pageTag) {
      var tag = document.getElementById("guestShellPageTag");
      if (tag) tag.textContent = opts.pageTag;
    }
    setActiveNav(opts.activeNav || "");
    refreshCartBadge();
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
