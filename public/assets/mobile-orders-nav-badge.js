/**
 * ERVENOW — شارة طلبات الهيدر السفلي (جوال)
 */
(function (global) {
  "use strict";

  var POLL_MS = 5000;
  var pollTimer = null;
  var cachedRole = "";

  function hasToken() {
    try {
      return !!(global.PlatformAPI && global.PlatformAPI.getToken && global.PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

  function whenPlatformApiReady(cb, tries) {
    tries = tries || 0;
    if (global.PlatformAPI && typeof global.PlatformAPI.api === "function") {
      cb();
      return;
    }
    if (tries > 100) return;
    setTimeout(function () {
      whenPlatformApiReady(cb, tries + 1);
    }, 40);
  }

  function orderStatusKey(o) {
    return String((o && o.delivery_status) || (o && o.status) || "")
      .toLowerCase()
      .trim();
  }

  function orderFinanceStatus(o) {
    return String((o && o.status) || "")
      .toLowerCase()
      .trim();
  }

  function isCancelledOrder(o) {
    var ds = orderStatusKey(o);
    var st = orderFinanceStatus(o);
    if (/cancel/.test(ds) || /cancel/.test(st)) return true;
    return (
      ds === "cancelled_by_customer" ||
      ds === "canceled_by_customer" ||
      st === "cancelled" ||
      st === "canceled"
    );
  }

  function isDeliveredOrder(o) {
    var ds = orderStatusKey(o);
    return ds === "delivered" || ds === "completed" || ds === "closed";
  }

  function isOpenCustomerOrder(o) {
    return !isCancelledOrder(o) && !isDeliveredOrder(o);
  }

  function countOpenCustomerOrders(orders) {
    return (orders || []).filter(isOpenCustomerOrder).length;
  }

  function countDriverOrders(orders) {
    return (orders || []).filter(function (o) {
      var ds = orderStatusKey(o);
      return ds === "pending" || ds === "accepted" || ds === "new";
    }).length;
  }

  function fmtBadge(n) {
    var x = Math.max(0, Number(n) || 0);
    if (x <= 0) return "0";
    if (x > 99) return "99+";
    return String(x);
  }

  function applyBadgeCount(n) {
    var dst = document.getElementById("ervMobileNavOrdersBadge");
    if (!dst) return;
    var count = Math.max(0, Number(n) || 0);
    if (count <= 0) {
      dst.hidden = true;
      dst.textContent = "0";
    } else {
      dst.hidden = false;
      dst.textContent = fmtBadge(count);
    }
  }

  function readCountFromDom() {
    var sources = [document.getElementById("myOrdersCount"), document.getElementById("ordersBadge")];
    for (var i = 0; i < sources.length; i++) {
      var el = sources[i];
      if (!el) continue;
      if (el.hidden) continue;
      if (el.style && el.style.display === "none") continue;
      var raw = String(el.textContent || "").trim();
      if (raw === "99+") return 99;
      var n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  async function fetchCount() {
    if (!hasToken()) {
      cachedRole = "";
      return 0;
    }
    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      var role = String((me.access && me.access.role) || (me.profile && me.profile.role) || "").toLowerCase();
      if (role === "user") role = "customer";
      cachedRole = role;

      var j = await global.PlatformAPI.api("/api/order/orders");
      var orders = Array.isArray(j.orders) ? j.orders : [];

      if (role === "driver" || role === "admin") {
        if (typeof j.count === "number") return j.count;
        return countDriverOrders(orders);
      }
      if (role === "customer") {
        return countOpenCustomerOrders(orders);
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  async function refresh() {
    if (!hasToken()) {
      applyBadgeCount(0);
      return 0;
    }
    var fromDom = readCountFromDom();
    if (fromDom != null) {
      applyBadgeCount(fromDom);
      return fromDom;
    }
    var n = await fetchCount();
    applyBadgeCount(n);
    return n;
  }

  function observeDomBadges() {
    if (!global.MutationObserver) return;
    ["myOrdersCount", "ordersBadge"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var obs = new global.MutationObserver(function () {
        var fromDom = readCountFromDom();
        if (fromDom != null) applyBadgeCount(fromDom);
      });
      obs.observe(el, { childList: true, characterData: true, attributes: true, subtree: true });
    });
  }

  function startPoll() {
    if (pollTimer) return;
    refresh();
    pollTimer = global.setInterval(refresh, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) {
      global.clearInterval(pollTimer);
      pollTimer = null;
    }
    cachedRole = "";
    applyBadgeCount(0);
  }

  function ensureNavBadgeReady() {
    function tryRefresh() {
      if (!document.getElementById("ervMobileNavOrdersBadge")) return false;
      refresh();
      return true;
    }
    if (tryRefresh()) return;
    if (!global.MutationObserver) {
      global.setTimeout(refresh, 400);
      return;
    }
    var obs = new global.MutationObserver(function () {
      if (tryRefresh()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    global.setTimeout(function () {
      tryRefresh();
      obs.disconnect();
    }, 3000);
  }

  function init() {
    observeDomBadges();
    global.addEventListener("ervenow:auth-changed", function () {
      if (hasToken()) startPoll();
      else stopPoll();
    });
    global.addEventListener("ervenow:orders-count-changed", function (ev) {
      var n = ev && ev.detail ? ev.detail.count : 0;
      applyBadgeCount(n);
    });
    whenPlatformApiReady(function () {
      if (hasToken()) startPoll();
      else applyBadgeCount(0);
      ensureNavBadgeReady();
    });
  }

  global.ErvenowMobileOrdersNavBadge = {
    refresh: refresh,
    apply: applyBadgeCount,
    getRole: function () {
      return cachedRole;
    },
    ordersHref: function () {
      if (cachedRole === "driver") return "/orders";
      if (hasToken()) return "/my-orders";
      return "/login?role=customer&next=" + encodeURIComponent("/my-orders");
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
