/**
 * ERVENOW Mobile Harmony — P0 (guest-shell menu + init)
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

  function closeGuestNav() {
    document.body.classList.remove("erv-harmony-nav-open");
    var btn = document.querySelector(".erv-harmony-menu__btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function openGuestNav() {
    document.body.classList.add("erv-harmony-nav-open");
    var btn = document.querySelector(".erv-harmony-menu__btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function setupGuestHeader() {
    if (!isMobile()) return;
    if (!document.body.classList.contains("guest-shell-page")) return;

    var inner = document.querySelector(".dash-site-header__inner");
    if (!inner || inner.dataset.ervHarmonyReady === "1") return;

    var nav = inner.querySelector(".dash-site-header__nav");
    var links = nav && nav.querySelector(".dash-site-header__links");
    if (!nav || !links) return;

    if (!inner.querySelector(".erv-harmony-identity")) {
      var identity = document.createElement("a");
      identity.className = "erv-harmony-identity";
      identity.href = "/";
      identity.setAttribute("aria-label", "ERVENOW — المنصة الذكية");
      identity.innerHTML =
        '<span class="erv-harmony-identity__name">ERVENOW</span>' +
        '<span class="erv-harmony-identity__tag">المنصة الذكية</span>';
      inner.insertBefore(identity, nav);
    }

    if (!inner.querySelector(".erv-harmony-menu")) {
      var menu = document.createElement("div");
      menu.className = "erv-harmony-menu";
      menu.innerHTML =
        '<button type="button" class="erv-harmony-menu__btn" aria-expanded="false" aria-controls="ervHarmonyNavPanel" aria-label="فتح القائمة">☰</button>';
      inner.appendChild(menu);

      menu.querySelector(".erv-harmony-menu__btn").addEventListener("click", function () {
        if (document.body.classList.contains("erv-harmony-nav-open")) closeGuestNav();
        else openGuestNav();
      });
    }

    if (!document.getElementById("ervHarmonyNavBackdrop")) {
      var backdrop = document.createElement("div");
      backdrop.id = "ervHarmonyNavBackdrop";
      backdrop.className = "erv-harmony-nav-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", closeGuestNav);
      document.body.appendChild(backdrop);
    }

    if (!document.getElementById("ervHarmonyNavPanel")) {
      var panel = document.createElement("div");
      panel.id = "ervHarmonyNavPanel";
      panel.className = "erv-harmony-nav-panel";
      panel.setAttribute("role", "menu");
      panel.appendChild(links.cloneNode(true));
      document.body.appendChild(panel);

      panel.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", closeGuestNav);
      });
    }

    inner.dataset.ervHarmonyReady = "1";
  }

  function init() {
    if (!isMobile()) {
      closeGuestNav();
      return;
    }
    setupGuestHeader();
  }

  global.ErvenowMobileHarmony = { init: init, isMobile: isMobile };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.addEventListener("resize", function () {
    if (!isMobile()) closeGuestNav();
  });
})(window);
