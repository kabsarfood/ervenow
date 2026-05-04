/**
 * Socket.IO للمندوب — watchPosition + مصادقة JWT.
 * معرّف الطلب: window.__ERVENOW_TRACK_ORDER_ID (من لوحة المندوب).
 * الخريطة وـ REST: window.__ERVENOW_ON_GEO_POSITION__(lat, lng, pos)
 */
(function () {
  var socket = null;
  var geoWatchId = null;
  var lastSocketEmitAt = 0;

  function getToken() {
    try {
      if (window.PlatformAPI && typeof window.PlatformAPI.getToken === "function") {
        return String(window.PlatformAPI.getToken() || "").trim();
      }
    } catch (_e) {}
    return "";
  }

  function connectSocket() {
    if (typeof io === "undefined") return null;
    var tok = getToken();
    if (!tok) return null;
    if (socket && socket.connected) return socket;
    if (socket) {
      try {
        socket.disconnect();
      } catch (_e) {}
      socket = null;
    }
    socket = io({
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      auth: { token: tok },
    });
    return socket;
  }

  function emitIfOrder(pos) {
    var orderId = window.__ERVENOW_TRACK_ORDER_ID;
    if (!orderId) return;
    var s = connectSocket();
    if (!s || !s.connected) return;
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var sp = pos.coords.speed != null && !Number.isNaN(Number(pos.coords.speed)) ? Number(pos.coords.speed) : null;
    var now = Date.now();
    if (sp != null && Math.abs(sp) < 1) {
      if (now - lastSocketEmitAt < 4000) return;
    }
    lastSocketEmitAt = now;
    var body = {
      orderId: String(orderId),
      lat: lat,
      lng: lng,
    };
    if (sp != null) {
      body.speed = sp;
    }
    if (pos.coords.heading != null && !Number.isNaN(Number(pos.coords.heading))) {
      body.heading = Number(pos.coords.heading);
    }
    s.emit("driver:location", body);
  }

  function startDriverGeolocationSocketPipe() {
    if (!navigator.geolocation) return;
    connectSocket();
    if (geoWatchId != null) {
      try {
        navigator.geolocation.clearWatch(geoWatchId);
      } catch (_e) {}
      geoWatchId = null;
    }
    geoWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        if (typeof window.__ERVENOW_ON_GEO_POSITION__ === "function") {
          try {
            window.__ERVENOW_ON_GEO_POSITION__(pos.coords.latitude, pos.coords.longitude, pos);
          } catch (_e) {}
        }
        emitIfOrder(pos);
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
  }

  window.startDriverGeolocationSocketPipe = startDriverGeolocationSocketPipe;
})();
