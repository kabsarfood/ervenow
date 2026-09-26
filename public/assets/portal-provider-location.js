/**
 * ERVENOW — تحديد موقع الشريك داخل قائمة البوابات (GPS + إدخال يدوي)
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
  var visibilityBound = false;
  var PRESENCE_HEARTBEAT_MS = 75000;
  var LOCATION_MOVE_METERS = 40;

  function hasCoords(obj) {
    if (!obj) return false;
    var lat = Number(obj.lat);
    var lng = Number(obj.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  function isSecureContext() {
    if (global.isSecureContext === true) return true;
    try {
      var loc = global.location;
      if (!loc) return false;
      var host = String(loc.hostname || "").toLowerCase();
      return loc.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
    } catch (_e) {
      return false;
    }
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

  function geolocationErrorMessage(err) {
    var code = err && typeof err.code === "number" ? err.code : -1;
    if (code === 1) {
      return "تم رفض إذن الموقع — من إعدادات المتصفح اسمح بالموقع لهذا الموقع ثم أعد المحاولة";
    }
    if (code === 2) {
      return "الموقع غير متاح — فعّل GPS على الجوال أو استخدم «إدخال يدوي»";
    }
    if (code === 3) {
      return "انتهت مهلة تحديد الموقع — حاول مرة أخرى أو استخدم «إدخال يدوي»";
    }
    if (!isSecureContext()) {
      return "تحديد الموقع يتطلب HTTPS — افتح البوابة عبر رابط آمن أو استخدم «إدخال يدوي»";
    }
    return "تعذّر الوصول لموقعك — فعّل GPS أو امنح الإذن، أو استخدم «إدخال يدوي»";
  }

  function getCurrentPositionOnce(options) {
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(resolve, reject, options || {});
    });
  }

  function readGeolocation() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("المتصفح لا يدعم تحديد الموقع — استخدم «إدخال يدوي»"));
        return;
      }
      if (!isSecureContext()) {
        reject(
          new Error("تحديد الموقع التلقائي يتطلب HTTPS — استخدم «إدخال يدوي» أو افتح البوابة عبر رابط آمن")
        );
        return;
      }

      var attempts = [
        { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 },
        { enableHighAccuracy: false, maximumAge: 120000, timeout: 20000 },
        { enableHighAccuracy: false, maximumAge: 600000, timeout: 15000 },
      ];
      var lastErr = null;

      function tryNext(i) {
        if (i >= attempts.length) {
          reject(new Error(geolocationErrorMessage(lastErr)));
          return;
        }
        getCurrentPositionOnce(attempts[i])
          .then(function (pos) {
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
          })
          .catch(function (err) {
            lastErr = err;
            tryNext(i + 1);
          });
      }

      tryNext(0);
    });
  }

  function parseCoordsFromText(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;

    var urlQ = s.match(/[?&]q=(-?\d+(?:\.\d+)?)[,%2C]+(-?\d+(?:\.\d+)?)/i);
    if (urlQ) {
      var latQ = Number(urlQ[1]);
      var lngQ = Number(urlQ[2]);
      if (Number.isFinite(latQ) && Number.isFinite(lngQ) && Math.abs(latQ) <= 90 && Math.abs(lngQ) <= 180) {
        return { lat: latQ, lng: lngQ };
      }
    }

    var atMatch = s.match(/@(-?\d+(?:\.\d+)?)[,%2C]+(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      var latA = Number(atMatch[1]);
      var lngA = Number(atMatch[2]);
      if (Number.isFinite(latA) && Number.isFinite(lngA) && Math.abs(latA) <= 90 && Math.abs(lngA) <= 180) {
        return { lat: latA, lng: lngA };
      }
    }

    var pair = s.match(/(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)/);
    if (pair) {
      var latP = Number(pair[1]);
      var lngP = Number(pair[2]);
      if (Number.isFinite(latP) && Number.isFinite(lngP) && Math.abs(latP) <= 90 && Math.abs(lngP) <= 180) {
        return { lat: latP, lng: lngP };
      }
    }
    return null;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    var dLat = Number(lat2) - Number(lat1);
    var dLng = Number(lng2) - Number(lng1);
    if (![dLat, dLng].every(function (n) { return Number.isFinite(n); })) return NaN;
    return Math.sqrt(dLat * dLat + dLng * dLng) * 111 * 1000;
  }

  function shouldSaveCoords(lat, lng) {
    if (!lastCoords || !Number.isFinite(lastCoords.lat)) return true;
    var meters = distanceMeters(lastCoords.lat, lastCoords.lng, lat, lng);
    return Number.isFinite(meters) && meters >= LOCATION_MOVE_METERS;
  }

  function presenceEndpointForRole(role) {
    var r = String(role || "").toLowerCase();
    if (r === "service" || r === "transport") {
      return { method: "POST", path: "/api/services/me/presence" };
    }
    return null;
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

  function isGeoPersistError(err) {
    var msg = String((err && err.message) || err || "");
    return /غير مدعوم في قاعدة البيانات|geo_persisted|users\.lat|users\.lng|migration_users_lat_lng/i.test(
      msg
    );
  }

  function emitLocationUpdated(coords, role, extra) {
    try {
      global.dispatchEvent(
        new CustomEvent("ervenow:provider-location-updated", {
          detail: Object.assign({ lat: coords.lat, lng: coords.lng, role: role }, extra || {}),
        })
      );
    } catch (_e) {}
  }

  async function persistCoords(role, coords, opts) {
    opts = opts || {};
    if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") {
      throw new Error("PlatformAPI غير متاح");
    }
    var ep = endpointForRole(role);
    if (!ep) throw new Error("هذه البوابة لا تدعم تحديد الموقع");

    var body = { lat: coords.lat, lng: coords.lng };
    try {
      var res = await PlatformAPI.api(ep.path, { method: ep.method, body: body });
      lastSavedAt = Date.now();
      rememberCoords(coords);
      if (!opts.silent) {
        emitLocationUpdated(coords, role, { response: res, geo_persisted: res && res.geo_persisted !== false });
      }
      return coords;
    } catch (apiErr) {
      lastSavedAt = Date.now();
      rememberCoords(coords);
      if (!opts.silent) {
        emitLocationUpdated(coords, role, { geo_persisted: false, apiError: true });
      }
      if (isGeoPersistError(apiErr)) {
        return coords;
      }
      throw apiErr;
    }
  }

  async function saveManualCoords(role, lat, lng, opts) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      throw new Error("إحداثيات غير صالحة — مثال: 24.7136, 46.6753");
    }
    return persistCoords(role, { lat: la, lng: ln }, opts || {});
  }

  function offerManualFallback(role) {
    return new Promise(function (resolve, reject) {
      var hint =
        "الصق رابط خرائط Google أو الإحداثيات:\nمثال: 24.7136, 46.6753\nأو: https://maps.google.com/?q=24.7136,46.6753";
      var raw = global.prompt(hint, "");
      if (raw == null || !String(raw).trim()) {
        reject(new Error("تم الإلغاء"));
        return;
      }
      var parsed = parseCoordsFromText(raw);
      if (!parsed) {
        reject(new Error("لم نتعرّف على الإحداثيات — استخدم الصيغة: خط العرض, خط الطول"));
        return;
      }
      saveManualCoords(role, parsed.lat, parsed.lng, {})
        .then(resolve)
        .catch(reject);
    });
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
      var coords;
      if (opts.coords && hasCoords(opts.coords)) {
        coords = { lat: Number(opts.coords.lat), lng: Number(opts.coords.lng) };
      } else {
        coords = await readGeolocation();
      }
      if (opts.silent && !shouldSaveCoords(coords.lat, coords.lng) && hasCoords(lastCoords)) {
        return lastCoords;
      }
      return persistCoords(role, coords, opts);
    } finally {
      busy = false;
    }
  }

  function clearLocationWatch() {
    if (presenceWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(presenceWatchId);
      presenceWatchId = null;
    }
  }

  function clearPresenceTimer() {
    if (presenceIntervalId != null) {
      clearInterval(presenceIntervalId);
      presenceIntervalId = null;
    }
  }

  function sendPresence(role) {
    var ep = presenceEndpointForRole(role);
    if (!ep || !global.PlatformAPI || typeof global.PlatformAPI.api !== "function") return Promise.resolve();
    if (typeof document !== "undefined" && document.hidden) return Promise.resolve();
    return global.PlatformAPI.api(ep.path, { method: ep.method, body: {} }).catch(function () {});
  }

  function persistIfMoved(role, lat, lng) {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!shouldSaveCoords(lat, lng)) return;
    if (busy) return;
    busy = true;
    persistCoords(role, { lat: lat, lng: lng }, { silent: true })
      .catch(function () {})
      .finally(function () {
        busy = false;
      });
  }

  function startLocationWatch(role) {
    clearLocationWatch();
    if (!navigator.geolocation || !isSecureContext()) return;
    presenceWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        persistIfMoved(role, pos.coords.latitude, pos.coords.longitude);
      },
      function () {},
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
    );
  }

  function pausePresenceAndLocation() {
    clearPresenceTimer();
    clearLocationWatch();
  }

  function resumePresenceAndLocation() {
    var role = activeRole;
    if (!role || (typeof document !== "undefined" && document.hidden)) return;
    clearPresenceTimer();
    sendPresence(role);
    presenceIntervalId = setInterval(function () {
      if (typeof document !== "undefined" && document.hidden) return;
      sendPresence(activeRole);
    }, PRESENCE_HEARTBEAT_MS);
    startLocationWatch(role);
    if (navigator.geolocation && isSecureContext()) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          persistIfMoved(role, pos.coords.latitude, pos.coords.longitude);
        },
        function () {},
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 }
      );
    }
  }

  function onPresenceVisibility() {
    if (typeof document !== "undefined" && document.hidden) {
      pausePresenceAndLocation();
      return;
    }
    resumePresenceAndLocation();
  }

  function bindPresenceVisibility() {
    if (visibilityBound || typeof document === "undefined") return;
    visibilityBound = true;
    document.addEventListener("visibilitychange", onPresenceVisibility);
  }

  function unbindPresenceVisibility() {
    if (!visibilityBound || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onPresenceVisibility);
    visibilityBound = false;
  }

  function stopPresenceLoop() {
    pausePresenceAndLocation();
    unbindPresenceVisibility();
    activeRole = null;
  }

  function startPresenceLoop(role) {
    if (!isOrderReceivingRole(role)) return;
    if (!isReady()) return;
    stopPresenceLoop();
    activeRole = role;
    bindPresenceVisibility();
    resumePresenceAndLocation();
  }

  async function ensureForOrders(role, profile, opts) {
    opts = opts || {};
    if (hasCoords(profile)) {
      rememberCoords({ lat: Number(profile.lat), lng: Number(profile.lng) }, profile);
      return lastCoords;
    }
    if (hasCoords(lastCoords)) return lastCoords;
    if (opts.required === false) return null;
    return captureAndSave(role, opts);
  }

  function renderBanner(opts) {
    opts = opts || {};
    var gasNote = opts.gasRequired
      ? "طلبات الغاز تُطابق حسب موقعك وموقع العميل — GPS مطلوب."
      : "GPS اختياري للخدمات المنزلية (المطابقة حسب الحي). مطلوب لطلبات الغاز فقط.";
    var httpsNote = isSecureContext()
      ? ""
      : '<p class="pf-location-banner__sub" style="color:#b45309">⚠️ افتح البوابة عبر HTTPS لتفعيل GPS التلقائي.</p>';
    return (
      '<div class="pf-location-banner" role="status">' +
      "<p><strong>📍 تحديد موقعك</strong></p>" +
      '<p class="pf-location-banner__sub">' +
      gasNote +
      "</p>" +
      httpsNote +
      '<div class="pf-location-banner__actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' +
      '<button type="button" class="pf-btn pf-btn--primary" data-pf-action="set-location">تحديد موقعي (GPS)</button>' +
      '<button type="button" class="pf-btn" data-pf-action="set-location-manual">إدخال يدوي</button>' +
      "</div></div>"
    );
  }

  var api = {
    hasCoords: hasCoords,
    isReady: isReady,
    isSecureContext: isSecureContext,
    getLastCoords: getLastCoords,
    syncButtonLabel: syncButtonLabel,
    captureAndSave: captureAndSave,
    saveManualCoords: saveManualCoords,
    offerManualFallback: offerManualFallback,
    parseCoordsFromText: parseCoordsFromText,
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
