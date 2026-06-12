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

  function isDraftEmpty() {
    return countItems(readDraftItems()) <= 0;
  }

  function goCheckout() {
    if (isDraftEmpty()) {
      try {
        sessionStorage.setItem("ervenow:checkout-flash", "لا توجد عناصر حالياً في الطلب");
      } catch (_eFlash) {}
    }
    global.location.href = CHECKOUT_PATH;
  }

  function removeLegacyCartUi() {
    ["#lpCartWrap", "#lpCartPanel", "#lpCartBackdrop"].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.remove();
      });
    });
    document.querySelectorAll(".lp-cart-wrap.dash-cart-wrap, .dash-cart-wrap").forEach(function (el) {
      if (el.id === "lpCartWrap" || el.querySelector("#lpCartPanel")) el.remove();
    });
  }

  function buildHeaderCartLink(countText, countEmpty) {
    var a = document.createElement("a");
    a.className = "dash-header-cart";
    a.href = CHECKOUT_PATH;
    a.setAttribute("aria-label", "السلة — الدفع");
    a.setAttribute("data-erv-checkout-nav", "1");
    a.innerHTML =
      '<span aria-hidden="true">🛒</span>' +
      '<span class="dash-header-cart__label">السلة</span>' +
      '<span class="dash-header-cart__badge" id="cartCount" data-empty="' +
      (countEmpty ? "true" : "false") +
      '">' +
      String(countText || "0") +
      "</span>";
    return a;
  }

  function restoreHeaderCartLink() {
    var legacyWrap = document.getElementById("lpCartWrap");
    var legacyBtn = document.getElementById("lpCartToggle");
    var tools = document.querySelector(".dash-site-header__tools");
    if (!legacyWrap && !legacyBtn) {
      document.querySelectorAll(".dash-header-cart[href]").forEach(function (a) {
        if (a.getAttribute("href") !== CHECKOUT_PATH) a.setAttribute("href", CHECKOUT_PATH);
        a.setAttribute("data-erv-checkout-nav", "1");
      });
      return;
    }
    var badge =
      (legacyWrap && legacyWrap.querySelector("#cartCount")) ||
      (legacyBtn && legacyBtn.querySelector("#cartCount")) ||
      document.getElementById("cartCount");
    var countText = badge ? badge.textContent : "0";
    var countEmpty = !badge || badge.getAttribute("data-empty") !== "false";
    var link = buildHeaderCartLink(countText, countEmpty);
    if (legacyWrap && legacyWrap.parentNode) {
      legacyWrap.parentNode.replaceChild(link, legacyWrap);
    } else if (legacyBtn && legacyBtn.parentNode) {
      legacyBtn.parentNode.replaceChild(link, legacyBtn);
    } else if (tools && !tools.querySelector(".dash-header-cart")) {
      tools.appendChild(link);
    }
    removeLegacyCartUi();
  }

  function wireCheckoutNav() {
    if (global.__ervCheckoutNavWired) return;
    global.__ervCheckoutNavWired = true;

    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var trigger = t.closest(
          [
            ".dash-header-cart",
            ".dash-header-cart-btn",
            "#lpCartToggle",
            "#cartCount",
            ".dash-header-cart__badge",
            ".orders-dropdown > summary",
            "[data-erv-go-checkout]",
            "a[href='/cart']",
            "a[href='/cart.html']",
          ].join(",")
        );
        if (!trigger) return;
        if (trigger.matches("a[href='/cart'], a[href='/cart.html']")) {
          ev.preventDefault();
          goCheckout();
          return;
        }
        if (
          trigger.matches(".dash-header-cart") &&
          trigger.getAttribute("href") === CHECKOUT_PATH &&
          !trigger.classList.contains("dash-header-cart-btn")
        ) {
          if (isDraftEmpty()) {
            ev.preventDefault();
            goCheckout();
          }
          return;
        }
        if (
          trigger.id === "lpCartToggle" ||
          trigger.classList.contains("dash-header-cart-btn") ||
          trigger.matches(".orders-dropdown > summary") ||
          trigger.hasAttribute("data-erv-go-checkout")
        ) {
          ev.preventDefault();
          ev.stopPropagation();
          goCheckout();
        }
      },
      true
    );
  }

  function enforceCheckoutNav() {
    removeLegacyCartUi();
    restoreHeaderCartLink();
    wireCheckoutNav();
    sync();
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
      var policy = { allowMigrate: true, mode: "default" };
      if (global.ErvenowOrderDraft && typeof global.ErvenowOrderDraft.applySessionDraftPolicy === "function") {
        policy = global.ErvenowOrderDraft.applySessionDraftPolicy() || policy;
      }
      if (
        policy.allowMigrate &&
        global.ErvenowOrderDraft &&
        typeof global.ErvenowOrderDraft.tryMigrateFromLegacyCart === "function"
      ) {
        global.ErvenowOrderDraft.tryMigrateFromLegacyCart({ sourcePage: global.location.pathname });
      }
      enforceCheckoutNav();
      bind();
    });
  }

  global.ErvenowOrderDraftBadge = {
    CHECKOUT_PATH: CHECKOUT_PATH,
    sync: sync,
    bind: bind,
    boot: boot,
    ensureReady: ensureReady,
    goCheckout: goCheckout,
    enforceCheckoutNav: enforceCheckoutNav,
    removeLegacyCartUi: removeLegacyCartUi,
    isDraftEmpty: isDraftEmpty,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : global);
