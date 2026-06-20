/**
 * ERVENOW — تحديد موقع الشريك داخل قائمة البوابات (GPS)
 * service · transport · driver · merchant — نشط لاستقبال الطلبات
 */
(function (global) {
  "use strict";

  var busy = false;
  var lastCoords = null;
  var lastSavedAt = 0;
  var presenceWatchId = null;
  var presenceIntervalId = null;
  var activeRole = null;

  function hasCoords(obj) {
    if (!obj) return false;
    var lat = Number(obj.lat);
    var lng = Number(obj.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  function labelEl() {
    return document.querySelector('[data-pf-field="location-label"]');
  }

  function buttonEl() {
    return document.querySelector('[data-pf-action="set-location"]');
  }

  function syncButtonLabel(obj) {
    var el = labelEl();
    var btn = buttonEl();
    if (!el || !btn) return;
    if (hasCoords(obj) || hasCoords(lastCoords)) {
      el.textContent = "الموقع فعّال";
      btn.classList.add("is-located");
      btn.setAttribute("aria-pressed", "true");
    } else {
      el.textContent = "تحديد الموقع";
      btn.classList.remove("is-located");
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function setPendingLabel() {
    var el = labelEl();
    if (el) el.textContent = "جاري تحديد الموقع…";
    var btn = buttonEl();
    if (btn) btn.classList.remove("is-located");
  }

  function endpointForRole(role) {
    var r = String(role || "").toLowerCase();
    if (r === "driver") {
      return { method: "POST", path: "/api/driver/update-location" };
    }
    if (r === "merchant" || r === "store") {
      return { method: "PATCH", path: "/api/store/location" };
    }
    if (r === "service" || r === "transport") {
      return { method: "PATCH", path: "/api/services/me/location" };
    }
    return null;
  }

  function isOrderReceivingRole(role) {
    var r = String(role || "").toLowerCase();
    return r === "service" || r === "transport" || r === "driver";
  }

  function readGeolocation() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("المتصفح لا يدعم تحديد الموقع"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        function () {
          reject(new Error("تعذّر الوصول لموقعك — فعّل GPS أو امنح الإذن"));
        },
        { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
      );
    });
  }

  function shouldSaveCoords(lat, lng) {
    var now = Date.now();
    if (!lastCoords || !Number.isFinite(lastCoords.lat)) return true;
    if (now - lastSavedAt > 12000) return true;
    var moved =
      Math.abs(lat - lastCoords.lat) + Math.abs(lng - lastCoords.lng) > 0.00008;
    return moved;
  }

  function rememberCoords(coords, profile) {
    lastCoords = { lat: coords.lat, lng: coords.lng };
    syncButtonLabel(profile || lastCoords);
  }

  function isReady(profile) {
    return hasCoords(profile) || hasCoords(lastCoords);
  }

  function getLastCoords() {
    return lastCoords ? { lat: lastCoords.lat, lng: lastCoords.lng } : null;
  }

  async function captureAndSave(role, opts) {
    opts = opts || {};
    if (busy) return lastCoords;
    if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") {
      throw new Error("PlatformAPI غير متاح");
    }
    var ep = endpointForRole(role);
    if (!ep) throw new Error("هذه البوابة لا تدعم تحديد الموقع");

    busy = true;
    if (!opts.silent) setPendingLabel();
    try {
      var coords = await readGeolocation();
      if (!shouldSaveCoords(coords.lat, coords.lng) && hasCoords(lastCoords)) {
        return lastCoords;
      }
      var body = { lat: coords.lat, lng: coords.lng };
      var res = await PlatformAPI.api(ep.path, { method: ep.method, body: body });
      lastSavedAt = Date.now();
      rememberCoords(coords);
      if (!opts.silent) {
        try {
          global.dispatchEvent(
            new CustomEvent("ervenow:provider-location-updated", {
              detail: { lat: coords.lat, lng: coords.lng, role: role, response: res },
            })
          );
        } catch (_e) {}
      }
      return coords;
    } finally {
      busy = false;
    }
  }

  function stopPresenceLoop() {
    if (presenceWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(presenceWatchId);
      presenceWatchId = null;
    }
    if (presenceIntervalId != null) {
      clearInterval(presenceIntervalId);
      presenceIntervalId = null;
    }
    activeRole = null;
  }

  function startPresenceLoop(role, intervalMs) {
    if (!isOrderReceivingRole(role)) return;
    stopPresenceLoop();
    activeRole = role;
    intervalMs = intervalMs || 15000;

    function tick() {
      captureAndSave(role, { silent: true })
        .then(function (coords) {
          if (!coords) return;
          try {
            global.dispatchEvent(
              new CustomEvent("ervenow:provider-location-updated", {
                detail: { lat: coords.lat, lng: coords.lng, role: role, silent: true },
              })
            );
          } catch (_e) {}
        })
        .catch(function () {});
    }

    if (navigator.geolocation) {
      presenceWatchId = navigator.geolocation.watchPosition(
        function (pos) {
          var lat = pos.coords.latitude;
          var lng = pos.coords.longitude;
          if (!shouldSaveCoords(lat, lng)) return;
          if (busy) return;
          busy = true;
          var ep = endpointForRole(role);
          if (!ep || !global.PlatformAPI) {
            busy = false;
            return;
          }
          PlatformAPI.api(ep.path, { method: ep.method, body: { lat: lat, lng: lng } })
            .then(function (res) {
              lastSavedAt = Date.now();
              rememberCoords({ lat: lat, lng: lng });
              try {
                global.dispatchEvent(
                  new CustomEvent("ervenow:provider-location-updated", {
                    detail: { lat: lat, lng: lng, role: role, silent: true, response: res },
                  })
                );
              } catch (_e) {}
            })
            .catch(function () {})
            .finally(function () {
              busy = false;
            });
        },
        function () {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    }

    presenceIntervalId = setInterval(tick, intervalMs);
    tick();
  }

  async function ensureForOrders(role, profile) {
    if (hasCoords(profile)) {
      rememberCoords({ lat: Number(profile.lat), lng: Number(profile.lng) }, profile);
      return lastCoords;
    }
    if (hasCoords(lastCoords)) return lastCoords;
    return captureAndSave(role);
  }

  function renderBanner() {
    return (
      '<div class="pf-location-banner" role="status">' +
      "<p><strong>📍 فعّل موقعك لاستقبال الطلبات</strong></p>" +
      '<p class="pf-location-banner__sub">الطلبات تُطابق حسب موقعك وموقع العميل — بدون GPS لن تظهر الطلبات المناسبة.</p>' +
      '<button type="button" class="pf-btn pf-btn--primary" data-pf-action="set-location">تحديد موقعي الآن</button>' +
      "</div>"
    );
  }

  var api = {
    hasCoords: hasCoords,
    isReady: isReady,
    getLastCoords: getLastCoords,
    syncButtonLabel: syncButtonLabel,
    captureAndSave: captureAndSave,
    ensureForOrders: ensureForOrders,
    startPresenceLoop: startPresenceLoop,
    stopPresenceLoop: stopPresenceLoop,
    renderBanner: renderBanner,
  };

  var prev = global.ErvenowPortalProviderLocation;
  if (prev && typeof prev === "object") {
    global.ErvenowPortalProviderLocation = Object.assign({}, prev, api);
  } else {
    global.ErvenowPortalProviderLocation = api;
  }
})(typeof window !== "undefined" ? window : global);
