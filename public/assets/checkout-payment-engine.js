/**
 * Checkout Engine V1 — Payment + Wallet Engine (Phase 2)
 * مستقل عن وحدات السلة القديمة — يُستخدم من /checkout فقط.
 */
(function (global) {
  "use strict";

  var PAY_ORDER = ["ew_pay", "mada", "visa", "mastercard", "apple_pay", "stc_pay", "cash_on_delivery"];
  var PAY_HIDDEN = { tabby: true, tamara: true };
  var PAY_ICONS = {
    ew_pay: "/assets/pay-ew.svg",
    mada: "/assets/pay-mada.svg",
    visa: "/assets/pay-visa.svg",
    mastercard: "/assets/pay-mastercard.svg",
    apple_pay: "/assets/pay-apple.svg",
    stc_pay: "/assets/pay-stcpay.svg",
    cash_on_delivery: "/assets/pay-cod.svg",
  };

  var LABELS_AR = {
    ew_pay: "ERVENOW PAY",
    mada: "مدى",
    visa: "Visa",
    mastercard: "Mastercard",
    apple_pay: "Apple Pay",
    stc_pay: "STC Pay",
    cash_on_delivery: "الدفع عند الوصول",
  };

  var state = {
    selected: null,
    methods: null,
    ewBalance: null,
    ewLoading: false,
  };

  function apiUrl(path) {
    if (global.PlatformAPI && typeof global.PlatformAPI.apiUrl === "function") {
      return global.PlatformAPI.apiUrl(path);
    }
    return path;
  }

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

  function defaultMethods() {
    var o = {};
    PAY_ORDER.forEach(function (k) {
      o[k] = true;
    });
    return o;
  }

  function normalizeMethods(obj) {
    var o = defaultMethods();
    if (!obj || typeof obj !== "object") return o;
    PAY_ORDER.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = !!obj[k];
    });
    return o;
  }

  function intersectMethods(a, b) {
    var p = normalizeMethods(a);
    var s = normalizeMethods(b);
    var out = {};
    PAY_ORDER.forEach(function (k) {
      out[k] = !!p[k] && !!s[k];
    });
    return out;
  }

  function orderedKeys(methods) {
    return PAY_ORDER.filter(function (k) {
      return methods[k] && PAY_ICONS[k] && !PAY_HIDDEN[k];
    });
  }

  function inferStoreIdFromDraft(draft) {
    var items = (draft && draft.items) || [];
    for (var i = 0; i < items.length; i += 1) {
      var d = items[i] && items[i].data;
      if (d && d.store_id) return String(d.store_id);
    }
    return null;
  }

  function loadPaymentMethods(draft) {
    return fetch(apiUrl("/api/core/checkout-payment-methods"))
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var plat = normalizeMethods(j && j.methods);
        var sid = inferStoreIdFromDraft(draft);
        if (!sid) {
          state.methods = plat;
          return plat;
        }
        return fetch(apiUrl("/api/store/public/" + encodeURIComponent(sid)))
          .then(function (r2) {
            return r2.json();
          })
          .then(function (j2) {
            var sm = j2 && j2.store && j2.store.checkout_payment_methods;
            state.methods = sm && typeof sm === "object" ? intersectMethods(plat, sm) : plat;
            return state.methods;
          });
      })
      .catch(function () {
        state.methods = defaultMethods();
        return state.methods;
      });
  }

  function fetchWalletBalance() {
    if (!global.PlatformAPI || typeof global.PlatformAPI.getToken !== "function" || !global.PlatformAPI.getToken()) {
      return Promise.resolve(null);
    }
    return global.PlatformAPI.api("/api/wallet/me")
      .then(function (payload) {
        var bal = Number(payload && payload.balance);
        return Number.isFinite(bal) ? bal : 0;
      })
      .catch(function () {
        return global.PlatformAPI.api("/api/wallet")
          .then(function (w) {
            return Number(w.balance) || 0;
          })
          .catch(function () {
            return null;
          });
      });
  }

  function loadEwPayBalance() {
    state.ewLoading = true;
    state.ewBalance = null;
    return fetchWalletBalance().then(function (bal) {
      state.ewBalance = bal == null || !Number.isFinite(bal) ? null : roundMoney(bal);
      state.ewLoading = false;
      return state.ewBalance;
    });
  }

  function getSelected() {
    return state.selected;
  }

  function pickDefaultMethod(methods) {
    var m = normalizeMethods(methods || state.methods);
    var keys = orderedKeys(m);
    if (!keys.length) return null;
    var prefer = ["ew_pay", "cash_on_delivery", "mada", "visa"];
    for (var i = 0; i < prefer.length; i += 1) {
      if (m[prefer[i]]) return prefer[i];
    }
    return keys[0];
  }

  function ensureDefaultSelected(draft, onChange) {
    if (state.selected && normalizeMethods(state.methods)[state.selected]) {
      return state.selected;
    }
    var fromDraft = draft && draft.payment_method ? String(draft.payment_method) : "";
    if (fromDraft && normalizeMethods(state.methods)[fromDraft]) {
      setSelected(fromDraft, onChange);
      return fromDraft;
    }
    var def = pickDefaultMethod(state.methods);
    if (def) setSelected(def, onChange);
    return def;
  }

  function setSelected(method, onChange) {
    state.selected = method ? String(method) : null;
    if (state.selected === "ew_pay") loadEwPayBalance().then(function () {
      if (typeof onChange === "function") onChange(state.selected);
    });
    else if (typeof onChange === "function") onChange(state.selected);
  }

  function validateEwPay(grandTotal) {
    if (state.selected !== "ew_pay") return { ok: true };
    var grand = grandTotal == null ? null : roundMoney(grandTotal);
    var bal = state.ewBalance;
    if (grand == null) return { ok: false, message: "يُحسب الإجمالي بعد تحديد التوصيل" };
    if (bal == null || !Number.isFinite(bal)) return { ok: false, message: "تعذّر قراءة رصيد المحفظة" };
    if (roundMoney(bal) < grand) return { ok: false, message: "رصيد المحفظة غير كافٍ لهذا الطلب" };
    return { ok: true };
  }

  function renderOptions(container, methods, selected, onSelect) {
    if (!container) return;
    var keys = orderedKeys(methods || state.methods || defaultMethods());
    container.innerHTML = "";
    keys.forEach(function (key) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "checkout-pay-option" + (selected === key ? " is-selected" : "");
      btn.setAttribute("data-pay-method", key);
      btn.setAttribute("aria-pressed", selected === key ? "true" : "false");
      btn.innerHTML =
        '<span class="checkout-pay-option__radio" aria-hidden="true"></span>' +
        '<img class="checkout-pay-option__icon" src="' +
        PAY_ICONS[key] +
        '" alt="" width="36" height="24" loading="lazy" />' +
        '<span class="checkout-pay-option__label">' +
        (LABELS_AR[key] || key) +
        "</span>";
      btn.addEventListener("click", function () {
        setSelected(key, onSelect);
        renderOptions(container, methods || state.methods, state.selected, onSelect);
        syncEwPayPanel();
      });
      container.appendChild(btn);
    });
    syncEwPayPanel();
  }

  function syncEwPayPanel() {
    var panel = document.getElementById("checkoutEwPayPanel");
    if (!panel) return;
    if (state.selected !== "ew_pay") {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var avail = document.getElementById("checkoutEwPayAvail");
    var order = document.getElementById("checkoutEwPayOrder");
    var after = document.getElementById("checkoutEwPayAfter");
    var warn = document.getElementById("checkoutEwPayWarn");
    var grand = panel.getAttribute("data-grand-total");
    var grandNum = grand != null && grand !== "" ? Number(grand) : null;
    if (order) {
      order.textContent =
        grandNum == null || !Number.isFinite(grandNum) ? "يُحسب بعد التوصيل" : fmtMoney(grandNum) + " ر.س";
    }
    if (avail) {
      avail.textContent =
        state.ewLoading || state.ewBalance == null ? "…" : fmtMoney(state.ewBalance) + " ر.س";
    }
    var afterVal = null;
    if (grandNum != null && state.ewBalance != null && Number.isFinite(state.ewBalance)) {
      afterVal = roundMoney(state.ewBalance - grandNum);
    }
    if (after) after.textContent = afterVal == null ? "—" : fmtMoney(afterVal) + " ر.س";
    var insufficient =
      grandNum != null &&
      state.ewBalance != null &&
      Number.isFinite(state.ewBalance) &&
      roundMoney(state.ewBalance) < roundMoney(grandNum);
    if (warn) warn.hidden = !insufficient;
    panel.classList.toggle("checkout-ew-panel--warn", !!insufficient);
  }

  function setGrandTotalForEwPay(grandTotal) {
    var panel = document.getElementById("checkoutEwPayPanel");
    if (!panel) return;
    if (grandTotal == null || !Number.isFinite(Number(grandTotal))) {
      panel.removeAttribute("data-grand-total");
    } else {
      panel.setAttribute("data-grand-total", String(roundMoney(grandTotal)));
    }
    syncEwPayPanel();
  }

  global.ErvenowCheckoutPayment = {
    loadPaymentMethods: loadPaymentMethods,
    renderOptions: renderOptions,
    getSelected: getSelected,
    setSelected: setSelected,
    ensureDefaultSelected: ensureDefaultSelected,
    pickDefaultMethod: pickDefaultMethod,
    loadEwPayBalance: loadEwPayBalance,
    validateEwPay: validateEwPay,
    setGrandTotalForEwPay: setGrandTotalForEwPay,
    fmtMoney: fmtMoney,
    roundMoney: roundMoney,
  };
})(typeof window !== "undefined" ? window : global);
