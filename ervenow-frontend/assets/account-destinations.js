/**
 * توجيه «حسابي» / رقم الجوال في الهيدر.
 * يستهلك ErvenowRoleRouting — لا خريطة وجهات مستقلة.
 */
(function (global) {
  var SERVICE_HOME_LABELS = {
    plumber: "لوحة السباك",
    electrician: "لوحة الكهربائي",
    ac_technician: "لوحة فني المكيفات",
    nursery: "لوحة المشتل",
    cleaning: "لوحة الغسيل",
    pickup_truck: "لوحة الونيت",
    furniture_move: "لوحة نقل الأثاث",
    vehicle_transfer: "لوحة نقل المركبات",
    car_transport: "لوحة نقل المركبات",
    gas_cylinder_swap: "لوحة تبديل أسطوانة الغاز",
    gas_central_refill: "لوحة تعبئة الغاز المركزي",
    gas_delivery: "لوحة توصيل الغاز",
    car_polishing: "لوحة تلميع المركبات",
    service: "لوحة مزود الخدمة",
    internal_delivery: "لوحة شريك التوصيل",
  };

  var PORTAL_SHORT = {
    customer: "عضو ERVENOW",
    merchant: "شريك تجاري",
    driver: "شريك توصيل",
    service: "شريك خدمات",
    transport: "شريك نقل",
    admin: "الإدارة",
    blocked: "الدعم",
  };

  function routing() {
    return global.ErvenowRoleRouting || null;
  }

  function fallbackPath(portalRole) {
    var r = String(portalRole || "customer").toLowerCase();
    if (r === "merchant") return "/merchant-dashboard#home";
    if (r === "driver") return "/driver-preview";
    if (r === "service") return "/service-preview";
    if (r === "transport") return "/transport-preview";
    if (r === "admin") return "/admin-dashboard";
    if (r === "blocked") return "/blocked-complaints";
    return "/";
  }

  function normalizeRole(role) {
    var r = String(role || "customer")
      .trim()
      .toLowerCase();
    if (r === "user") return "customer";
    if (r === "provider") return "service";
    return r || "customer";
  }

  function userFrom(role, serviceType) {
    return {
      role: normalizeRole(role),
      service_type: serviceType != null ? serviceType : global.__ervSessionServiceType,
    };
  }

  function canonicalPath(path, role) {
    var RR = routing();
    var p = String(path || "/").split("?")[0];
    var hash = String(path || "").indexOf("#") >= 0 ? String(path).slice(String(path).indexOf("#")) : "";
    var base = p.split("#")[0].replace(/\.html$/i, "") || "/";
    if (base === "/index") base = "/";
    if (base === "/driver-dashboard" || base.indexOf("/driver-dashboard") === 0) {
      return (RR ? RR.portalPathForRole("driver") : "/driver-preview") + hash;
    }
    if (base === "/start-now" || base === "/dashboard") {
      return (RR ? RR.CUSTOMER_PLATFORM_HOME : "/") + hash;
    }
    if (String(role || "").toLowerCase() === "blocked") return "/blocked-complaints";
    return (base || "/") + hash;
  }

  function homeFor(role, serviceType) {
    var user = userFrom(role, serviceType);
    var RR = routing();
    var portalRole = "customer";
    var path = "/";
    var label = "المنصة الرئيسية";

    if (normalizeRole(role) === "blocked") {
      return {
        role: "blocked",
        path: "/blocked-complaints",
        label: "الدعم والشكاوى",
        short: PORTAL_SHORT.blocked,
      };
    }

    if (RR) {
      var resolved = RR.resolvePortalRole(user);
      portalRole = resolved.portalRole;
      path = RR.resolvePostLoginPath(user);
      label = RR.portalLabelAr(portalRole);
    } else {
      var raw = user.role;
      if (raw === "admin") portalRole = "admin";
      else if (raw === "driver") portalRole = "driver";
      else if (raw === "store" || raw === "merchant" || raw === "restaurant") portalRole = "merchant";
      else if (raw === "service") {
        var st0 = String(user.service_type || "").toLowerCase();
        if (st0 === "internal_delivery") portalRole = "driver";
        else if (
          st0 === "pickup_truck" ||
          st0 === "car_transport" ||
          st0 === "vehicle_transfer" ||
          st0 === "furniture_move"
        ) {
          portalRole = "transport";
        } else portalRole = "service";
      }
      path = fallbackPath(portalRole);
      label = portalRole === "customer" ? "المنصة الرئيسية" : path;
    }

    var out = {
      role: portalRole,
      path: canonicalPath(path, portalRole),
      label: label,
      short: PORTAL_SHORT[portalRole] || label,
    };
    if (portalRole === "service" && user.service_type) {
      var st = String(user.service_type)
        .trim()
        .toLowerCase();
      if (SERVICE_HOME_LABELS[st]) {
        out.label = SERVICE_HOME_LABELS[st];
        out.short = SERVICE_HOME_LABELS[st].replace(/^لوحة\s+/, "");
      }
    }
    if (portalRole === "driver" && String(user.service_type || "").toLowerCase() === "internal_delivery") {
      out.label = SERVICE_HOME_LABELS.internal_delivery;
      out.short = "توصيل داخلي";
    }
    return out;
  }

  function walletHrefFor(role, serviceType) {
    var user = userFrom(role, serviceType);
    var RR = routing();
    if (normalizeRole(role) === "blocked") return "/blocked-complaints";
    if (RR && typeof RR.walletPathForUser === "function") {
      return RR.walletPathForUser(user);
    }
    var home = homeFor(role, serviceType);
    if (home.role === "customer") return "/wallet.html";
    if (home.role === "admin") return home.path;
    return String(home.path || "/").split("#")[0] + "#wallet";
  }

  function setSessionFromMe(me) {
    var profile = (me && me.profile) || {};
    global.__ervSessionRole = normalizeRole(profile.role);
    global.__ervSessionServiceType = profile.service_type || null;
    global.__ervSessionMe = me || null;
  }

  function ensurePickerOverlay() {
    var id = "ervAccountPickerOverlay";
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement("div");
    el.id = id;
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "ervAccountPickerTitle");
    el.innerHTML =
      '<div class="erv-account-picker">' +
      '<h2 id="ervAccountPickerTitle">اختر لوحتك</h2>' +
      '<p class="erv-account-picker__sub">حسابك مرتبط بأكثر من دور — اختر الوجهة المناسبة.</p>' +
      '<div class="erv-account-picker__list" id="ervAccountPickerList"></div>' +
      '<button type="button" class="erv-account-picker__close" id="ervAccountPickerClose">إلغاء</button>' +
      "</div>";
    el.addEventListener("click", function (e) {
      if (e.target === el) el.hidden = true;
    });
    document.body.appendChild(el);
    var closeBtn = document.getElementById("ervAccountPickerClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        el.hidden = true;
      });
    }
    if (!document.getElementById("ervAccountPickerStyles")) {
      var style = document.createElement("style");
      style.id = "ervAccountPickerStyles";
      style.textContent =
        "#ervAccountPickerOverlay{position:fixed;inset:0;z-index:100000;background:rgba(20,12,8,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}" +
        "#ervAccountPickerOverlay[hidden]{display:none!important}" +
        ".erv-account-picker{background:#fffdf8;border:1px solid rgba(185,135,47,.35);border-radius:16px;padding:18px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(45,26,14,.2);font-family:Cairo,system-ui,sans-serif;color:#3d2213}" +
        ".erv-account-picker h2{margin:0 0 6px;font-size:1.1rem;font-weight:900}" +
        ".erv-account-picker__sub{margin:0 0 14px;font-size:.88rem;line-height:1.5;color:#5c4a3d}" +
        ".erv-account-picker__list{display:flex;flex-direction:column;gap:8px}" +
        ".erv-account-picker__btn{width:100%;min-height:48px;border-radius:12px;border:1px solid rgba(185,135,47,.4);background:linear-gradient(180deg,#fffefb,#f8f4ee);font-family:inherit;font-size:.95rem;font-weight:800;cursor:pointer;color:#3d2213}" +
        ".erv-account-picker__btn:hover{border-color:#b9872f;background:#fff9ee}" +
        ".erv-account-picker__close{margin-top:12px;width:100%;min-height:44px;border:0;background:transparent;font-family:inherit;font-weight:700;color:#5c4a3d;cursor:pointer}";
      document.head.appendChild(style);
    }
    return el;
  }

  function normalizeDestinations(destinations) {
    return (destinations || []).map(function (d) {
      return Object.assign({}, d, {
        path: canonicalPath(d.path, d.role || d.portalRole),
      });
    });
  }

  function showPicker(destinations) {
    var overlay = ensurePickerOverlay();
    var list = document.getElementById("ervAccountPickerList");
    if (!list) return;
    destinations = normalizeDestinations(destinations);
    list.innerHTML = destinations
      .map(function (d) {
        var path = String(d.path || "/").replace(/"/g, "");
        var label = String(d.label || d.role || "دخول").replace(/</g, "");
        return (
          '<button type="button" class="erv-account-picker__btn" data-path="' +
          path +
          '">' +
          label +
          "</button>"
        );
      })
      .join("");
    list.querySelectorAll(".erv-account-picker__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        overlay.hidden = true;
        global.location.href = btn.getAttribute("data-path") || "/";
      });
    });
    overlay.hidden = false;
  }

  async function fetchDestinations() {
    if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") return null;
    if (!global.PlatformAPI.getToken || !global.PlatformAPI.getToken()) return null;
    return global.PlatformAPI.api("/api/core/login-destinations");
  }

  async function goHome(opts) {
    opts = opts || {};
    var role = normalizeRole(opts.role || global.__ervSessionRole);
    var serviceType = opts.serviceType != null ? opts.serviceType : global.__ervSessionServiceType;
    var home = homeFor(role, serviceType);

    if (!opts.skipPicker) {
      try {
        var destRes = await fetchDestinations();
        var dests = normalizeDestinations((destRes && destRes.destinations) || []);
        if (dests.length > 1) {
          showPicker(dests);
          return;
        }
        if (dests.length === 1 && dests[0].path) {
          global.location.href = dests[0].path;
          return;
        }
        if (destRes && destRes.default && destRes.default.path) {
          global.location.href = canonicalPath(destRes.default.path, destRes.default.role || role);
          return;
        }
      } catch (e) {
        /* fallback */
      }
    }

    global.location.href = home.path;
  }

  function formatOwnPhone(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (d.indexOf("966") === 0 && d.length >= 12) d = "0" + d.slice(3);
    if (d.charAt(0) === "5" && d.length === 9) d = "0" + d;
    if (d.length === 10 && d.indexOf("05") === 0) {
      return d.slice(0, 4) + " " + d.slice(4, 7) + " " + d.slice(7);
    }
    return String(phone || "").trim();
  }

  function compactOwnPhone(phone) {
    return formatOwnPhone(phone).replace(/\s+/g, "") || String(phone || "").trim();
  }

  function sessionTypeLabel(role, serviceType) {
    var home = homeFor(role, serviceType);
    return home.short || home.label || "نوع الحساب";
  }

  function sessionCtx(opts) {
    opts = opts || {};
    var me = global.__ervSessionMe || {};
    var profile = me.profile || {};
    var user = me.user || {};
    return {
      role: normalizeRole(opts.role || global.__ervSessionRole || profile.role),
      serviceType:
        opts.serviceType != null ? opts.serviceType : global.__ervSessionServiceType || profile.service_type,
      phone: opts.phone || user.phone || profile.phone || "",
    };
  }

  function performSessionLogout() {
    if (global.ErvenowGuestShell && typeof global.ErvenowGuestShell.performGuestLogout === "function") {
      global.ErvenowGuestShell.performGuestLogout();
      return;
    }
    if (typeof global.logout === "function") {
      global.logout();
      return;
    }
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("ervenow_access_token");
      localStorage.removeItem("erwenow_access_token");
      localStorage.removeItem("userId");
      localStorage.removeItem("userPhone");
    } catch (_e) {}
    global.location.href = "/";
  }

  function ensureSessionMenuStyles() {
    if (document.getElementById("ervAccountSessionStyles")) return;
    var style = document.createElement("style");
    style.id = "ervAccountSessionStyles";
    style.textContent =
      ".erv-account-menu{position:relative;display:inline-flex;min-width:0}" +
      ".erv-account-menu__toggle{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;max-width:min(100%,12.5rem);padding:6px 10px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:0.82rem;font-weight:800;line-height:1.3;cursor:pointer}" +
      ".erv-account-menu__phone{direction:ltr;unicode-bidi:isolate;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#ervAccountSessionMenu{position:fixed;z-index:100050;min-width:min(92vw,260px);max-width:min(94vw,320px);padding:8px;border-radius:14px;border:1px solid rgba(15,90,55,.16);background:#fffefb;box-shadow:0 16px 40px rgba(15,40,28,.16);font-family:Cairo,system-ui,sans-serif}" +
      "#ervAccountSessionMenu[hidden]{display:none!important}" +
      ".erv-account-session__item{display:block;width:100%;min-height:44px;margin:0;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:#3d2213;font:inherit;font-size:.92rem;font-weight:800;text-align:start;cursor:pointer;line-height:1.45}" +
      ".erv-account-session__item:hover,.erv-account-session__item:focus-visible{background:#f3f8f5}" +
      ".erv-account-session__item--logout{color:#9f1239}" +
      ".erv-account-session__hint{display:block;font-size:.72rem;font-weight:700;color:#5c4a3d;margin-bottom:2px}" +
      "html:not(.erv-mobile-shell) body.lp-home-premium #authArea .erv-account-menu__toggle::before{content:none!important;display:none!important}";
    document.head.appendChild(style);
  }

  function closeSessionMenu() {
    var menu = document.getElementById("ervAccountSessionMenu");
    if (menu) menu.hidden = true;
    document.querySelectorAll('[aria-controls="ervAccountSessionMenu"]').forEach(function (el) {
      el.setAttribute("aria-expanded", "false");
    });
  }

  function positionSessionMenu(anchor) {
    var menu = document.getElementById("ervAccountSessionMenu");
    if (!menu || !anchor) return;
    var rect = anchor.getBoundingClientRect();
    var gap = 8;
    var width = Math.min(320, Math.max(220, rect.width, 260));
    menu.style.width = width + "px";
    var left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    var top = rect.bottom + gap;
    menu.style.left = left + "px";
    menu.style.right = "auto";
    menu.hidden = false;
    var h = menu.offsetHeight || 120;
    if (top + h > window.innerHeight - 8 && rect.top - gap - h > 8) {
      top = rect.top - gap - h;
    }
    menu.style.top = Math.max(8, top) + "px";
  }

  function ensureSessionMenu() {
    ensureSessionMenuStyles();
    var menu = document.getElementById("ervAccountSessionMenu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "ervAccountSessionMenu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<button type="button" class="erv-account-session__item" role="menuitem" data-erv-session-act="type">' +
      '<span class="erv-account-session__hint">نوع الحساب</span>' +
      '<span data-erv-session-type>حساب</span></button>' +
      '<button type="button" class="erv-account-session__item erv-account-session__item--logout" role="menuitem" data-erv-session-act="logout">خروج</button>';
    document.body.appendChild(menu);
    menu.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-erv-session-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-erv-session-act");
      closeSessionMenu();
      if (act === "logout") {
        performSessionLogout();
        return;
      }
      if (act === "type") goHome();
    });
    if (!ensureSessionMenu.docBound) {
      ensureSessionMenu.docBound = true;
      document.addEventListener("click", function (e) {
        var menuEl = document.getElementById("ervAccountSessionMenu");
        if (!menuEl || menuEl.hidden) return;
        if (menuEl.contains(e.target)) return;
        if (e.target.closest && e.target.closest('[aria-controls="ervAccountSessionMenu"]')) return;
        closeSessionMenu();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeSessionMenu();
      });
      global.addEventListener("resize", closeSessionMenu);
    }
    return menu;
  }

  function toggleSessionMenu(anchor, opts) {
    if (!anchor) return;
    var menu = ensureSessionMenu();
    var opening = menu.hidden;
    closeSessionMenu();
    if (!opening) return;
    var ctx = sessionCtx(opts);
    var typeEl = menu.querySelector("[data-erv-session-type]");
    if (typeEl) typeEl.textContent = sessionTypeLabel(ctx.role, ctx.serviceType);
    anchor.setAttribute("aria-controls", "ervAccountSessionMenu");
    anchor.setAttribute("aria-expanded", "true");
    positionSessionMenu(anchor);
  }

  function paintAuthArea(host, opts) {
    if (!host) return;
    var ctx = sessionCtx(opts);
    var shown = formatOwnPhone(ctx.phone) || sessionTypeLabel(ctx.role, ctx.serviceType);
    host.innerHTML =
      '<div class="erv-account-menu">' +
      '<button type="button" class="erv-account-menu__toggle" aria-haspopup="true" aria-expanded="false" aria-controls="ervAccountSessionMenu" aria-label="حسابك ' +
      String(shown).replace(/"/g, "") +
      '">' +
      '<span class="erv-account-menu__phone" dir="ltr">' +
      String(shown)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;") +
      "</span></button></div>";
    var btn = host.querySelector(".erv-account-menu__toggle");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSessionMenu(btn, ctx);
    });
  }

  function refreshPhoneMidHint(midEl) {
    if (!midEl) return;
    var home = homeFor(global.__ervSessionRole, global.__ervSessionServiceType);
    midEl.setAttribute("title", "حسابك — " + home.label);
    midEl.setAttribute("aria-label", "حسابك — " + (midEl.textContent || home.label));
  }

  function wirePhoneMidButton(midEl) {
    if (!midEl) return;
    midEl.style.cursor = "pointer";
    refreshPhoneMidHint(midEl);
    midEl.setAttribute("aria-haspopup", "true");
    midEl.setAttribute("aria-controls", "ervAccountSessionMenu");
    if (midEl.getAttribute("data-erv-account-wired") === "menu") return;
    midEl.setAttribute("data-erv-account-wired", "menu");
    midEl.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleSessionMenu(midEl);
    });
    midEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSessionMenu(midEl);
      }
    });
  }

  global.ErvenowAccountDest = {
    SERVICE_HOME_LABELS: SERVICE_HOME_LABELS,
    normalizeRole: normalizeRole,
    homeFor: homeFor,
    walletHrefFor: walletHrefFor,
    setSessionFromMe: setSessionFromMe,
    goHome: goHome,
    showPicker: showPicker,
    wirePhoneMidButton: wirePhoneMidButton,
    refreshPhoneMidHint: refreshPhoneMidHint,
    formatOwnPhone: formatOwnPhone,
    compactOwnPhone: compactOwnPhone,
    sessionTypeLabel: sessionTypeLabel,
    paintAuthArea: paintAuthArea,
    toggleSessionMenu: toggleSessionMenu,
    closeSessionMenu: closeSessionMenu,
  };

  global.goAccountHome = function () {
    return goHome();
  };
})(window);
