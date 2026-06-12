/**
 * ERVENOW Banner Engine — معطّل على الواجهة العامة.
 * بنرات العروض تُدار عبر guest-offers-carousel.js و /api/core/platform-offers
 */
(function () {
  function detectTarget() {
    if (window.__ERV_BANNER_TARGET__) return window.__ERV_BANNER_TARGET__;
    return null;
  }

  function loadBanners() {}

  window.ErvenowBannerEngine = { load: loadBanners, detectTarget: detectTarget };
})();
