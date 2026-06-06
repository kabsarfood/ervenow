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
    var hidePanelHead = opts.hidePanelHead === true;
    var headHtml = hidePanelHead
      ? ""
      : '<header class="lp-cart-card lp-cart-card--head">' +
        '<div class="lp-cart-card--head__bar">' +
        '<a href="' +
        continueHref +
        '" class="lp-cart-continue-link" id="lpCartContinueShop" data-erv-cart-continue>← استمرار التسوق</a>' +
        '<div class="lp-cart-card--head__title-wrap">' +
        '<span class="lp-cart-card--head__cart-icon" aria-hidden="true">🛒</span>' +
        '<h2 id="lpCartDialogTitle" class="lp-cart-card--head__title">السلة</h2>' +
        "</div>" +
        "</div>" +
        '<p id="lpCartPanelSub" class="lp-cart-card--head__sub" hidden>أضف منتجات أو خدمات، ثم أكمل الدفع.</p>' +
        "</header>";
    return (
      '<div class="lp-cart-panel__surface">' +
      headHtml +
      '<div class="lp-cart-stack">' +
      '<section id="lpCartItemsCard" class="lp-cart-card lp-cart-card--items lp-cart-card--accordion" aria-labelledby="lpCartLinesHeading">' +
      '<details class="lp-cart-accordion lp-cart-accordion--items" id="lpCartItemsAccordion" open>' +
      '<summary class="lp-cart-accordion__trigger lp-cart-accordion__trigger--items">' +
      '<span class="lp-cart-accordion__icon" aria-hidden="true">🛒</span>' +
      '<span class="lp-cart-accordion__label" id="lpCartLinesHeading">تفاصيل المنتجات</span>' +
      '<span class="lp-cart-accordion__meta" id="lpCartItemsToggleMeta">السلة فارغة</span>' +
      '<span class="lp-cart-accordion__chev" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="lp-cart-accordion__panel lp-cart-card__body lp-cart-card__body--items">' +
      '<div id="lpCartLines" class="lp-cart-panel__list"></div>' +
      '<p id="lpCartEmpty" class="lp-cart-panel__empty" hidden>السلة فارغة — ابدأ من أحد الأقسام:</p>' +
      '<div id="lpCartEmptyCta" class="lp-cart-panel__empty-cta" hidden>' +
      '<a class="lp-cart-panel__empty-btn" href="/stores">متاجر</a>' +
      '<a class="lp-cart-panel__empty-btn" href="/services">خدمات</a>' +
      '<a class="lp-cart-panel__empty-btn" href="/delivery-services.html">توصيل</a>' +
      '<a class="lp-cart-panel__empty-btn lp-cart-panel__empty-btn--primary" href="/start-now.html">ابدأ طلباً</a>' +
      "</div>" +
      "</div>" +
      "</details>" +
      "</section>" +
      '<section id="lpCartSummary" class="lp-cart-card lp-cart-card--fin lp-cart-card--accordion" hidden>' +
      '<details class="lp-cart-accordion lp-cart-accordion--fin">' +
      '<summary class="lp-cart-accordion__trigger lp-cart-accordion__trigger--fin">' +
      '<span class="lp-cart-accordion__icon" aria-hidden="true">💰</span>' +
      '<span class="lp-cart-accordion__label">ملخص المبالغ</span>' +
      '<span class="lp-cart-accordion__meta" id="lpCartFinToggleMeta">عرض التفاصيل</span>' +
      '<span class="lp-cart-accordion__chev" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="lp-cart-accordion__panel lp-cart-card__body">' +
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
      "<span>الضريبة (15%)</span>" +
      '<span class="lp-cart-panel__fin-val" id="lpCartVat">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
      "</div>" +
      (showFullFin
        ? '<div class="lp-cart-panel__fin-row lp-cart-panel__fin-row--comm">' +
          "<span>عمولة المنصة (7%)</span>" +
          '<span class="lp-cart-panel__fin-val" id="lpCartComm">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
          "</div>"
        : "") +
      '<div class="lp-cart-panel__fin-row lp-cart-panel__fin-row--grand">' +
      "<span>الإجمالي</span>" +
      '<span class="lp-cart-panel__fin-val" id="lpCartTotal">٠٫٠٠ <small class="lp-cart-panel__cur">ر.س</small></span>' +
      "</div>" +
      "</div>" +
      "</details>" +
      "</section>" +
      '<section id="lpCartPayCard" class="lp-cart-card lp-cart-card--pay-methods lp-cart-card--accordion" hidden>' +
      '<details class="lp-cart-accordion lp-cart-accordion--pay">' +
      '<summary class="lp-cart-accordion__trigger lp-cart-accordion__trigger--green">' +
      '<span class="lp-cart-accordion__icon" aria-hidden="true">💳</span>' +
      '<span class="lp-cart-accordion__label">وسيلة الدفع</span>' +
      '<span class="lp-cart-accordion__meta" id="lpCartPayToggleMeta">اختر وسيلة</span>' +
      '<span class="lp-cart-accordion__chev" aria-hidden="true"></span>' +
      "</summary>" +
      '<div class="lp-cart-accordion__panel lp-cart-card__body lp-cart-card__body--pay-methods" id="lpCartPaySection">' +
      '<div id="lpCartPayIcons" class="erv-pay-cards erv-pay-cards--cart" role="group" aria-label="وسائل الدفع"></div>' +
      '<select id="lpCartPaySelect" class="erv-pay-select" hidden aria-hidden="true" tabindex="-1"></select>' +
      '<div id="lpCartPayLuxeWrap" class="erv-pay-luxe-wrap" hidden></div>' +
      '<div id="lpCartEwPayDetail" class="erv-ew-pay-card" hidden>' +
      '<div class="erv-ew-pay-card__rows">' +
      '<div class="erv-ew-pay-card__row"><span class="erv-ew-pay-card__label">الرصيد المتاح</span>' +
      '<strong class="erv-ew-pay-card__val" id="lpCartEwPayAvail">—</strong></div>' +
      '<div class="erv-ew-pay-card__row"><span class="erv-ew-pay-card__label">قيمة الطلب</span>' +
      '<strong class="erv-ew-pay-card__val" id="lpCartEwPayOrder">—</strong></div>' +
      '<div class="erv-ew-pay-card__row erv-ew-pay-card__row--after"><span class="erv-ew-pay-card__label">الرصيد بعد العملية</span>' +
      '<strong class="erv-ew-pay-card__val" id="lpCartEwPayAfter">—</strong></div>' +
      "</div>" +
      '<p id="lpCartEwPayInsufficient" class="erv-ew-pay-card__warn" hidden>رصيد المحفظة غير كافٍ</p>' +
      '<a id="lpCartEwPayTopup" class="erv-ew-pay-card__topup" href="/wallet.html" hidden>شحن المحفظة</a>' +
      '<span id="lpCartEwPayBalance" class="visually-hidden" aria-hidden="true"></span>' +
      "</div>" +
      "</div>" +
      "</details>" +
      "</section>" +
      '<section id="lpCartFooter" class="lp-cart-card lp-cart-card--checkout lp-cart-card--checkout-sticky" hidden>' +
      '<div class="lp-cart-card__body lp-cart-card__body--checkout">' +
      '<button type="button" class="lp-cart-panel__checkout" id="' +
      checkoutId +
      '" disabled>إتمام الطلب</button>' +
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

  function rememberCartReturnUrl() {
    try {
      var path = global.location && global.location.pathname;
      if (!path || path === "/cart") return;
      global.sessionStorage.setItem(
        "erv_cart_return_url",
        path + (global.location.search || "") + (global.location.hash || "")
      );
    } catch (e0) {}
  }

  function initContinueShopping(panel) {
    var link = document.getElementById("lpCartContinueShop");
    if (!link || link.__ervCartContinueBound) return;
    link.__ervCartContinueBound = true;
    link.addEventListener("click", function (e) {
      var stored = "";
      try {
        stored = global.sessionStorage.getItem("erv_cart_return_url") || "";
      } catch (e1) {}
      if (stored && stored !== "/cart") {
        e.preventDefault();
        if (panel && panel.classList.contains("lp-cart-panel--open")) {
          panel.classList.remove("lp-cart-panel--open");
          var wrap = document.getElementById("lpCartWrap");
          if (wrap) wrap.classList.remove("lp-cart-wrap--portaled");
          document.body.classList.remove("lp-cart-no-scroll");
          if (global.ErvenowViewport && ErvenowViewport.unlockScroll) ErvenowViewport.unlockScroll();
        }
        global.location.href = stored;
        return;
      }
      if (global.history && global.history.length > 1) {
        e.preventDefault();
        if (panel && panel.classList.contains("lp-cart-panel--open")) {
          panel.classList.remove("lp-cart-panel--open");
          var wrap2 = document.getElementById("lpCartWrap");
          if (wrap2) wrap2.classList.remove("lp-cart-wrap--portaled");
          document.body.classList.remove("lp-cart-no-scroll");
          if (global.ErvenowViewport && ErvenowViewport.unlockScroll) ErvenowViewport.unlockScroll();
        }
        global.history.back();
      }
    });
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
        rememberCartReturnUrl();
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

    initContinueShopping(panel);
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
    if (global.ErvenowGuestShell && typeof ErvenowGuestShell.syncHeaderLayout === "function") {
      ErvenowGuestShell.syncHeaderLayout();
    } else if (global.ErvenowViewport && typeof ErvenowViewport.syncHeaderHeight === "function") {
      ErvenowViewport.syncHeaderHeight();
    }

    var checkout = document.getElementById("lpCartCheckoutBtn");
    if (checkout) {
      checkout.addEventListener("click", function () {
        if (global.ErvenowCart && typeof global.ErvenowCart.goCheckout === "function") {
          global.ErvenowCart.goCheckout();
        } else if (typeof global.handleLpCartCheckoutClick === "function") {
          global.handleLpCartCheckoutClick();
        }
      });
    }

    if (typeof global.updateCartCount === "function") global.updateCartCount();
  }

  global.ErvenowCartUI = {
    cartPanelInnerHtml: cartPanelInnerHtml,
    initCartToggle: initCartToggle,
    initContinueShopping: initContinueShopping,
    rememberCartReturnUrl: rememberCartReturnUrl,
    mountGuestHeaderCart: mountGuestHeaderCart,
  };
})(typeof window !== "undefined" ? window : global);
