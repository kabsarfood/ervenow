/**
 * ERVENOW — إصلاح ضغط العناوين وتداخلها مع البطاقات (كل الشاشات)
 * السبب: home-polish يخفي العنوان (sr-only 1px) ورابط «عرض الكل» مخفي على الجوال
 * فيصبح .erv-mp-hub-head بارتفاع 0 والبطاقات تبدو فوق/بدون عنوان.
 */
(function () {
  var STYLE_ID = "ervHomeTitleFixCss";
  if (document.getElementById(STYLE_ID)) return;
  var css =
    /* إلغاء إخفاء عناوين الأقسام */
    "body.lp-home-premium .sn-section--hub .sn-section__title--solo," +
    "body.lp-home-premium .erv-mp-hub-head .sn-section__title--solo," +
    "html.erv-mobile-shell body.lp-home-premium .sn-section--hub .sn-section__title--solo{" +
    "position:static!important;width:auto!important;height:auto!important;min-height:0!important;" +
    "max-width:none!important;padding:0!important;margin:0 0 12px!important;overflow:visible!important;" +
    "clip:auto!important;clip-path:none!important;white-space:normal!important;border:0!important;" +
    "display:block!important;font-size:clamp(1.15rem,2.6vw,1.35rem)!important;font-weight:800!important;" +
    "line-height:1.35!important;color:inherit!important;transform:none!important;z-index:3!important;" +
    "}" +
    /* ترتيب القسم: عنوان ثم بطاقات ثم ثقة */
    "body.lp-home-premium .sn-section--hub{" +
    "display:flex!important;flex-direction:column!important;align-items:stretch!important;" +
    "gap:clamp(12px,2.2vw,18px)!important;position:relative!important;z-index:1!important;" +
    "}" +
    "body.lp-home-premium .sn-section--hub > .erv-mp-hub-head{" +
    "order:-2!important;display:flex!important;flex-wrap:wrap!important;align-items:center!important;" +
    "justify-content:space-between!important;gap:8px 12px!important;width:100%!important;" +
    "min-height:1.6em!important;height:auto!important;margin:0!important;padding:0!important;" +
    "position:relative!important;z-index:3!important;flex:0 0 auto!important;" +
    "}" +
    "body.lp-home-premium .sn-section--hub > #snHomeHub{" +
    "order:0!important;position:relative!important;z-index:1!important;width:100%!important;" +
    "min-width:0!important;flex:0 0 auto!important;margin:0!important;" +
    "}" +
    "body.lp-home-premium .sn-section--hub > .sn-trust{" +
    "order:1!important;position:relative!important;z-index:1!important;margin:0!important;" +
    "}" +
    "body.lp-home-premium .sn-section--hub > #stats," +
    "body.lp-home-premium .sn-section--hub > .erv-mp-stats{" +
    "order:2!important;position:relative!important;z-index:1!important;margin:0!important;" +
    "}" +
    /* عناوين الأقسام الأخرى فوق محتواها */
    "body.lp-home-premium .erv-mp-section__title," +
    "body.lp-home-premium .erv-mp-discover .erv-mp-section__title," +
    "body.lp-home-premium h2.erv-mp-section__title," +
    "body.lp-home-premium .lp-section__title," +
    "body.lp-home-premium .lp-why__title{" +
    "position:relative!important;z-index:3!important;display:block!important;" +
    "width:auto!important;height:auto!important;min-height:1.2em!important;" +
    "margin:0 0 12px!important;overflow:visible!important;clip:auto!important;clip-path:none!important;" +
    "line-height:1.35!important;transform:none!important;" +
    "}" +
    /* شبكات لا تضغط الأعمدة */
    "body.lp-home-premium #snHomeHub," +
    "body.lp-home-premium .erv-mp-grid," +
    "body.lp-home-premium .erv-mp-products," +
    "body.lp-home-premium .erv-mp-promos{" +
    "min-width:0!important;align-items:stretch!important;" +
    "}" +
    "body.lp-home-premium #snHomeHub > *," +
    "body.lp-home-premium .erv-mp-grid > *{" +
    "min-width:0!important;" +
    "}" +
    "@media (max-width:640px){" +
    "body.lp-home-premium .sn-section--hub > .erv-mp-hub-head{margin-bottom:10px!important;}" +
    "body.lp-home-premium .sn-section--hub .sn-section__title--solo{font-size:clamp(1.1rem,4.5vw,1.25rem)!important;margin-bottom:0!important;}" +
    "body.lp-home-premium #snHomeHub{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;}" +
    "}" +
    "@media (min-width:641px) and (max-width:1024px){" +
    "body.lp-home-premium .sn-section--hub .sn-section__title--solo{font-size:clamp(1.2rem,2.4vw,1.35rem)!important;}" +
    "body.lp-home-premium #snHomeHub{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:12px!important;}" +
    "}" +
    "@media (min-width:1025px){" +
    "html:not(.erv-mobile-shell) body.lp-home-premium .sn-section--hub .sn-section__title--solo," +
    "html:not(.erv-mobile-shell) body.lp-home-premium .erv-mp-hub-head .sn-section__title--solo{" +
    "font-size:clamp(1.45rem,1.8vw,1.85rem)!important;margin:0!important;" +
    "}" +
    "html:not(.erv-mobile-shell) body.lp-home-premium .sn-section--hub > .erv-mp-hub-head{margin-bottom:14px!important;}" +
    "}";

  var el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);

  function pinHubHeadFirst() {
    var section = document.querySelector(".sn-section--hub");
    if (!section) return;
    var head = section.querySelector(":scope > .erv-mp-hub-head");
    var hub = section.querySelector(":scope > #snHomeHub");
    if (head && hub && head.nextElementSibling !== hub) {
      section.insertBefore(head, hub);
    } else if (head && section.firstElementChild !== head) {
      section.insertBefore(head, section.firstElementChild);
    }
  }

  function boot() {
    pinHubHeadFirst();
    try {
      var mo = new MutationObserver(function () {
        pinHubHeadFirst();
      });
      var section = document.querySelector(".sn-section--hub");
      if (section) mo.observe(section, { childList: true });
      setTimeout(function () {
        try {
          mo.disconnect();
        } catch (e) {}
      }, 6000);
    } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
