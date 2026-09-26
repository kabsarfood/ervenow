/**
 * ERVENOW — شارة طلبات الهيدر السفلي (جوال)
 */
(function (global) {
  "use strict";

  var POLL_MS = 45000;
  var pollTimer = null;
  var refreshBusy = false;
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

  function tabHidden() {
    return typeof document !== "undefined" && document.hidden;
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
      var j = await global.PlatformAPI.api("/api/order/orders?badge=1");
      var role = String((j && j.role) || "").toLowerCase();
      if (role === "user") role = "customer";
      cachedRole = role;
      return Math.max(0, Number(j && j.count) || 0);
    } catch (e) {
      return 0;
    }
  }

  async function refresh() {
    if (refreshBusy || tabHidden()) return 0;
    if (!hasToken()) {
      applyBadgeCount(0);
      return 0;
    }
    var fromDom = readCountFromDom();
    if (fromDom != null) {
      applyBadgeCount(fromDom);
      return fromDom;
    }
    refreshBusy = true;
    try {
      var n = await fetchCount();
      applyBadgeCount(n);
      return n;
    } finally {
      refreshBusy = false;
    }
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

  function pausePoll() {
    if (pollTimer) {
      global.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    if (pollTimer || tabHidden()) return;
    refresh();
    pollTimer = global.setInterval(function () {
      if (tabHidden()) return;
      refresh();
    }, POLL_MS);
  }

  function stopPoll() {
    pausePoll();
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
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        pausePoll();
        return;
      }
      if (hasToken()) startPoll();
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
      return "/login?next=" + encodeURIComponent("/my-orders");
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
