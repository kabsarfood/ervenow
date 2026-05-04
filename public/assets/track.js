/**
 * تتبع ERVENOW — Dead-reckoning (RAF) + تحريك ناعم بدون setInterval.
 * يوفّر: ErvTrackDriverMotion.feed | cancel | smoothLerpTo
 * و animateErvDriverMarker للتوافق مع track.html (RAF فقط).
 */
(function (w) {
  var drRafId = null;
  var lastHeadingUsed = 0;

  function cancelDriverMotion() {
    if (w.driverAnim != null) {
      clearInterval(w.driverAnim);
      w.driverAnim = null;
    }
    if (drRafId != null) {
      cancelAnimationFrame(drRafId);
      drRafId = null;
    }
  }

  var drState = {
    lastUpdate: null,
  };

  /**
   * @param {L.Marker} marker
   * @param {{ lat: number, lng: number, ts?: number, speed?: number, heading?: number }} data
   */
  function feedDeadReckoning(marker, data) {
    if (!marker || !data) return;
    var lat = Number(data.lat);
    var lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    var speed = Number(data.speed);
    if (!Number.isFinite(speed) || speed < 0) speed = 0;
    var heading = Number(data.heading);
    if (!Number.isFinite(heading)) heading = lastHeadingUsed;
    else lastHeadingUsed = heading;

    cancelDriverMotion();

    var target = { lat: lat, lng: lng, ts: data.ts != null ? Number(data.ts) : Date.now(), speed: speed, heading: heading };

    if (!drState.lastUpdate) {
      marker.setLatLng([lat, lng]);
      drState.lastUpdate = target;
      return;
    }

    if (speed < 0.15) {
      marker.setLatLng([lat, lng]);
      drState.lastUpdate = target;
      return;
    }

    drState.lastUpdate = target;
    var baseLat = lat;
    var baseLng = lng;
    var start = performance.now();
    var maxExtrapSec = 2.3;

    function step(now) {
      var elapsed = (now - start) / 1000;
      if (elapsed > maxExtrapSec) {
        drRafId = null;
        return;
      }
      var meters = speed * elapsed;
      var hr = (heading * Math.PI) / 180;
      var cosLat = Math.cos((baseLat * Math.PI) / 180);
      if (Math.abs(cosLat) < 0.02) cosLat = cosLat < 0 ? -0.02 : 0.02;
      var dLat = (meters / 111111) * Math.cos(hr);
      var dLng = ((meters / 111111) * Math.sin(hr)) / cosLat;
      var predictedLat = baseLat + dLat;
      var predictedLng = baseLng + dLng;
      marker.setLatLng([predictedLat, predictedLng]);
      drRafId = requestAnimationFrame(step);
    }

    drRafId = requestAnimationFrame(step);
  }

  /**
   * @param {L.Marker} marker
   * @param {number} toLat
   * @param {number} toLng
   * @param {number} [durationMs]
   */
  function smoothLerpTo(marker, toLat, toLng, durationMs) {
    if (!marker) return;
    var endLat = Number(toLat);
    var endLng = Number(toLng);
    if (!Number.isFinite(endLat) || !Number.isFinite(endLng)) return;
    cancelDriverMotion();
    var startLL = marker.getLatLng();
    var sLat = Number(startLL.lat);
    var sLng = Number(startLL.lng);
    var dur = Number(durationMs) > 0 ? Number(durationMs) : 420;
    var t0 = performance.now();

    function step(now) {
      var p = Math.min((now - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var curLat = sLat + (endLat - sLat) * eased;
      var curLng = sLng + (endLng - sLng) * eased;
      marker.setLatLng([curLat, curLng]);
      if (p < 1) {
        drRafId = requestAnimationFrame(step);
      } else {
        drRafId = null;
      }
    }
    drRafId = requestAnimationFrame(step);
  }

  function resetDeadReckoning() {
    cancelDriverMotion();
    drState.lastUpdate = null;
    lastHeadingUsed = 0;
  }

  w.ErvTrackDriverMotion = {
    feed: feedDeadReckoning,
    cancel: cancelDriverMotion,
    reset: resetDeadReckoning,
    smoothLerpTo: smoothLerpTo,
  };

  w.animateErvDriverMarker = function (marker, newLatLng) {
    var endLat;
    var endLng;
    if (Array.isArray(newLatLng)) {
      endLat = Number(newLatLng[0]);
      endLng = Number(newLatLng[1]);
    } else {
      endLat = Number(newLatLng.lat);
      endLng = Number(newLatLng.lng);
    }
    smoothLerpTo(marker, endLat, endLng, 400);
  };
})(typeof window !== "undefined" ? window : this);
