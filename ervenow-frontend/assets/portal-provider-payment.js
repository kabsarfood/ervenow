(function (global) {
  "use strict";
  var PAY_ROWS = [
    { key: "ew_pay", label: "EW PAY" },
    { key: "mada", label: "مدى" },
    { key: "visa", label: "Visa" },
    { key: "mastercard", label: "Mastercard" },
    { key: "apple_pay", label: "Apple Pay" },
    { key: "stc_pay", label: "STC Pay" },
    { key: "cash_on_delivery", label: "الدفع عند الوصول" },
    { key: "tabby", label: "Tabby" },
    { key: "tamara", label: "Tamara" },
  ];
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function renderPanel(prefix) {
    prefix = prefix || "pp";
    return (
      '<div class="pf-card mp-form" id="' + esc(prefix) + 'PayCard"><h3>وسائل الدفع (ERVENOW PAY)</h3>' +
      '<div id="' + esc(prefix) + 'PayGrid" class="pf-pay-grid"></div>' +
      '<button type="button" class="pf-btn pf-btn--primary" id="' + esc(prefix) + 'SavePay">حفظ وسائل الدفع</button></div>'
    );
  }
  function buildGrid(prefix, plat, eff) {
    var grid = document.getElementById(prefix + "PayGrid");
    if (!grid) return;
    grid.innerHTML = PAY_ROWS.map(function (row) {
      var pOn = !(plat && plat[row.key] === false);
      return (
        '<label class="hub-pay-row"><input type="checkbox" id="' + prefix + "Pay_" + row.key + '"' +
        (pOn ? "" : " disabled") + (pOn && eff && eff[row.key] ? " checked" : "") +
        " /><span>" + esc(row.label) + "</span></label>"
      );
    }).join("");
  }
  async function loadAndWire(opts) {
    opts = opts || {};
    var prefix = opts.prefix || "pp";
    if (!global.PlatformAPI) return;
    try {
      var platJ = await PlatformAPI.api("/api/core/checkout-payment-methods");
      var effJ = await PlatformAPI.api("/api/services/me/checkout-payment-methods");
      buildGrid(prefix, platJ.methods || platJ || {}, effJ.methods || {});
    } catch (e) {
      if (opts.onMessage) opts.onMessage((e && e.message) || String(e), false);
    }
    var saveBtn = document.getElementById(prefix + "SavePay");
    if (saveBtn) {
      saveBtn.onclick = async function () {
        try {
          var o = {};
          PAY_ROWS.forEach(function (row) {
            var cb = document.getElementById(prefix + "Pay_" + row.key);
            if (cb) o[row.key] = cb.disabled ? false : !!cb.checked;
          });
          var j = await PlatformAPI.api("/api/services/me/checkout-payment-methods", { method: "PATCH", body: { methods: o } });
          buildGrid(prefix, {}, j.methods || o);
          if (opts.onMessage) opts.onMessage("تم حفظ وسائل الدفع", true);
        } catch (e) {
          if (opts.onMessage) opts.onMessage((e && e.message) || String(e), false);
        }
      };
    }
  }
  global.ErvenowPortalProviderPayment = { renderPanel: renderPanel, loadAndWire: loadAndWire };
})(typeof window !== "undefined" ? window : global);
