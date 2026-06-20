(function (global) {
  "use strict";
  var watchId = null;
  var activeBookingId = null;
  var lastSentAt = 0;
  var sending = false;
  function findActiveBooking(bookings) {
    return (bookings || []).find(function (b) {
      var st = String(b.status || b.delivery_status || "").toLowerCase();
      return st === "accepted" || st === "reserved" || st === "in_progress" || st === "delivering";
    });
  }
  async function sendLocation(bookingId, lat, lng) {
    if (sending || !global.PlatformAPI) return;
    if (Date.now() - lastSentAt < 4000) return;
    sending = true;
    try {
      await PlatformAPI.api("/api/services/bookings/" + encodeURIComponent(bookingId) + "/location", {
        method: "POST",
        body: { lat: lat, lng: lng },
      });
      lastSentAt = Date.now();
    } catch (_e) {
    } finally {
      sending = false;
    }
  }
  function stopJobGps() {
    if (watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    activeBookingId = null;
  }
  function syncJobGps(bookings) {
    if (!navigator.geolocation) return;
    var active = findActiveBooking(bookings);
    if (!active || !active.id) {
      stopJobGps();
      return;
    }
    if (String(activeBookingId) === String(active.id) && watchId != null) return;
    stopJobGps();
    activeBookingId = active.id;
    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        sendLocation(activeBookingId, pos.coords.latitude, pos.coords.longitude);
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }
  global.ErvenowPortalProviderJobGps = { syncJobGps: syncJobGps, stopJobGps: stopJobGps };
})(typeof window !== "undefined" ? window : global);
