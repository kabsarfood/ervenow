/**
 * تتبع زيارات البوابات والمسارات القديمة — بدون تغيير دورة الطلبات.
 */
(function (global) {
  "use strict";

  var SENT = {};

  function currentPath() {
    return (global.location && global.location.pathname) || "/";
  }

  function getToken() {
    try {
      return (
        global.localStorage.getItem("ervenow_access_token") ||
        global.localStorage.getItem("erwenow_access_token") ||
        global.localStorage.getItem("token") ||
        ""
      );
    } catch (_e) {
      return "";
    }
  }

  function postBeacon(body) {
    var headers = { "Content-Type": "application/json" };
    var tok = getToken();
    if (tok) headers.Authorization = "Bearer " + tok;
    var url = "/api/core/readiness-beacon";
    try {
      if (global.navigator && typeof global.navigator.sendBeacon === "function") {
        var blob = new Blob([JSON.stringify(body)], { type: "application/json" });
        if (global.navigator.sendBeacon(url, blob)) return;
      }
    } catch (_e) {}
    fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body), credentials: "same-origin" }).catch(
      function () {}
    );
  }

  function trackVisit(extra) {
    var path = currentPath();
    var key = path + "|" + (extra && extra.kind);
    if (SENT[key]) return;
    SENT[key] = 1;
    postBeacon(
      Object.assign(
        {
          kind: "page_visit",
          path: path,
        },
        extra || {}
      )
    );
  }

  function trackRedirectError(errorType, detail) {
    postBeacon({
      kind: "redirect_error",
      error_type: errorType,
      path: currentPath(),
      detail: detail || null,
    });
  }

  function trackRedirect(opts) {
    opts = opts || {};
    postBeacon({
      kind: "redirect",
      portal: opts.portal || null,
      role: opts.role || null,
      raw_role: opts.raw_role || opts.role || null,
      service_type: opts.service_type || null,
      path: opts.path || currentPath(),
      success: opts.success !== false,
    });
  }

  global.ErvenowAdminReadinessBeacon = {
    trackVisit: trackVisit,
    trackRedirectError: trackRedirectError,
    trackRedirect: trackRedirect,
  };

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", function () {
      trackVisit();
    });
  } else {
    trackVisit();
  }
})(typeof window !== "undefined" ? window : globalThis);
