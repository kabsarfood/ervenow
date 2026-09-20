/**
 * ERVENOW Marketing Studio — Home Renderer (M1)
 * يقرأ Marketing Schema ويطبّق الترتيب والظهور — بدون عناصر مرئية جديدة.
 */
(function () {
  "use strict";

  var SURFACE = "home";
  var PARENT_SELECTORS = {
    body: function () {
      return document.body;
    },
    hub_section: function () {
      return document.querySelector('[data-marketing-slot="hub_section"]');
    },
    main: function () {
      return document.querySelector("main[data-marketing-region='main'], main");
    },
  };

  function resolveParent(key) {
    var fn = PARENT_SELECTORS[key];
    return fn ? fn() : null;
  }

  function slotEl(id) {
    return document.querySelector('[data-marketing-slot="' + id + '"]');
  }

  function setSlotVisibility(el, visible) {
    if (!el) return;
    if (visible) {
      el.removeAttribute("hidden");
      el.removeAttribute("aria-hidden");
      el.classList.remove("marketing-hidden");
    } else {
      el.setAttribute("hidden", "hidden");
      el.setAttribute("aria-hidden", "true");
      el.classList.add("marketing-hidden");
    }
  }

  function applyModuleVisibility(modules) {
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var el = slotEl(mod.id || mod.dom_slot);
      if (!el) continue;
      setSlotVisibility(el, !!mod.resolved_visible);
    }
  }

  function chromeAnchor(parent) {
    if (!parent || parent !== document.body) return parent ? parent.firstChild : null;
    var prereg = document.getElementById("ervPreRegBanner");
    var header =
      document.getElementById("top") ||
      document.querySelector(".lp-header.lp-header--refined, .dash-site-header, .lp-header");
    /* أبقِ شريط التسجيل ثم الهيدر في أعلى body — لا تُلحق الوحدات قبلهما */
    if (prereg && prereg.parentElement === parent) {
      if (header && header.parentElement === parent && prereg.nextElementSibling !== header) {
        parent.insertBefore(header, prereg.nextSibling);
      }
      return header && header.parentElement === parent ? header.nextSibling : prereg.nextSibling;
    }
    if (header && header.parentElement === parent) {
      if (parent.firstElementChild !== header) parent.insertBefore(header, parent.firstChild);
      return header.nextSibling;
    }
    return parent.firstChild;
  }

  function pinBodyChrome() {
    var body = document.body;
    if (!body) return;
    var prereg = document.getElementById("ervPreRegBanner");
    var header =
      document.getElementById("top") ||
      document.querySelector(".lp-header.lp-header--refined, .dash-site-header, .lp-header");
    var stage = document.querySelector(".erv-mp-stage");
    var hub = document.querySelector(".sn-section--hub");
    var discover = document.getElementById("ervMpDiscover");
    var main = document.querySelector("main[data-marketing-region='main'], main");
    var footer = document.querySelector(".lp-footer");
    var isDesktop = false;
    try {
      isDesktop =
        !document.documentElement.classList.contains("erv-mobile-shell") &&
        window.matchMedia("(min-width: 1025px)").matches;
    } catch (e) {}

    if (prereg) {
      if (body.firstElementChild !== prereg) body.insertBefore(prereg, body.firstElementChild);
      if (header && prereg.nextElementSibling !== header) body.insertBefore(header, prereg.nextSibling);
    } else if (header && body.firstElementChild !== header) {
      body.insertBefore(header, body.firstElementChild);
    }
    if (header && stage && header.nextElementSibling !== stage) {
      body.insertBefore(stage, header.nextSibling);
    }

    if (isDesktop) {
      var sequence = [prereg, header, stage, hub, discover, main, footer].filter(Boolean);
      if (sequence.length > 1) {
        body.insertBefore(sequence[0], body.firstChild);
        for (var i = 1; i < sequence.length; i++) {
          if (sequence[i - 1].nextElementSibling !== sequence[i]) {
            body.insertBefore(sequence[i], sequence[i - 1].nextSibling);
          }
        }
      }
    }

    if (window.ErvenowPreRegBanner && typeof window.ErvenowPreRegBanner.measure === "function") {
      window.ErvenowPreRegBanner.measure();
    }
  }

  function reorderParent(parentKey, modules) {
    var parent = resolveParent(parentKey);
    if (!parent || !modules || !modules.length) return;
    var sorted = modules.slice().sort(function (a, b) {
      return (a.display_order || 0) - (b.display_order || 0) || (a.priority || 0) - (b.priority || 0);
    });
    var marker = chromeAnchor(parent);
    for (var i = 0; i < sorted.length; i++) {
      var mod = sorted[i];
      if (!mod.resolved_visible) continue;
      var el = slotEl(mod.id || mod.dom_slot);
      if (!el || el.parentElement !== parent) continue;
      /* لا تحرّك الهيدر عبر append — يبقى ضمن الـ chrome في الأعلى */
      if (el.id === "top" || (el.classList && el.classList.contains("lp-header"))) continue;
      parent.insertBefore(el, marker);
      marker = el.nextSibling;
    }
    if (parentKey === "body") pinBodyChrome();
  }

  function groupByParent(modules) {
    var map = {};
    for (var i = 0; i < modules.length; i++) {
      var mod = modules[i];
      var key = mod.parent || "body";
      if (!map[key]) map[key] = [];
      map[key].push(mod);
    }
    return map;
  }

  function applyExperience(data) {
    if (!data || !Array.isArray(data.modules)) return;
    var modules = data.modules;
    applyModuleVisibility(modules);
    var groups = groupByParent(modules);
    var order = ["body", "hub_section", "main"];
    for (var p = 0; p < order.length; p++) {
      if (groups[order[p]]) reorderParent(order[p], groups[order[p]]);
    }
    document.documentElement.setAttribute("data-marketing-applied", "1");
    document.documentElement.setAttribute("data-marketing-surface", SURFACE);
    pinBodyChrome();
    try {
      window.dispatchEvent(
        new CustomEvent("ervenow:marketing-applied", { detail: { surface: SURFACE, experience: data } })
      );
    } catch (e) {}
  }

  function fetchExperience() {
    var base = "";
    try {
      if (window.PlatformAPI && typeof window.PlatformAPI.apiUrl === "function") {
        base = window.PlatformAPI.apiUrl("/api/core/marketing/home");
      } else {
        base = "/api/core/marketing/home";
      }
    } catch (e) {
      base = "/api/core/marketing/home";
    }
    return fetch(base, { credentials: "include", cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.ok !== false && (j.modules || (j.data && j.data.modules))) {
          return j.modules ? j : j.data || j;
        }
        if (j && j.modules) return j;
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function boot() {
    fetchExperience().then(function (data) {
      if (data) applyExperience(data);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
