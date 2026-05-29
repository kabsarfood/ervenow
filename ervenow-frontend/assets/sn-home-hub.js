/**
 * «اختر ما يناسبك» — قسم واحد مفتوح؛ إغلاق الباقي عند الفتح.
 */
(function () {
  "use strict";

  function initHomeHub(root) {
    if (!root) return;
    var items = Array.prototype.slice.call(root.querySelectorAll("details.sn-hub-item"));
    if (!items.length) return;

    items.forEach(function (detailsEl) {
      if (!detailsEl.getAttribute("name")) {
        detailsEl.setAttribute("name", "ervenow-home-hub");
      }

      detailsEl.addEventListener("toggle", function () {
        if (!detailsEl.open) return;
        items.forEach(function (other) {
          if (other !== detailsEl && other.open) {
            other.open = false;
          }
        });
      });
    });
  }

  function boot() {
    initHomeHub(document.getElementById("snHomeHub"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
