/**
 * توجيه «حسابي» / رقم الجوال في الهيدر — حسب دور المستخدم في المنصة
 */
(function (global) {
  var ROLE_HOME = {
    customer: { path: "/dashboard", label: "لوحة زائر المنصة", short: "زائر المنصة" },
    driver: { path: "/driver", label: "لوحة المندوب", short: "مندوب التوصيل" },
    store: { path: "/store-dashboard", label: "لوحة المتجر", short: "المتجر" },
    merchant: { path: "/store-dashboard", label: "لوحة المتجر", short: "التاجر" },
    restaurant: { path: "/store-dashboard", label: "لوحة المطعم", short: "المطعم" },
    service: { path: "/services-provider.html", label: "لوحة مزود الخدمة", short: "مزود خدمة" },
    admin: { path: "/admin-dashboard", label: "لوحة الإدارة", short: "الإدارة" },
    blocked: { path: "/blocked-complaints.html", label: "الدعم والشكاوى", short: "الدعم" },
  };

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
    gas_delivery: "لوحة توصيل الغاز",
    service: "لوحة مزود الخدمة",
  };

  var DRIVER_HOME_PATH = "/driver";

  function canonicalPath(path, role) {
    var p = String(path || "/").split("?")[0].split("#")[0];
    p = p.replace(/\.html$/i, "");
    if (p === "/driver-dashboard" || p.indexOf("/driver-dashboard") === 0) {
      return DRIVER_HOME_PATH;
    }
    if (String(role || "").toLowerCase() === "driver" && p !== DRIVER_HOME_PATH) {
      var allowed = { "/driver": 1, "/driver-wallet": 1, "/driver-app": 1, "/orders": 1, "/driver-login": 1 };
      if (!allowed[p] && p.indexOf("driver-dashboard") !== -1) return DRIVER_HOME_PATH;
    }
    return p || "/";
  }

  function normalizeRole(role) {
    var r = String(role || "customer").trim().toLowerCase();
    if (r === "user") return "customer";
    if (r === "provider") return "service";
    return r || "customer";
  }

  function homeFor(role, serviceType) {
    var r = normalizeRole(role);
    var base = ROLE_HOME[r] || ROLE_HOME.customer;
    var out = {
      role: r,
      path: canonicalPath(base.path, r),
      label: base.label,
      short: base.short,
    };
    if (r === "service" && serviceType) {
      var st = String(serviceType).trim().toLowerCase();
      if (SERVICE_HOME_LABELS[st]) {
        out.label = SERVICE_HOME_LABELS[st];
        out.short = SERVICE_HOME_LABELS[st].replace(/^لوحة\s+/, "");
      }
    }
    return out;
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
        path: canonicalPath(d.path, d.role),
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

    if (role === "driver" && !opts.skipPicker) {
      try {
        var destResDriver = await fetchDestinations();
        var destsDriver = normalizeDestinations((destResDriver && destResDriver.destinations) || []);
        var nonDriver = destsDriver.filter(function (d) {
          return normalizeRole(d.role) !== "driver";
        });
        if (nonDriver.length > 0) {
          showPicker(destsDriver);
          return;
        }
      } catch (e) {}
      global.location.href = DRIVER_HOME_PATH;
      return;
    }

    if (!opts.skipPicker) {
      try {
        var destRes = await fetchDestinations();
        var dests = normalizeDestinations((destRes && destRes.destinations) || []);
        if (dests.length > 1) {
          showPicker(dests);
          return;
        }
        if (dests.length === 1 && dests[0].path) {
          global.location.href = canonicalPath(dests[0].path, dests[0].role);
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
    ROLE_HOME: ROLE_HOME,
    SERVICE_HOME_LABELS: SERVICE_HOME_LABELS,
    normalizeRole: normalizeRole,
    homeFor: homeFor,
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
