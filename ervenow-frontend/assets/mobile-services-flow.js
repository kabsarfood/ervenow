/**
 * ERVENOW Phase B P0 — مسار خدمات: مقدّم → طلب → إرسال (جوال)
 */
(function (global) {
  var MQ =
    "(max-width: 640px), ((max-width: 932px) and (max-height: 500px) and (pointer: coarse))";

  function isMobile() {
    try {
      return global.matchMedia(MQ).matches;
    } catch (e) {
      return global.innerWidth <= 640;
    }
  }

  function ensureSheet() {
    var existing = document.getElementById("ervSvcOrderSheet");
    if (existing) return existing;

    var wrap = document.createElement("div");
    wrap.id = "ervSvcOrderSheet";
    wrap.className = "erv-svc-order-sheet";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML =
      '<div class="erv-svc-order-sheet__backdrop" data-erv-svc-close="1"></div>' +
      '<div class="erv-svc-order-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="ervSvcSheetTitle">' +
      '<div class="erv-svc-order-sheet__head">' +
      '<h2 class="erv-svc-order-sheet__title" id="ervSvcSheetTitle">طلب الخدمة</h2>' +
      '<button type="button" class="erv-svc-order-sheet__close" data-erv-svc-close="1" aria-label="إغلاق">×</button>' +
      "</div>" +
      '<div class="erv-svc-order-sheet__body" id="ervSvcSheetBody"></div>' +
      "</div>";
    document.body.appendChild(wrap);

    wrap.querySelectorAll("[data-erv-svc-close]").forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });

    return wrap;
  }

  function closeSheet() {
    var sheet = document.getElementById("ervSvcOrderSheet");
    if (!sheet) return;
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    if (global.ErvenowViewport && typeof ErvenowViewport.unlockScroll === "function") {
      ErvenowViewport.unlockScroll();
    }
  }

  function openSheet(providerName) {
    var panel = document.getElementById("svcOrderPanel");
    var body = document.getElementById("ervSvcSheetBody");
    if (!panel || !body) return;

    var sheet = ensureSheet();
    if (!body.contains(panel)) {
      body.appendChild(panel);
      panel.classList.add("erv-svc-panel--sheet-ready");
    }

    var title = document.getElementById("ervSvcSheetTitle");
    if (title) {
      title.textContent = providerName ? "طلب — " + providerName : "طلب الخدمة";
    }

    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    if (global.ErvenowViewport && typeof ErvenowViewport.lockScroll === "function") {
      ErvenowViewport.lockScroll();
    }

    var district = document.getElementById("svcDistrict");
    if (district) global.setTimeout(function () { district.focus(); }, 280);
  }

  function openForStore(storeId) {
    var name = "";
    var card = document.querySelector('.store-card[data-store-id="' + storeId + '"]');
    if (card) {
      var h = card.querySelector("h3");
      if (h) name = h.textContent.trim();
    }
    openSheet(name || "مقدّم الخدمة");
  }

  function init() {
    if (!isMobile()) return;
    if (!document.getElementById("svcOrderPanel")) return;
    document.body.classList.add("services-page");
    ensureSheet();
  }

  global.ErvenowMobileServicesFlow = {
    init: init,
    openForStore: openForStore,
    openSheet: openSheet,
    closeSheet: closeSheet,
    isMobile: isMobile,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
