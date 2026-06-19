/**
 * ERVENOW Portal Framework v1 — PortalSidebar
 * Config-driven navigation — items come from RoleContext, not hardcoded in portals.
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

  function renderFoot(links) {
    if (!links || !links.length) return "";
    var items = links
      .map(function (l, i) {
        var sep = i < links.length - 1 ? " · " : "";
        return '<a href="' + esc(l.href) + '">' + esc(l.label) + "</a>" + sep;
      })
      .join("");
    return (
      '<div class="pf-sidebar__foot">' +
      '<p style="margin:0 0 6px">بوابات كلاسيكية:</p>' +
      items +
      "</div>"
    );
  }

  function renderLogoutNavItem() {
    return (
      '<button type="button" class="pf-nav__item pf-nav__item--logout pf-nav__item--no-icon" data-pf-action="logout" title="تسجيل الخروج">' +
      "<span>خروج</span></button>"
    );
  }

  function renderNavItems(navItems, activeSection) {
    return (
      (navItems || [])
        .map(function (item) {
          if (!item) return "";
          if (item.href) {
            return (
              '<a class="pf-nav__item" href="' +
              esc(item.href) +
              '"><span class="pf-nav__icon" aria-hidden="true">' +
              esc(item.icon) +
              "</span><span>" +
              esc(item.label) +
              "</span></a>"
            );
          }
          var active = item.id === activeSection;
          return (
            '<button type="button" class="pf-nav__item' +
            (active ? " is-active" : "") +
            '" data-pf-section="' +
            esc(item.id) +
            '" title="' +
            esc(item.en || item.label) +
            '"><span class="pf-nav__icon" aria-hidden="true">' +
            esc(item.icon) +
            "</span><span>" +
            esc(item.label) +
            "</span></button>"
          );
        })
        .join("") + renderLogoutNavItem()
    );
  }

  function mount(sidebarEl, config, opts) {
    opts = opts || {};
    if (!sidebarEl || !config) return null;
    sidebarEl.className = "pf-sidebar";
    sidebarEl.setAttribute("aria-label", opts.ariaLabel || "قائمة البوابة");
    sidebarEl.innerHTML =
      '<p class="pf-sidebar__brand">' +
      esc(config.brand || "ERVENOW") +
      '</p><p class="pf-sidebar__name" data-pf-field="sidebar-name">' +
      esc(opts.sidebarName || "—") +
      '</p><nav class="pf-nav" data-pf-nav></nav>' +
      renderFoot(config.sidebarFoot);
    return {
      el: sidebarEl,
      renderNav: function (activeSection) {
        renderNav(sidebarEl, config.nav, activeSection);
      },
      setSidebarName: function (name) {
        var el = sidebarEl.querySelector('[data-pf-field="sidebar-name"]');
        if (el) el.textContent = name || "—";
      },
    };
  }

  function renderNav(sidebarEl, navItems, activeSection) {
    var nav = sidebarEl ? sidebarEl.querySelector("[data-pf-nav]") : null;
    if (!nav) return;
    nav.innerHTML = renderNavItems(navItems, activeSection);
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalSidebar = {
    mount: mount,
    renderNav: renderNav,
    renderNavItems: renderNavItems,
    renderFoot: renderFoot,
  };
})(typeof window !== "undefined" ? window : global);
