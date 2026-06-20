/**
 * ERVENOW — Driver operational helpers (maps nav · proximity · TTS)
 */
(function (global) {
  "use strict";
  var PROXIMITY_M = 120;
  var proximityTimer = null;
  var autoGateOrderId = null;
  var autoPickupSent = false;
  var autoDeliverSent = false;
  var navOrderRef = null;

  function haversineM(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var r1 = (lat1 * Math.PI) / 180;
    var r2 = (lat2 * Math.PI) / 180;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLng = ((lng2 - lng1) * Math.PI) / 180;
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(r1) * Math.cos(r2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function speakArabic(text) {
    try {
      if (!text || !global.speechSynthesis) return;
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = "ar-SA";
      u.rate = 0.95;
      var voices = global.speechSynthesis.getVoices();
      var ar = voices.find(function (v) {
        return /ar/i.test(v.lang || "");
      });
      if (ar) u.voice = ar;
      global.speechSynthesis.speak(u);
    } catch (_e) {}
  }

  if (global.speechSynthesis && global.speechSynthesis.getVoices().length === 0) {
    global.speechSynthesis.addEventListener("voiceschanged", function () {}, { once: true });
  }

  function openGoogleMapsDir(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    global.open(
      "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(la + "," + ln),
      "_blank",
      "noopener,noreferrer"
    );
  }

  function openAppleMapsDir(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    global.open("https://maps.apple.com/?daddr=" + la + "," + ln + "&dirflg=d", "_blank", "noopener,noreferrer");
  }

  function openWazeDir(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    global.open("https://waze.com/ul?ll=" + la + "," + ln + "&navigate=yes", "_blank", "noopener,noreferrer");
  }

  function navTargetForOrder(order, status) {
    var st = String(status || order.delivery_status || order.status || "").toLowerCase();
    if (st === "picked_up" || st === "accepted" || st === "ready") {
      return { lat: order.pickup_lat, lng: order.pickup_lng, label: "الاستلام" };
    }
    return { lat: order.drop_lat, lng: order.drop_lng, label: "التسليم" };
  }

  function renderNavButtons(order, status) {
    var t = navTargetForOrder(order, status);
    var la = Number(t.lat);
    var ln = Number(t.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      return '<p class="dp-nav-hint">لا إحداثيات — أضف عنواناً بدقة.</p>';
    }
    return (
      '<div class="dp-nav-row" role="group" aria-label="التوجيه">' +
      '<span class="dp-nav-label">توجيه — ' +
      t.label +
      ":</span>" +
      '<button type="button" class="dp-btn dp-btn--ghost dp-nav-gmaps" data-lat="' +
      la +
      '" data-lng="' +
      ln +
      '">Google Maps</button>' +
      '<button type="button" class="dp-btn dp-btn--ghost dp-nav-amaps" data-lat="' +
      la +
      '" data-lng="' +
      ln +
      '">Apple Maps</button>' +
      '<button type="button" class="dp-btn dp-btn--ghost dp-nav-waze" data-lat="' +
      la +
      '" data-lng="' +
      ln +
      '">Waze</button></div>'
    );
  }

  function wireNavButtons(root) {
    if (!root) return;
    root.querySelectorAll(".dp-nav-gmaps").forEach(function (btn) {
      btn.onclick = function () {
        openGoogleMapsDir(btn.getAttribute("data-lat"), btn.getAttribute("data-lng"));
      };
    });
    root.querySelectorAll(".dp-nav-amaps").forEach(function (btn) {
      btn.onclick = function () {
        openAppleMapsDir(btn.getAttribute("data-lat"), btn.getAttribute("data-lng"));
      };
    });
    root.querySelectorAll(".dp-nav-waze").forEach(function (btn) {
      btn.onclick = function () {
        openWazeDir(btn.getAttribute("data-lat"), btn.getAttribute("data-lng"));
      };
    });
  }

  function resetAutoGatesForOrder(oid) {
    if (String(autoGateOrderId) !== String(oid)) {
      autoGateOrderId = oid;
      autoPickupSent = false;
      autoDeliverSent = false;
    }
  }

  function stopProximityLoop() {
    if (proximityTimer != null) {
      clearInterval(proximityTimer);
      proximityTimer = null;
    }
    navOrderRef = null;
  }

  function startProximityLoop(order, handlers) {
    handlers = handlers || {};
    if (!order || !order.id || !navigator.geolocation) return;
    navOrderRef = order;
    resetAutoGatesForOrder(order.id);
    if (proximityTimer != null) return;
    proximityTimer = setInterval(function () {
      if (!navOrderRef) return;
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          checkProximityAuto(pos.coords.latitude, pos.coords.longitude, handlers);
        },
        function () {},
        { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 }
      );
    }, 5000);
  }

  async function checkProximityAuto(lat, lng, handlers) {
    handlers = handlers || {};
    var o = navOrderRef;
    if (!o || !o.id) return;
    resetAutoGatesForOrder(o.id);
    var st = String(o.delivery_status || o.status || "").toLowerCase();
    if (st === "picked") st = "picked_up";
    var pLat = Number(o.pickup_lat);
    var pLng = Number(o.pickup_lng);
    var dLat = Number(o.drop_lat);
    var dLng = Number(o.drop_lng);
    if ((st === "accepted" || st === "picked_up") && !autoPickupSent && Number.isFinite(pLat) && Number.isFinite(pLng)) {
      if (haversineM(lat, lng, pLat, pLng) <= PROXIMITY_M) {
        autoPickupSent = true;
        try {
          if (handlers.patchStatus) await handlers.patchStatus(o.id, "delivering");
          speakArabic("أنت قريب من الاستلام. تم تسجيل بدء التوصيل تلقائياً.");
          if (handlers.onPickup) handlers.onPickup(o);
        } catch (_e) {
          autoPickupSent = false;
        }
      }
    }
    if (st === "delivering" && !autoDeliverSent && Number.isFinite(dLat) && Number.isFinite(dLng)) {
      if (haversineM(lat, lng, dLat, dLng) <= PROXIMITY_M) {
        autoDeliverSent = true;
        try {
          if (handlers.patchStatus) await handlers.patchStatus(o.id, "delivered");
          speakArabic("أنت قريب من موقع التسليم. تم إنهاء الطلب تلقائياً.");
          if (handlers.onDeliver) handlers.onDeliver(o);
          stopProximityLoop();
        } catch (_e) {
          autoDeliverSent = false;
        }
      }
    }
  }

  function syncActiveProximity(activeOrders, handlers) {
    var list = Array.isArray(activeOrders) ? activeOrders : [];
    var active = list.find(function (o) {
      var s = String(o.delivery_status || o.status || "").toLowerCase();
      return s === "accepted" || s === "picked_up" || s === "delivering" || s === "picked";
    });
    if (active) startProximityLoop(active, handlers);
    else stopProximityLoop();
  }

  global.ErvenowDriverOperational = {
    speakArabic: speakArabic,
    renderNavButtons: renderNavButtons,
    wireNavButtons: wireNavButtons,
    stopProximityLoop: stopProximityLoop,
    syncActiveProximity: syncActiveProximity,
    checkProximityAuto: checkProximityAuto,
  };
})(typeof window !== "undefined" ? window : global);
