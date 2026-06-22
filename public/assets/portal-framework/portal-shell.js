/**
 * ERVENOW Portal Framework v1 — PortalShell
 * Header · Sidebar · Content · Mobile Drawer · Overlay
 */
(function (global) {
  "use strict";

  var PF = function () {
    return global.ErvenowPortalFramework || {};
  };

  var PORTAL_LOGIN_URLS = {
    driver: "/driver-login",
    merchant: "/login?role=store",
    store: "/login?role=store",
    service: "/service-provider-login",
    transport: "/service-provider-login",
    customer: "/login?role=customer",
    admin: "/login?role=admin",
  };

  function loginUrlForRole(role, config) {
    if (config && config.loginUrl) return String(config.loginUrl);
    return PORTAL_LOGIN_URLS[String(role || "").toLowerCase()] || "/login";
  }

  function performPortalLogout(loginUrl) {
    var finish = function () {
      try {
        if (global.ErvenowAuthGuard && typeof global.ErvenowAuthGuard.clearSession === "function") {
          global.ErvenowAuthGuard.clearSession();
        }
      } catch (_) {}
      try {
        global.__ervSessionMe = null;
      } catch (_) {}
      try {
        global.dispatchEvent(new CustomEvent("ervenow:auth-changed"));
      } catch (_) {}
      global.location.replace(loginUrl || "/login");
    };

    try {
      if (
        global.ErvenowOrderDraft &&
        typeof global.ErvenowOrderDraft.prepareLogoutDraftState === "function"
      ) {
        global.ErvenowOrderDraft.prepareLogoutDraftState().then(finish).catch(finish);
        return;
      }
    } catch (_) {}
    finish();
  }

  function createShell(options) {
    options = options || {};
    if (options.showHeader == null) options.showHeader = true;
    if (options.showBottomNav == null) {
      options.showBottomNav = !!options.operationalV2;
    }
    var state = {
      role: options.role || "customer",
      config: null,
      activeSection: options.defaultSection || null,
      mounted: false,
      onNavigate: typeof options.onNavigate === "function" ? options.onNavigate : null,
      hashBase: options.hashBase || "",
      notifKey: options.notifKey || null,
      notifOpsApi: null,
    };

    var els = {
      app: null,
      overlay: null,
      sidebar: null,
      header: null,
      notifHost: null,
      main: null,
      msg: null,
      sidebarApi: null,
      headerApi: null,
    };

    function esc(s) {
      var rc = PF().RoleContext;
      return rc ? rc.esc(s) : String(s || "");
    }

    function resolveConfig() {
      var rc = PF().RoleContext;
      if (!rc) throw new Error("RoleContext غير محمّل");
      state.config = options.config || rc.getConfig(state.role);
      if (!state.config) throw new Error("تكوين البوابة غير معروف: " + state.role);
      if (!state.activeSection) state.activeSection = state.config.defaultSection || "dashboard";
      PF().ThemeEngine.apply(state.config.theme || state.role);
      if (options.operationalV2 && document.body) {
        document.body.classList.add("pf-page--ops");
      }
      if (document.body && !document.body.classList.contains("pf-page")) {
        document.body.classList.add("pf-page");
      }
      if (document.documentElement) {
        document.documentElement.classList.add("erv-mobile-no-nav");
      }
      var platformNav = document.getElementById("ervMobileBottomNav");
      if (platformNav && platformNav.parentNode) platformNav.parentNode.removeChild(platformNav);
    }

    function buildDom() {
      var app =
        typeof options.app === "string"
          ? document.querySelector(options.app)
          : options.app && options.app.nodeType === 1
            ? options.app
            : document.getElementById("pfApp");
      if (!app) throw new Error("حاوية البوابة غير موجودة");
      els.app = app;
      els.app.innerHTML =
        '<div class="pf-overlay" data-pf-overlay aria-hidden="true"></div>' +
        '<div class="pf-shell' +
        (options.showBottomNav ? " pf-shell--bottom-nav" : "") +
        (options.showHeader === false ? " pf-shell--no-header" : "") +
        '">' +
        '<aside data-pf-sidebar></aside>' +
        '<div class="pf-main-wrap">' +
        (options.showHeader === false
          ? '<span data-pf-notifications class="pf-notifications-host" hidden aria-hidden="true"></span>'
          : '<header data-pf-header></header>') +
        '<main class="pf-content" aria-live="polite">' +
        '<div class="pf-msg" data-pf-msg hidden></div>' +
        '<div data-pf-main></div>' +
        "</main>" +
        '<div data-pf-footer></div>' +
        "</div></div>" +
        (options.showBottomNav ? '<nav class="pf-bottom-nav" data-pf-bottom-nav aria-label="التنقل التشغيلي"></nav>' : "") +
        "";
      els.overlay = els.app.querySelector("[data-pf-overlay]");
      els.sidebar = els.app.querySelector("[data-pf-sidebar]");
      els.header = els.app.querySelector("[data-pf-header]");
      els.notifHost = els.app.querySelector("[data-pf-notifications]");
      els.main = els.app.querySelector("[data-pf-main]");
      els.msg = els.app.querySelector("[data-pf-msg]");

      els.sidebarApi = PF().PortalSidebar.mount(els.sidebar, state.config, {
        sidebarName: options.sidebarName || "—",
        ariaLabel: options.sidebarAriaLabel,
      });
      if (options.showHeader !== false && els.header) {
        var walletHref =
          options.walletHref ||
          (options.hashBase ? options.hashBase + "#wallet" : "/wallet");
        els.headerApi = PF().PortalHeader.mount(els.header, {
          layout: "portal",
          portalRole: state.role,
          portalTitle: options.portalTitle || (PF().Operational && PF().Operational.portalTitle(state.role)),
          homeHref: options.hashBase || "/",
          walletHref: walletHref,
          hideWalletInHeader: !!options.showBottomNav,
          name: options.headerName || "—",
          subtitle: options.headerSubtitle,
          roleLabel: state.config.roleLabel,
          avatarText: options.avatarText || "؟",
          toolsHtml: options.headerToolsHtml || "",
        });
      }
      if (options.showBottomNav) {
        mountBottomNav();
      }
      mountFooter();
    }

    function mountFooter() {
      var host = els.app && els.app.querySelector("[data-pf-footer]");
      if (!host || !PF().PortalFooter) return;
      host.innerHTML = PF().PortalFooter.renderHtml({
        roleLabel: state.config && state.config.roleLabel,
        portalTitle: options.portalTitle,
      });
    }

    function mountBottomNav() {
      var navEl = els.app.querySelector("[data-pf-bottom-nav]");
      if (!navEl) return;
      var items =
        options.bottomNav ||
        (PF().Operational && PF().Operational.bottomNavForRole
          ? PF().Operational.bottomNavForRole(state.role)
          : []);
      navEl.innerHTML = items
        .map(function (item) {
          return (
            '<button type="button" class="pf-bottom-nav__btn" data-pf-bottom="' +
            esc(item.id) +
            '" data-pf-bottom-section="' +
            esc(item.section || "") +
            '" data-pf-bottom-action="' +
            esc(item.action || "") +
            '">' +
            '<span class="pf-bottom-nav__icon" aria-hidden="true">' +
            esc(item.icon || "•") +
            "</span>" +
            '<span class="pf-bottom-nav__label">' +
            esc(item.label || "") +
            "</span></button>"
          );
        })
        .join("");
    }

    function syncBottomNav(sectionId) {
      if (!options.showBottomNav || !els.app) return;
      var navEl = els.app.querySelector("[data-pf-bottom-nav]");
      if (!navEl) return;
      navEl.querySelectorAll(".pf-bottom-nav__btn").forEach(function (btn) {
        var sec = btn.getAttribute("data-pf-bottom-section");
        btn.classList.toggle("is-active", !!sec && sec === sectionId);
      });
    }

    function wireEvents() {
      if (!els.app) return;
      els.app.addEventListener("click", function (ev) {
        var walletBtn = ev.target.closest(".pf-header__wallet[data-pf-section]");
        if (walletBtn) {
          ev.preventDefault();
          navigate(walletBtn.getAttribute("data-pf-section") || "wallet");
          return;
        }
        var bottomBtn = ev.target.closest("[data-pf-bottom]");
        if (bottomBtn) {
          ev.preventDefault();
          var action = bottomBtn.getAttribute("data-pf-bottom-action");
          if (action === "notifications") {
            if (state.notifOpsApi && state.notifOpsApi.open) {
              state.notifOpsApi.open();
            } else {
              navigate("notifications");
            }
            return;
          }
          var bsec = bottomBtn.getAttribute("data-pf-bottom-section");
          if (bsec) navigate(bsec);
          return;
        }
        var openBtn = ev.target.closest('[data-pf-action="open-sidebar"]');
        if (openBtn) {
          ev.preventDefault();
          toggleSidebar();
          return;
        }
        var logoutBtn = ev.target.closest('[data-pf-action="logout"]');
        if (logoutBtn) {
          ev.preventDefault();
          closeSidebar();
          performPortalLogout(
            options.loginUrl || loginUrlForRole(state.role, state.config)
          );
          return;
        }
        var locBtn = ev.target.closest('[data-pf-action="set-location"]');
        if (locBtn) {
          ev.preventDefault();
          if (global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.captureAndSave) {
            ErvenowPortalProviderLocation.captureAndSave(state.role)
              .then(function () {
                showMessage("تم تفعيل موقعك — يمكنك الآن استقبال الطلبات", true);
                closeSidebar();
              })
              .catch(function (e) {
                if (ErvenowPortalProviderLocation.offerManualFallback) {
                  ErvenowPortalProviderLocation.offerManualFallback(state.role)
                    .then(function () {
                      showMessage("تم حفظ موقعك يدوياً", true);
                      closeSidebar();
                    })
                    .catch(function (e2) {
                      if (String((e2 && e2.message) || "") !== "تم الإلغاء") {
                        showMessage((e2 && e2.message) || (e && e.message) || "تعذّر تحديد الموقع", false);
                      }
                    });
                } else {
                  showMessage((e && e.message) || "تعذّر تحديد الموقع", false);
                }
              });
          } else {
            showMessage("خدمة تحديد الموقع غير متاحة", false);
          }
          return;
        }
        var locManualBtn = ev.target.closest('[data-pf-action="set-location-manual"]');
        if (locManualBtn) {
          ev.preventDefault();
          if (global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.offerManualFallback) {
            ErvenowPortalProviderLocation.offerManualFallback(state.role)
              .then(function () {
                showMessage("تم حفظ موقعك", true);
                closeSidebar();
              })
              .catch(function (e) {
                if (String((e && e.message) || "") !== "تم الإلغاء") {
                  showMessage((e && e.message) || "تعذّر حفظ الموقع", false);
                }
              });
          }
          return;
        }
        var navBtn = ev.target.closest("[data-pf-section]");
        if (navBtn && navBtn.closest("[data-pf-nav]")) {
          ev.preventDefault();
          navigate(navBtn.getAttribute("data-pf-section"));
          return;
        }
        var quickBtn = ev.target.closest("[data-pf-section]");
        if (quickBtn && quickBtn.closest("[data-pf-main]")) {
          if (quickBtn.tagName === "BUTTON" || quickBtn.getAttribute("href") === "#") {
            ev.preventDefault();
            navigate(quickBtn.getAttribute("data-pf-section"));
          }
        }
      });
      if (els.overlay) els.overlay.onclick = closeSidebar;
      global.addEventListener("hashchange", onHashChange);
    }

    function onHashChange() {
      var hash = (global.location.hash || "").replace(/^#/, "");
      var rc = PF().RoleContext;
      if (hash && rc && rc.isValidSection(state.role, hash) && hash !== state.activeSection) {
        state.activeSection = hash;
        if (state.onNavigate) state.onNavigate(hash, api);
        else renderNav();
      }
    }

    function updateMenuBtn(open) {
      if (!els.app) return;
      var btn = els.app.querySelector('[data-pf-action="open-sidebar"]');
      if (!btn) return;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
    }

    function setSidebarOpen(open) {
      if (els.sidebar) els.sidebar.classList.toggle("is-open", !!open);
      if (els.overlay) {
        els.overlay.classList.toggle("is-open", !!open);
        els.overlay.setAttribute("aria-hidden", open ? "false" : "true");
      }
      if (document.body) document.body.classList.toggle("pf-sidebar-open", !!open);
      updateMenuBtn(!!open);
    }

    function openSidebar() {
      setSidebarOpen(true);
    }

    function closeSidebar() {
      setSidebarOpen(false);
    }

    function toggleSidebar() {
      var open = !!(els.sidebar && els.sidebar.classList.contains("is-open"));
      setSidebarOpen(!open);
    }

    function syncSidebarInitialState() {
      var wide = global.matchMedia && global.matchMedia("(min-width: 1025px)").matches;
      setSidebarOpen(!!wide);
    }

    function navigate(section) {
      if (!section) return;
      var item = (state.config.nav || []).find(function (n) {
        return n && n.id === section;
      });
      if (item && item.external && item.href) {
        global.location.href = item.href;
        return;
      }
      state.activeSection = section;
      closeSidebar();
      renderNav();
      syncBottomNav(section);
      if (state.hashBase) {
        try {
          global.history.replaceState(null, "", state.hashBase + "#" + section);
        } catch (_) {}
      }
      if (state.onNavigate) state.onNavigate(section, api);
    }

    function renderNav() {
      if (els.sidebarApi) els.sidebarApi.renderNav(state.activeSection);
    }

    function setContent(html) {
      if (els.main) els.main.innerHTML = html;
    }

    function showMessage(text, ok) {
      if (!els.msg) return;
      if (!text) {
        els.msg.hidden = true;
        els.msg.textContent = "";
        return;
      }
      els.msg.className = "pf-msg " + (ok ? "ok" : "err");
      els.msg.textContent = text;
      els.msg.hidden = false;
    }

    function updateHeader(data) {
      if (els.headerApi) els.headerApi.update(data || {});
      if (data && data.sidebarName != null && els.sidebarApi) {
        els.sidebarApi.setSidebarName(data.sidebarName);
      }
    }

    function mountNotifications() {
      var host =
        els.notifHost || (els.header ? PF().PortalHeader.getNotificationHost(els.header) : null);
      if (!host) return Promise.resolve(null);
      if (host.getAttribute("data-mounted") === "1") return Promise.resolve(state.notifOpsApi || null);
      host.setAttribute("data-mounted", "1");
      if (
        options.operationalV2 &&
        PF().PortalNotificationsOps &&
        (options.onAcceptOrder || options.onReserveBooking)
      ) {
        state.notifOpsApi = PF().PortalNotificationsOps.mount(host, {
          onAcceptOrder: options.onAcceptOrder,
          onReserveBooking: options.onReserveBooking,
          onDetails: options.onNotificationDetails,
        });
        return Promise.resolve(state.notifOpsApi);
      }
      if (!global.ErvenowNotificationCenter) return Promise.resolve(null);
      var key = state.notifKey || state.role + "-portal-header";
      return ErvenowNotificationCenter.mount({ mount: host, key: key });
    }

    function showApp() {
      if (els.app) els.app.hidden = false;
      var login = options.loginEl
        ? typeof options.loginEl === "string"
          ? document.querySelector(options.loginEl)
          : options.loginEl
        : null;
      if (login) login.hidden = true;
    }

    function mountChrome() {
      if (state.mounted) return api;
      resolveConfig();
      buildDom();
      wireEvents();
      parseInitialHash();
      renderNav();
      syncBottomNav(state.activeSection);
      syncSidebarInitialState();
      state.mounted = true;
      if (els.app) els.app.hidden = false;
      return api;
    }

    function showLogin() {
      if (options.showHeader !== false) {
        if (els.app) els.app.hidden = false;
      } else if (els.app) {
        els.app.hidden = true;
      }
      var login = options.loginEl
        ? typeof options.loginEl === "string"
          ? document.querySelector(options.loginEl)
          : options.loginEl
        : null;
      if (login) login.hidden = false;
    }

    function parseInitialHash() {
      var hash = (global.location.hash || "").replace(/^#/, "");
      var rc = PF().RoleContext;
      if (hash && rc && rc.isValidSection(state.role, hash)) state.activeSection = hash;
    }

    var api = {
      mount: function () {
        return mountChrome();
      },
      mountChrome: mountChrome,
      navigate: navigate,
      renderNav: renderNav,
      setContent: setContent,
      showMessage: showMessage,
      updateHeader: updateHeader,
      openSidebar: openSidebar,
      closeSidebar: closeSidebar,
      toggleSidebar: toggleSidebar,
      mountNotifications: mountNotifications,
      showApp: showApp,
      showLogin: showLogin,
      getConfig: function () {
        return state.config;
      },
      getRole: function () {
        return state.role;
      },
      getActiveSection: function () {
        return state.activeSection;
      },
      setActiveSection: function (id) {
        state.activeSection = id;
        renderNav();
      },
      getWidgets: function () {
        return PF().PortalWidgets;
      },
      getEls: function () {
        return els;
      },
      getMainEl: function () {
        return els.main;
      },
    };

    return api;
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalShell = { create: createShell };
  global.ErvenowPortalFramework.version = "2.1.2-portal-logout";
})(typeof window !== "undefined" ? window : global);
