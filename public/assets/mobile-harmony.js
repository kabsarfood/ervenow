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

  function lockPageScroll() {
    if (global.ErvenowViewport && typeof global.ErvenowViewport.lockScroll === "function") {
      global.ErvenowViewport.lockScroll();
    }
  }

  function unlockPageScroll() {
    if (global.ErvenowViewport && typeof global.ErvenowViewport.unlockScroll === "function") {
      global.ErvenowViewport.unlockScroll();
    }
  }

  function ensureNavBackdrop() {
    if (document.getElementById("ervHarmonyNavBackdrop")) return;
    var backdrop = document.createElement("div");
    backdrop.id = "ervHarmonyNavBackdrop";
    backdrop.className = "erv-harmony-nav-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.addEventListener("click", closeHarmonyNav);
    document.body.appendChild(backdrop);
  }

  function closeHarmonyNav() {
    document.body.classList.remove("erv-harmony-nav-open");
    var guestBtn = document.querySelector(".erv-harmony-menu__btn");
    if (guestBtn) guestBtn.setAttribute("aria-expanded", "false");
    var homeBtn = document.getElementById("lpQuickNavBtn");
    var homePanel = document.getElementById("lpQuickNavPanel");
    var homeRoot = document.getElementById("lpQuickNav");
    if (homeBtn) homeBtn.setAttribute("aria-expanded", "false");
    if (homePanel) {
      homePanel.hidden = true;
      homePanel.style.removeProperty("top");
      homePanel.style.removeProperty("right");
      homePanel.style.removeProperty("left");
      homePanel.style.removeProperty("width");
    }
    if (homeRoot) homeRoot.classList.remove("is-open");
    unlockPageScroll();
  }

  function openGuestNav() {
    document.body.classList.add("erv-harmony-nav-open");
    var btn = document.querySelector(".erv-harmony-menu__btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
    lockPageScroll();
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
        if (document.body.classList.contains("erv-harmony-nav-open")) closeHarmonyNav();
        else openGuestNav();
      });
    }

    ensureNavBackdrop();

    if (!document.getElementById("ervHarmonyNavPanel")) {
      var panel = document.createElement("div");
      panel.id = "ervHarmonyNavPanel";
      panel.className = "erv-harmony-nav-panel";
      panel.setAttribute("role", "menu");
      panel.appendChild(links.cloneNode(true));
      document.body.appendChild(panel);

      panel.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", closeHarmonyNav);
      });
    }

    inner.dataset.ervHarmonyReady = "1";
  }

  function getHomeNavWidth() {
    var vw = global.innerWidth || 1280;
    if (isMobile()) {
      return Math.min(272, Math.max(200, vw - 16));
    }
    return Math.min(380, Math.max(320, Math.round(vw * 0.24)));
  }

  function ensurePanelParent(panel, parent) {
    if (panel && parent && panel.parentElement !== parent) {
      parent.appendChild(panel);
    }
  }

  function syncHomePanelAnchor(btn, panel, root) {
    if (!btn || !panel) return;
    var maxW = getHomeNavWidth();
    var r = btn.getBoundingClientRect();
    var vw = global.innerWidth || 1280;
    var gap = isMobile() ? 6 : 8;
    var top = Math.round(r.bottom + gap);
    var minLeft = 8;
    var panelLeft = Math.round(r.right - maxW);
    var maxLeft = Math.max(minLeft, vw - 8 - maxW);
    if (panelLeft < minLeft) panelLeft = minLeft;
    if (panelLeft > maxLeft) panelLeft = maxLeft;

    var btnCenter = r.left + r.width / 2;
    var caretX = Math.round(btnCenter - panelLeft);
    caretX = Math.max(22, Math.min(maxW - 22, caretX));

    ensurePanelParent(panel, document.body);
    if (isMobile()) {
      panel.classList.remove("lp-quick-dd__panel--desktop-pop");
    } else {
      panel.classList.add("lp-quick-dd__panel--desktop-pop");
    }

    panel.style.setProperty("--lp-home-nav-top", top + "px");
    panel.style.setProperty("--lp-home-nav-caret-x", caretX + "px");
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("top", top + "px", "important");
    panel.style.setProperty("left", panelLeft + "px", "important");
    panel.style.setProperty("right", "auto", "important");
    panel.style.removeProperty("inset-inline-start");
    panel.style.removeProperty("inset-inline-end");
    panel.style.setProperty("width", maxW + "px", "important");
  }

  function setupHomeQuickNav() {
    if (!document.body.classList.contains("lp-home-premium")) return;

    var root = document.getElementById("lpQuickNav");
    var btn = document.getElementById("lpQuickNavBtn");
    var panel = document.getElementById("lpQuickNavPanel");
    if (!root || !btn || !panel || root.dataset.ervHarmonyHome === "1") return;

    ensureNavBackdrop();
    panel.classList.add("lp-quick-dd__panel--harmony");
    if (!panel.querySelector(".lp-quick-dd__panel-scroll")) {
      var scroll = document.createElement("div");
      scroll.className = "lp-quick-dd__panel-scroll";
      while (panel.firstChild) scroll.appendChild(panel.firstChild);
      panel.appendChild(scroll);
    }
    ensurePanelParent(panel, document.body);

    function openHomeNav() {
      syncHomePanelAnchor(btn, panel, root);
      document.body.classList.add("erv-harmony-nav-open");
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      root.classList.add("is-open");
      if (isMobile()) lockPageScroll();
    }

    function toggleHomeNav(e) {
      e.preventDefault();
      e.stopPropagation();
      if (panel.hidden) openHomeNav();
      else closeHarmonyNav();
    }

    btn.addEventListener("click", toggleHomeNav, true);

    panel.querySelectorAll('[role="menuitem"]').forEach(function (el) {
      el.addEventListener("click", closeHarmonyNav);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) closeHarmonyNav();
    });

    document.addEventListener("click", function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closeHarmonyNav();
    });

    global.addEventListener(
      "resize",
      function () {
        ensurePanelParent(panel, document.body);
        if (!panel.hidden) syncHomePanelAnchor(btn, panel, root);
      },
      { passive: true }
    );

    global.addEventListener(
      "scroll",
      function () {
        if (panel.hidden) return;
        syncHomePanelAnchor(btn, panel, root);
      },
      { passive: true }
    );

    global.addEventListener("orientationchange", function () {
      global.setTimeout(function () {
        ensurePanelParent(panel, document.body);
        if (!panel.hidden) syncHomePanelAnchor(btn, panel, root);
      }, 200);
    });

    root.dataset.ervHarmonyHome = "1";
  }

  function init() {
    setupHomeQuickNav();
    if (!isMobile()) return;
    setupGuestHeader();
  }

  global.ErvenowMobileHarmony = {
    init: init,
    isMobile: isMobile,
    closeNav: closeHarmonyNav,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.addEventListener("resize", function () {
    if (isMobile()) return;
    if (!document.body.classList.contains("guest-shell-page")) return;
    closeHarmonyNav();
  });
})(window);
