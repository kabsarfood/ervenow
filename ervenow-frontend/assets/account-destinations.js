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
    if (r === "merchant") return "/merchant-preview";
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

  function refreshPhoneMidHint(midEl) {
    if (!midEl) return;
    var home = homeFor(global.__ervSessionRole, global.__ervSessionServiceType);
    midEl.setAttribute("title", "فتح " + home.label);
    midEl.setAttribute("aria-label", "فتح " + home.label + " — " + (midEl.textContent || ""));
  }

  function wirePhoneMidButton(midEl) {
    if (!midEl) return;
    midEl.style.cursor = "pointer";
    refreshPhoneMidHint(midEl);
    if (midEl.getAttribute("data-erv-account-wired")) return;
    midEl.setAttribute("data-erv-account-wired", "1");
    midEl.addEventListener("click", function () {
      goHome();
    });
    midEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        goHome();
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
  };

  global.goAccountHome = function () {
    return goHome();
  };
})(window);
