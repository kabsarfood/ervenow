/**
 * تطبيق سياسة صلاحيات المنصة في الواجهة
 */
(function (global) {
  var ADMIN_PREFIXES = ["/admin", "/admin-dashboard", "/admin-login", "/admin-settings", "/admin-finance", "/admin-approvals", "/admin-branding", "/admin-categories", "/admin-commissions", "/admin-debts", "/admin-withdrawals"];
  var DRIVER_HUB = ["/driver", "/driver-wallet", "/driver-app", "/driver-login", "/orders"];
  var DRIVER_BLOCKED_ORDER = ["/cart", "/order"];

  function normalizeRole(role) {
    var r = String(role || "")
      .trim()
      .toLowerCase();
    if (r === "user") return "customer";
    if (r === "provider") return "service";
    return r || "customer";
  }

  function pathMatches(path, prefixes) {
    var p = String(path || "").split("?")[0].split("#")[0].toLowerCase();
    for (var i = 0; i < prefixes.length; i++) {
      var pre = prefixes[i].toLowerCase();
      if (p === pre || p.indexOf(pre + "/") === 0) return true;
    }
    return false;
  }

  function isAdminPath(path) {
    return pathMatches(path, ADMIN_PREFIXES);
  }

  function hasToken() {
    try {
      return !!(global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

  async function fetchMe() {
    if (!hasToken()) return null;
    try {
      return await global.PlatformAPI.api("/api/core/me");
    } catch (e) {
      return null;
    }
  }

  function accessFromMe(me) {
    var a = me && me.access;
    if (a) return a;
    var role = normalizeRole(me && me.profile && me.profile.role);
    return {
      role: role,
      can_place_orders: role !== "driver",
      can_access_admin: role === "admin",
      can_access_driver_dispatch: role === "driver" || role === "admin",
    };
  }

  function applyDriverUiRestrictions() {
    document.querySelectorAll('a[href="/cart"], a[href="/order"]').forEach(function (a) {
      a.setAttribute("data-driver-order-blocked", "1");
      a.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          alert("حساب المندوب: التصفح فقط — الطلبات من لوحة المندوب وطلبات المنصة.");
        },
        true
      );
    });
    document.querySelectorAll(".dash-header-cart").forEach(function (a) {
      a.style.display = "none";
    });
    if (typeof global.addToCart === "function" && !global.__ervAddToCartWrapped) {
      var orig = global.addToCart;
      global.addToCart = function () {
        alert("حساب المندوب لا يمكنه إضافة طلبات — استخدم طلبات المنصة لاستلام التوصيل.");
      };
      global.__ervAddToCartWrapped = true;
    }
  }

  function guardPage(role, access) {
    var path = location.pathname;
    role = normalizeRole(role);
    access = access || {};

    if (!access.can_access_admin && isAdminPath(path)) {
      location.replace(role === "driver" ? "/driver" : "/dashboard");
      return true;
    }

    if (role === "driver" && pathMatches(path, DRIVER_BLOCKED_ORDER)) {
      location.replace("/driver");
      return true;
    }

    if (role === "customer" && (path === "/orders" || path.indexOf("/orders/") === 0)) {
      location.replace("/my-orders");
      return true;
    }

    if (!access.can_access_driver_dispatch && (path === "/orders" || path.indexOf("/orders/") === 0)) {
      location.replace(hasToken() ? "/my-orders" : "/login?role=customer&next=" + encodeURIComponent("/my-orders"));
      return true;
    }

    if (role === "driver" && (path === "/my-orders" || path.indexOf("/my-orders/") === 0)) {
      location.replace("/orders");
      return true;
    }

    if (role === "driver" && !pathMatches(path, DRIVER_HUB) && !isAdminPath(path)) {
      /* تصفح مسموح — لا إعادة توجيه */
    }
    return false;
  }

  function patchQuickOrdersLink(role, access) {
    var link = document.getElementById("lpQuickOrdersLink");
    var badge = document.getElementById("ordersBadge");
    if (!link) return;
    role = normalizeRole(role);
    if (access.can_access_driver_dispatch) {
      link.setAttribute("href", "/orders");
      link.hidden = false;
      var txtD = link.querySelector(".lp-dd-link__text");
      if (txtD) txtD.textContent = role === "driver" ? "طلباتي" : "الطلبات";
      return;
    }
    link.setAttribute("href", hasToken() ? "/my-orders" : "/login?role=customer&next=" + encodeURIComponent("/my-orders"));
    link.hidden = false;
    if (badge) badge.style.display = "none";
    var txt = link.querySelector(".lp-dd-link__text");
    if (txt) txt.textContent = "طلباتي";
  }

  async function applyPlatformAccessPolicy() {
    if (!hasToken()) return null;
    var me = await fetchMe();
    if (!me) return null;
    var access = accessFromMe(me);
    var role = access.role || normalizeRole(me.profile && me.profile.role);

    if (guardPage(role, access)) return me;

    if (!access.can_place_orders) applyDriverUiRestrictions();
    patchQuickOrdersLink(role, access);

    global.ErvenowPlatformAccess = {
      me: me,
      access: access,
      role: role,
    };
    return me;
  }

  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  whenReady(function () {
    if (!hasToken()) return;
    var tries = 0;
    (function waitApi() {
      if (global.PlatformAPI && PlatformAPI.getToken) {
        applyPlatformAccessPolicy();
        return;
      }
      if (tries++ > 80) return;
      setTimeout(waitApi, 50);
    })();
  });

  global.addEventListener("ervenow:auth-changed", function () {
    applyPlatformAccessPolicy();
  });

  global.ErvenowPlatformAccess = {
    apply: applyPlatformAccessPolicy,
    normalizeRole: normalizeRole,
    guardPage: guardPage,
  };
})(window);
