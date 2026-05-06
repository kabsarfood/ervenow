/**
 * تتبع ERVENOW — حركة ناعمة بـ RAF (استيفاء نحو موقع الخادم) بدون قفزات.
 * يوفّر: ErvTrackDriverMotion.feed | cancel | smoothLerpTo
 * و animateErvDriverMarker للتوافق مع track.html.
 */
(function (w) {
  var drRafId = null;
  var lastHeadingUsed = 0;

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLng = ((lng2 - lng1) * Math.PI) / 180;
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDegErv(lat1, lon1, lat2, lon2) {
    var φ1 = (lat1 * Math.PI) / 180;
    var φ2 = (lat2 * Math.PI) / 180;
    var Δλ = ((lon2 - lon1) * Math.PI) / 180;
    var y = Math.sin(Δλ) * Math.cos(φ2);
    var x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    var θ = Math.atan2(y, x);
    return ((θ * 180) / Math.PI + 360) % 360;
  }

  function applyDriverRotationToward(marker, latTo, lngTo) {
    if (!marker || !w.__ervApplyDriverRotation) return;
    var tLat = Number(latTo);
    var tLng = Number(lngTo);
    if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) return;
    var cur = marker.getLatLng();
    if (haversineMeters(cur.lat, cur.lng, tLat, tLng) < 1.5) return;
    var brg = bearingDegErv(cur.lat, cur.lng, tLat, tLng);
    w.__ervApplyDriverRotation(marker, brg);
  }

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

  /**
   * كل إطار: تحريك الماركر باستيفاء (interpolation) نحو آخر إحداثيات من الخادم — بدون قفزات.
   * @param {L.Marker} marker
   * @param {{ lat: number, lng: number, ts?: number, speed?: number, heading?: number }} data
   */
  function feedInterpolatedFollow(marker, data) {
    if (!marker || !data) return;
    var tLat = Number(data.lat);
    var tLng = Number(data.lng);
    if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) return;

    var speed = Number(data.speed);
    if (!Number.isFinite(speed) || speed < 0) speed = 0;
    var heading = Number(data.heading);
    if (!Number.isFinite(heading)) heading = lastHeadingUsed;
    else lastHeadingUsed = heading;

    cancelDriverMotion();

    var start = performance.now();
    var maxMs = 3200;
    /** معامل الاستيفاء لكل إطار — أسرع عند البعد الكبير */
    function pickAlpha(distM) {
      var base = speed > 3 ? 0.2 : 0.13;
      if (distM > 200) return Math.min(0.48, base * 2.4);
      if (distM > 60) return Math.min(0.35, base * 1.8);
      return base;
    }

    function step(now) {
      var cur = marker.getLatLng();
      var distM = haversineMeters(cur.lat, cur.lng, tLat, tLng);
      if (distM < 1.2 || now - start > maxMs) {
        marker.setLatLng([tLat, tLng]);
        applyDriverRotationToward(marker, tLat, tLng);
        drRafId = null;
        return;
      }
      var a = pickAlpha(distM);
      var nLat = cur.lat + (tLat - cur.lat) * a;
      var nLng = cur.lng + (tLng - cur.lng) * a;
      marker.setLatLng([nLat, nLng]);
      applyDriverRotationToward(marker, tLat, tLng);
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
      applyDriverRotationToward(marker, endLat, endLng);
      if (p < 1) {
        drRafId = requestAnimationFrame(step);
      } else {
        drRafId = null;
      }
    }
    drRafId = requestAnimationFrame(step);
  }

  function resetMotion() {
    cancelDriverMotion();
    lastHeadingUsed = 0;
  }

  w.ErvTrackDriverMotion = {
    feed: feedInterpolatedFollow,
    cancel: cancelDriverMotion,
    reset: resetMotion,
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
