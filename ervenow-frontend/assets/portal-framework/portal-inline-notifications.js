/**
 * ERVENOW — In-portal notification center (full page mode inside portal shell)
 */
(function (global) {
  "use strict";

  var mounted = {};

  function mountIn(container, key, opts) {
    if (!container) return Promise.resolve(null);
    opts = opts && typeof opts === "object" ? opts : {};
    var k = key || container.id || "inline";
    if (mounted[k]) return Promise.resolve(mounted[k]);
    if (!global.ErvenowNotificationCenter || typeof ErvenowNotificationCenter.initPage !== "function") {
      container.innerHTML =
        '<p class="pf-empty">مركز الإشعارات غير متاح — تأكد من تحميل notification-center.js</p>';
      return Promise.resolve(null);
    }
    container.innerHTML = "";
    return ErvenowNotificationCenter.initPage({
      mount: container,
      enableTypeFilters: opts.enableTypeFilters === true,
    }).then(function (api) {
      mounted[k] = api;
      return api;
    });
  }

  global.ErvenowPortalInlineNotifications = {
    mountIn: mountIn,
  };
})(typeof window !== "undefined" ? window : global);
