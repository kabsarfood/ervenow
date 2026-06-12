(function (global) {
  var NAV = [
    { key: "driver", href: "/driver", label: "لوحة المندوب" },
    { key: "orders", href: "/orders", label: "طلبات المنصة" },
    { key: "home", href: "/", label: "الرئيسية" },
    { key: "track", href: "/driver-app", label: "تتبع الحي" },
  ];

  function navLink(link, active) {
    var on = link.key === active;
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

  function renderHeader(activeNav, pageTag) {
    var links = NAV.map(function (l) {
      return navLink(l, activeNav);
    }).join("\n");
    var tagHtml = pageTag
      ? '<p class="dash-site-header__tag" id="driverShellPageTag">' + escHtml(pageTag) + "</p>"
      : "";
    return (
      '<header class="dash-site-header">' +
      '<div class="dash-site-header__inner">' +
      '<div class="dash-site-header__brand">' +
      '<a class="dash-site-header__logo" href="/">ERVENOW<span class="dash-site-header__logo-dot" aria-hidden="true"></span></a>' +
      tagHtml +
      "</div>" +
      '<nav class="dash-site-header__nav" aria-label="تنقل المندوب">' +
      '<div class="dash-site-header__links">' +
      links +
      "</div></nav>" +
      '<div class="dash-site-header__tools">' +
      '<div id="driverHeaderNotifications"></div>' +
      '<a class="drv-tool-balance" id="drvHeaderBalance" href="/driver-wallet" hidden aria-label="الرصيد">' +
      '<span class="drv-tool-balance__label">الرصيد</span>' +
      '<span class="drv-tool-balance__val" id="drvHeaderBalanceAmount">—</span>' +
      '<span class="drv-tool-balance__cur">ر.س</span></a>' +
      "</div>" +
      '<a class="dash-site-header__btn dash-site-header__btn--primary" href="/driver-login" id="driverLogout">خروج</a>' +
      "</div></header>"
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
    if (!global.PlatformAPI || !PlatformAPI.getToken || !PlatformAPI.getToken()) return;
    var host = document.getElementById("driverHeaderNotifications");
    if (!host || host.getAttribute("data-erv-notif-mounted") === "1") return;
    if (!global.ErvenowNotificationCenter || typeof global.ErvenowNotificationCenter.mount !== "function") {
      setTimeout(mountNotificationCenter, 120);
      return;
    }
    host.setAttribute("data-erv-notif-mounted", "1");
    global.ErvenowNotificationCenter.mount({ mount: host, key: "driver-shell-header" });
  }

  function renderHero(opts) {
    opts = opts || {};
    var eyebrow = opts.eyebrow != null ? String(opts.eyebrow) : "شريك التوصيل";
    var title = opts.title != null ? String(opts.title).trim() : "";
    var sub = opts.sub != null ? String(opts.sub).trim() : "";
    var labelledBy = title ? "driverHeroTitle" : "driverHeroEyebrow";
    var eyebrowCls = "guest-section-hero__eyebrow";
    if (opts.eyebrowLarge) eyebrowCls += " driver-hero-eyebrow--lg";
    var html =
      '<section class="guest-section-hero" aria-labelledby="' +
      labelledBy +
      '">' +
      '<div class="guest-section-hero__inner">' +
      '<p class="' +
      eyebrowCls +
      '" id="driverHeroEyebrow">' +
      escHtml(eyebrow) +
      "</p>";
    if (title) {
      html += '<h1 class="guest-section-hero__title" id="driverHeroTitle">' + escHtml(title) + "</h1>";
    }
    if (sub) {
      html += '<p class="guest-section-hero__sub">' + escHtml(sub) + "</p>";
    }
    html += "</div></section>";
    return html;
  }

  function renderFooter() {
    return "";
  }

  async function refreshBalanceChip() {
    var box = document.getElementById("drvHeaderBalance");
    var el = document.getElementById("drvHeaderBalanceAmount");
    if (!box || !el || !global.PlatformAPI || !PlatformAPI.getToken()) return;
    box.hidden = false;
    el.textContent = "…";
    try {
      var j = await PlatformAPI.api("/api/driver/wallet");
      var bal = Number(j.balance) || 0;
      el.textContent = bal.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      el.textContent = "—";
    }
  }

  function wireLogout() {
    var btn = document.getElementById("driverLogout");
    if (!btn || btn.getAttribute("data-wired")) return;
    btn.setAttribute("data-wired", "1");
    btn.addEventListener("click", function (e) {
      if (btn.getAttribute("href") !== "/driver-login") return;
      e.preventDefault();
      if (global.PlatformAPI && PlatformAPI.setToken) PlatformAPI.setToken("");
      location.href = "/driver-login";
    });
  }

  function mount(opts) {
    opts = opts || {};
    var headerMount = document.getElementById("driverShellHeader");
    var heroMount = document.getElementById("driverShellHero");
    var footerMount = document.getElementById("driverShellFooter");
    if (headerMount) headerMount.outerHTML = renderHeader(opts.activeNav || "driver", opts.pageTag);
    if (heroMount && opts.hero !== false) heroMount.outerHTML = renderHero(opts.hero || {});
    if (footerMount) footerMount.outerHTML = renderFooter();
    ensureNotificationCenterAssets();
    wireLogout();
    if (!document.querySelector("script[data-erv-platform-access]")) {
      var ps = document.createElement("script");
      ps.src = "/assets/platform-access.js";
      ps.defer = true;
      ps.setAttribute("data-erv-platform-access", "1");
      document.head.appendChild(ps);
    }
    if (global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken()) {
      refreshBalanceChip();
      mountNotificationCenter();
    }
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  /** بطاقة طلب — رقم الطلب بارز فوق المحتوى */
  function orderCardHtml(o, opts) {
    opts = opts || {};
    var num =
      (o.order_number && String(o.order_number).trim()) ||
      (o.id && String(o.id).slice(0, 8) + "…") ||
      "—";
    var status = opts.statusLabel || o._statusLabel || "";
    var body = opts.bodyHtml || "";
    var actions = opts.actionsHtml || "";
    return (
      '<article class="drv-order-card">' +
      '<div class="drv-order-card__ribbon">' +
      '<span class="drv-order-card__num" translate="no">' +
      escHtml(num) +
      "</span>" +
      (status ? '<span class="drv-order-card__status">' + escHtml(status) + "</span>" : "") +
      "</div>" +
      '<div class="drv-order-card__body">' +
      body +
      "</div>" +
      (actions ? '<div class="drv-order-card__actions">' + actions + "</div>" : "") +
      "</article>"
    );
  }

  global.ErvenowDriverNav = {
    mount: mount,
    renderHeader: renderHeader,
    renderHero: renderHero,
    renderFooter: renderFooter,
    refreshBalanceChip: refreshBalanceChip,
    orderCardHtml: orderCardHtml,
    escHtml: escHtml,
  };
})(window);
