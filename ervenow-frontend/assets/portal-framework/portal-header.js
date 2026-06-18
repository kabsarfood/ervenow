/**
 * ERVENOW Portal Framework — PortalHeader (بوابات موحّدة)
 */
(function (global) {
  "use strict";

  var RC = function () {
    return global.ErvenowPortalFramework && ErvenowPortalFramework.RoleContext;
  };

  function esc(s) {
    var r = RC();
    return r ? r.esc(s) : String(s || "");
  }

  function renderPortalHeader(opts) {
    opts = opts || {};
    var portalTitle = opts.portalTitle || opts.roleLabel || "بوابة ERVENOW";
    var homeHref = opts.homeHref || "/";
    var walletHref = opts.walletHref || homeHref + "#wallet";
    var walletHtml = opts.hideWalletInHeader
      ? ""
      : '<a class="pf-header__tool-btn pf-header__wallet" href="' +
        esc(walletHref) +
        '" data-pf-section="wallet" aria-label="المحفظة">' +
        '<span class="pf-header__tool-icon" aria-hidden="true">💳</span></a>';
    return (
      '<div class="pf-header__start">' +
      '<a class="pf-header__logo pf-header__logo--portal" href="' +
      esc(homeHref) +
      '">' +
      '<span class="pf-header__platform-dot" aria-hidden="true"></span>ERVENOW</a></div>' +
      '<div class="pf-header__center" aria-label="البوابة">' +
      '<span class="pf-header__center-brand">ERVENOW</span>' +
      '<span class="pf-header__center-title" data-pf-field="portal-title">' +
      esc(portalTitle) +
      "</span></div>" +
      '<div class="pf-header__tools">' +
      '<span data-pf-notifications aria-hidden="true"></span>' +
      '<button type="button" class="pf-menu-btn pf-menu-btn--portal" data-pf-action="open-sidebar" aria-label="فتح القائمة">☰</button>' +
      walletHtml +
      "</div>"
    );
  }

  function renderHtml(opts) {
    opts = opts || {};
    if (opts.layout === "portal" || opts.layout === "operational") {
      return renderPortalHeader(opts);
    }
    var extras = opts.toolsHtml || "";
    return (
      '<div class="pf-header__left">' +
      '<button type="button" class="pf-menu-btn" data-pf-action="open-sidebar" aria-label="فتح القائمة">☰</button>' +
      '<a class="pf-header__logo" href="/">ERVENOW</a>' +
      '<div class="pf-header__meta">' +
      '<span class="pf-header__name" data-pf-field="name">' +
      esc(opts.name || "—") +
      "</span>" +
      (opts.subtitle != null
        ? '<span class="pf-header__sub" data-pf-field="subtitle">' + esc(opts.subtitle) + "</span>"
        : "") +
      (opts.roleLabel
        ? '<span class="pf-header__role" data-pf-field="role">' + esc(opts.roleLabel) + "</span>"
        : "") +
      "</div></div>" +
      '<div class="pf-header__tools">' +
      extras +
      '<span data-pf-notifications aria-hidden="true"></span>' +
      '<span class="pf-avatar" data-pf-field="avatar" aria-hidden="true">' +
      esc(opts.avatarText || "؟") +
      "</span></div>"
    );
  }

  function mount(headerEl, opts) {
    if (!headerEl) return null;
    var isPortal = opts.layout === "portal" || opts.layout === "operational";
    headerEl.className = "pf-header" + (isPortal ? " pf-header--portal" : "");
    if (opts.portalRole) headerEl.setAttribute("data-pf-portal", String(opts.portalRole));
    headerEl.innerHTML = renderHtml(opts);
    return {
      el: headerEl,
      update: function (data) {
        update(headerEl, data, opts);
      },
    };
  }

  function update(headerEl, data, mountOpts) {
    if (!headerEl || !data) return;
    mountOpts = mountOpts || {};
    var portalTitleEl = headerEl.querySelector('[data-pf-field="portal-title"]');
    if (portalTitleEl && data.portalTitle != null) portalTitleEl.textContent = data.portalTitle;
    var portalLogo = headerEl.querySelector(".pf-header__logo--portal");
    if (portalLogo && data.homeHref != null) portalLogo.setAttribute("href", data.homeHref);
    var walletBtn = headerEl.querySelector(".pf-header__wallet");
    if (walletBtn && data.walletHref != null) walletBtn.setAttribute("href", data.walletHref);

    var nameEl = headerEl.querySelector('[data-pf-field="name"]');
    if (nameEl && data.name != null) nameEl.textContent = data.name;
    var subEl = headerEl.querySelector('[data-pf-field="subtitle"]');
    if (subEl && data.subtitle != null) subEl.textContent = data.subtitle;
    var roleEl = headerEl.querySelector('[data-pf-field="role"]');
    if (roleEl && data.roleLabel != null) roleEl.textContent = data.roleLabel;
    var av = headerEl.querySelector('[data-pf-field="avatar"]');
    if (av) {
      if (data.avatarUrl) {
        av.innerHTML =
          '<img src="' + esc(data.avatarUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />';
      } else if (data.avatarText != null) {
        av.textContent = data.avatarText;
      }
    }
    var tools = headerEl.querySelector(".pf-header__tools");
    if (tools && data.toolsHtml != null && !headerEl.classList.contains("pf-header--portal")) {
      var notifHost = tools.querySelector("[data-pf-notifications]");
      var notifHtml = notifHost ? notifHost.outerHTML : '<span data-pf-notifications aria-hidden="true"></span>';
      var avHtml = av ? av.outerHTML : '<span class="pf-avatar" data-pf-field="avatar">؟</span>';
      tools.innerHTML = data.toolsHtml + notifHtml + avHtml;
      if (data.name != null || data.avatarText != null) update(headerEl, data, mountOpts);
    }
  }

  function getNotificationHost(headerEl) {
    return headerEl ? headerEl.querySelector("[data-pf-notifications]") : null;
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalHeader = {
    mount: mount,
    update: update,
    renderHtml: renderHtml,
    getNotificationHost: getNotificationHost,
  };
})(typeof window !== "undefined" ? window : global);
