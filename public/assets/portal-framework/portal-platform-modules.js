/**
 * ERVENOW — Platform Modules × Portal Navigation
 * يخفي عناصر القائمة المرتبطة بوحدات معطّلة (POS · Fleet · Pricing · Schedule · Meshwar).
 */
(function (global) {
  "use strict";

  var SECTION_MODULE_MAP = {
    pos: "ervenow_pos",
    fleet: "transport_fleet",
    pricing: "transport_pricing",
    schedule: "service_schedule",
    meshwar: "meshwar",
  };

  var cache = null;
  var loadPromise = null;

  function isEnabled(modules, moduleId) {
    if (!moduleId) return true;
    var row = modules && modules[moduleId];
    if (!row) return false;
    var s = String(row.status || "").toLowerCase();
    return s === "enabled" || s === "beta";
  }

  function loadModules() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;
    loadPromise = fetch("/api/core/platform-modules", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (j) {
        cache = (j && j.modules) || {};
        return cache;
      })
      .catch(function () {
        cache = {};
        return cache;
      });
    return loadPromise;
  }

  function filterConfig(config) {
    if (!config) return Promise.resolve(config);
    return loadModules().then(function (modules) {
      var items = (config.items || []).filter(function (id) {
        var mod = SECTION_MODULE_MAP[id];
        return !mod || isEnabled(modules, mod);
      });
      var nav = (config.nav || items.map(function (id) {
        var rc = global.ErvenowPortalFramework && ErvenowPortalFramework.RoleContext;
        return rc ? rc.resolveNavItem(id) : null;
      })).filter(function (item) {
        if (!item) return false;
        var mod = SECTION_MODULE_MAP[item.id];
        return !mod || isEnabled(modules, mod);
      });
      return Object.assign({}, config, { items: items, nav: nav });
    });
  }

  function isSectionEnabled(sectionId) {
    var mod = SECTION_MODULE_MAP[sectionId];
    if (!mod) return Promise.resolve(true);
    return loadModules().then(function (modules) {
      return isEnabled(modules, mod);
    });
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalPlatformModules = {
    loadModules: loadModules,
    filterConfig: filterConfig,
    isSectionEnabled: isSectionEnabled,
    SECTION_MODULE_MAP: SECTION_MODULE_MAP,
    isEnabled: isEnabled,
  };
})(typeof window !== "undefined" ? window : global);
