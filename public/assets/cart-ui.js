/**
 * ERVENOW — واجهة السلة الموحّدة (نفس أسلوب لوحة الزائر / الرئيسية)
 */
(function (global) {
  "use strict";

  function cartPanelInnerHtml(opts) {
    opts = opts || {};
    var continueHref = opts.continueHref || "/dashboard";
    var checkoutId = opts.checkoutId || "lpCartCheckoutBtn";
    var showFullFin = opts.showFullFin !== false;
    return (
      '<div class="lp-cart-panel__surface">' +
      '<header class="lp-cart-card lp-cart-card--head">' +
      '<div class="lp-cart-card--head__row">' +
      '<h2 id="lpCartDialogTitle" class="lp-cart-card--head__title">السلة</h2>' +
      "</div>" +
      '<a href="' +
      continueHref +
      '" class="lp-cart-card--head__shop" id="lpCartContinueShop">استمر بالتسوق</a>' +
      '<p id="lpCartPanelSub" class="lp-cart-card--head__sub" hidden>أضف منتجات أو خدمات، ثم أكمل الدفع.</p>' +
      "</header>" +
      '<div class="lp-cart-stack">' +
      '<section class="lp-cart-card lp-cart-card--items" aria-labelledby="lpCartLinesHeading">' +
      '<div class="lp-cart-card__labelbar">' +
      '<h3 id="lpCartLinesHeading" class="lp-cart-card__title">تفاصيل المنتجات</h3>' +
      "</div>" +
      '<div class="lp-cart-card__body lp-cart-card__body--items">' +
      '<div id="lpCartLines" class="lp-cart-panel__list"></div>' +
      '<p id="lpCartEmpty" class="lp-cart-panel__empty" hidden>السلة فارغة — ابدأ من أحد الأقسام:</p>' +
      '<div id="lpCartEmptyCta" class="lp-cart-panel__empty-cta" hidden>' +
      '<a class="lp-cart-panel__empty-btn" href="/stores">متاجر</a>' +
      '<a class="lp-cart-panel__empty-btn" href="/services">خدمات</a>' +
      '<a class="lp-cart-panel__empty-btn" href="/delivery-services.html">توصيل</a>' +
      '<a class="lp-cart-panel__empty-btn lp-cart-panel__empty-btn--primary" href="/start-now.html">ابدأ طلباً</a>' +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section id="lpCartSummary" class="lp-cart-card lp-cart-card--fin" hidden>' +
      '<div class="lp-cart-card__labelbar">' +
      '<h3 class="lp-cart-card__title">ملخص المبالغ</h3>' +
      "</div>" +
      '<div class="lp-cart-card__body">' +
      '<div class="lp-cart-panel__fin-row">' +
      "<span>المجموع الفرعي</span>" +
      '<span class="lp-cart-panel__fin-val" id="lpCartSub">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
      "</div>" +
      (showFullFin
        ? '<div class="lp-cart-panel__fin-row">' +
          "<span>أجرة التوصيل</span>" +
          '<span class="lp-cart-panel__fin-val" id="lpCartDel">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
          "</div>" +
          '<p id="lpCartDelNote" class="lp-cart-panel__fin-note" hidden>لطلبات المتجر: حدّد موقع التوصيل لحساب الأجرة (كم × 2.3 ر.س).</p>'
        : "") +
      '<div class="lp-cart-panel__fin-row">' +
      "<span>القيمة المضافة 15%</span>" +
      '<span class="lp-cart-panel__fin-val" id="lpCartVat">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
      "</div>" +
      (showFullFin
        ? '<details class="lp-cart-panel__fin-details">' +
          "<summary>تفاصيل إضافية (عمولة المنصة)</summary>" +
          '<div class="lp-cart-panel__fin-row">' +
          "<span>عمولة المنصة (7%)</span>" +
          '<span class="lp-cart-panel__fin-val" id="lpCartComm">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
          "</div>" +
          "</details>"
        : "") +
      '<div class="lp-cart-panel__fin-row lp-cart-panel__fin-row--grand">' +
      "<span>المجموع الكلي</span>" +
      '<span class="lp-cart-panel__fin-val" id="lpCartTotal">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section id="lpCartFooter" class="lp-cart-card lp-cart-card--pay" hidden>' +
      '<div class="lp-cart-card__body lp-cart-card__body--pay">' +
      '<button type="button" class="lp-cart-panel__checkout" id="' +
      checkoutId +
      '" disabled>إتمام العملية</button>' +
      '<div class="lp-cart-trust" aria-hidden="false">' +
      '<span class="lp-cart-trust__item">🔒 دفع آمن</span>' +
      '<span class="lp-cart-trust__item">⚡ إتمام سريع</span>' +
      '<span class="lp-cart-trust__item">🛡️ محمي</span>' +
      "</div>" +
      "</div>" +
      "</section>" +
      "</div>" +
      "</div>"
    );
  }

  function initCartToggle() {
    var wrap = document.getElementById("lpCartWrap");
    var btn = document.getElementById("lpCartToggle");
    var panel = document.getElementById("lpCartPanel");
    var backdrop = document.getElementById("lpCartBackdrop");
    if (!wrap || !btn || !panel) return;

    var wrapHome = null;

    function mountCartLayers() {
      if (!wrapHome) {
        wrapHome = { parent: wrap.parentNode, next: wrap.nextSibling };
      }
      if (backdrop) {
        document.body.appendChild(backdrop);
        backdrop.classList.add("lp-cart-backdrop--open");
        backdrop.setAttribute("aria-hidden", "false");
      }
      document.body.appendChild(wrap);
      wrap.classList.add("lp-cart-wrap--portaled");
    }

    function unmountCartLayers() {
      if (backdrop) {
        backdrop.classList.remove("lp-cart-backdrop--open");
        backdrop.setAttribute("aria-hidden", "true");
      }
      wrap.classList.remove("lp-cart-wrap--portaled");
      if (wrapHome && wrapHome.parent) {
        wrapHome.parent.insertBefore(wrap, wrapHome.next);
      }
    }

    function setOpen(open) {
      if (open) {
        mountCartLayers();
        panel.classList.add("lp-cart-panel--open");
        document.body.classList.add("lp-cart-no-scroll");
        if (global.ErvenowViewport && ErvenowViewport.lockScroll) ErvenowViewport.lockScroll();
        if (global.ErvenowViewport && ErvenowViewport.refresh) ErvenowViewport.refresh();
        panel.setAttribute("aria-hidden", "false");
        btn.setAttribute("aria-expanded", "true");
        if (typeof global.renderHeaderCartPreview === "function") global.renderHeaderCartPreview();
      } else {
        panel.classList.remove("lp-cart-panel--open");
        unmountCartLayers();
        document.body.classList.remove("lp-cart-no-scroll");
        if (global.ErvenowViewport && ErvenowViewport.unlockScroll) ErvenowViewport.unlockScroll();
        panel.setAttribute("aria-hidden", "true");
        btn.setAttribute("aria-expanded", "false");
        if (typeof global.resetLpCartPayStep === "function") global.resetLpCartPayStep();
      }
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!panel.classList.contains("lp-cart-panel--open"));
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setOpen(false);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("lp-cart-panel--open")) setOpen(false);
    });
  }

  function mountGuestHeaderCart(toolsEl, linkEl) {
    if (!toolsEl || !linkEl || document.getElementById("lpCartWrap")) return;

    var badge = linkEl.querySelector("#cartCount") || linkEl.querySelector(".dash-header-cart__badge");
    var countText = badge ? badge.textContent : "0";
    var countEmpty = badge && badge.getAttribute("data-empty");

    var wrap = document.createElement("div");
    wrap.className = "lp-cart-wrap dash-cart-wrap";
    wrap.id = "lpCartWrap";
    wrap.innerHTML =
      '<button type="button" class="cart-btn dash-header-cart-btn" id="lpCartToggle" aria-expanded="false" aria-controls="lpCartPanel" aria-haspopup="dialog">' +
      '<span aria-hidden="true">🛒</span>' +
      '<span class="dash-header-cart__label">السلة</span>' +
      '<span class="dash-header-cart__badge" id="cartCount"' +
      (countEmpty ? ' data-empty="true"' : "") +
      ">" +
      countText +
      "</span>" +
      "</button>" +
      '<div class="lp-cart-backdrop" id="lpCartBackdrop" aria-hidden="true"></div>' +
      '<div class="lp-cart-panel lp-cart-panel--empty" id="lpCartPanel" role="dialog" aria-modal="true" aria-labelledby="lpCartDialogTitle" aria-hidden="true">' +
      cartPanelInnerHtml({ continueHref: "/dashboard", showFullFin: true }) +
      "</div>";

    linkEl.replaceWith(wrap);
    initCartToggle();

    var checkout = document.getElementById("lpCartCheckoutBtn");
    if (checkout && typeof global.checkout === "function") {
      checkout.addEventListener("click", function () {
        global.checkout();
      });
    }

    if (typeof global.updateCartCount === "function") global.updateCartCount();
  }

  global.ErvenowCartUI = {
    cartPanelInnerHtml: cartPanelInnerHtml,
    initCartToggle: initCartToggle,
    mountGuestHeaderCart: mountGuestHeaderCart,
  };
})(typeof window !== "undefined" ? window : global);
