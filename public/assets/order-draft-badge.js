/**
 * Checkout Cutover — Draft Badge (عدد + إجمالي من ErvenowOrderDraft)
 */
(function (global) {
  "use strict";

  var CHECKOUT_PATH = "/checkout";

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function fmtMoney(n) {
    try {
      return roundMoney(n).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (_e) {
      return roundMoney(n).toFixed(2);
    }
  }

  function countItems(items) {
    return (items || []).reduce(function (sum, it) {
      return sum + (Number(it && it.data && it.data.qty) || 1);
    }, 0);
  }

  function itemsSubtotal(items) {
    return roundMoney(
      (items || []).reduce(function (sum, it) {
        return sum + (Number(it && it.price) || 0);
      }, 0)
    );
  }

  function readDraftItems() {
    if (!global.ErvenowOrderDraft || typeof global.ErvenowOrderDraft.readDraft !== "function") {
      return [];
    }
    var draft = global.ErvenowOrderDraft.readDraft();
    return draft && Array.isArray(draft.items) ? draft.items : [];
  }

  function sync() {
    var items = readDraftItems();
    var count = countItems(items);
    var subtotal = itemsSubtotal(items);

    var badges = document.querySelectorAll("#cartCount, .dash-header-cart__badge");
    badges.forEach(function (el) {
      el.textContent = String(count);
      el.setAttribute("data-empty", count > 0 ? "false" : "true");
    });

    var totals = document.querySelectorAll(
      "#indexDraftTotal, [data-erv-draft-total], .store-cart-link__total, #storeCartTotal"
    );
    totals.forEach(function (el) {
      if (count > 0) {
        el.textContent = fmtMoney(subtotal) + " ر.س";
        el.hidden = false;
        el.style.display = "";
      } else {
        el.textContent = "";
        el.hidden = true;
        if (el.id === "storeCartTotal") el.style.display = "none";
      }
    });

    var storeCounts = document.querySelectorAll(".store-cart-count");
    if (storeCounts.length && global.ErvenowOrderDraft) {
      var storeId = null;
      try {
        storeId = new URLSearchParams(global.location.search).get("id");
      } catch (_e2) {}
      if (storeId) {
        var storeCount = 0;
        var storeSub = 0;
        items.forEach(function (it) {
          var d = it && it.data;
          if (!d || String(d.store_id) !== String(storeId)) return;
          storeCount += Number(d.qty) || 1;
          storeSub += Number(it.price) || 0;
        });
        storeCounts.forEach(function (el) {
          el.textContent = String(storeCount);
        });
        var storeTotal = document.getElementById("storeCartTotal");
        if (storeTotal) {
          if (storeCount > 0) {
            storeTotal.textContent = "💰 " + fmtMoney(storeSub) + " ريال";
            storeTotal.style.display = "block";
          } else {
            storeTotal.style.display = "none";
          }
        }
      }
    }

    return { count: count, subtotal: subtotal };
  }

  function ensureStyles() {
    if (document.querySelector('link[href*="order-draft-badge.css"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "/assets/order-draft-badge.css";
    document.head.appendChild(l);
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  function ensureReady(cb) {
    ensureStyles();
    loadScript("/assets/order-draft-store.js")
      .then(function () {
        return loadScript("/assets/order-draft-vertical.js");
      })
      .then(function () {
        if (typeof cb === "function") cb();
      });
  }

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.onDraftChange === "function") {
      global.ErvenowOrderDraft.onDraftChange(function () {
        sync();
      });
    }
    global.addEventListener("storage", function (ev) {
      if (ev && ev.key === "ervenow:order-draft") sync();
    });
    global.addEventListener("ervenow:order-draft-changed", function () {
      sync();
    });
  }

  function boot() {
    ensureReady(function () {
      if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.tryMigrateFromLegacyCart === "function") {
        global.ErvenowOrderDraft.tryMigrateFromLegacyCart({ sourcePage: global.location.pathname });
      }
      sync();
      bind();
    });
  }

  global.ErvenowOrderDraftBadge = {
    CHECKOUT_PATH: CHECKOUT_PATH,
    sync: sync,
    bind: bind,
    boot: boot,
    ensureReady: ensureReady,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : global);
