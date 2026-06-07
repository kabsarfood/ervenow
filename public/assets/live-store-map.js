/**
 * ERVENOW — الخريطة الحية للأنشطة (متاجر / مطاعم / صيدليات / خدمات)
 * يتطلب تسجيل دخول. الألوان من /api/core/platform-branding فقط.
 */
(function (global) {
  "use strict";

  var DEFAULT_CENTER = [24.7136, 46.6753];
  var DEFAULT_ZOOM = 11;
  var map = null;
  var clusterGroup = null;
  var loadTimer = null;
  var mapColors = {};
  var markerById = {};

  function hasToken() {
    try {
      return !!(global.PlatformAPI && global.PlatformAPI.getToken && global.PlatformAPI.getToken());
    } catch (_e) {
      return false;
    }
  }

  function api(path, opts) {
    if (global.PlatformAPI && typeof global.PlatformAPI.api === "function") {
      return global.PlatformAPI.api(path, opts);
    }
    return Promise.reject(new Error("PlatformAPI غير متوفر"));
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colorForStore(st) {
    if (st && st.color) return st.color;
    var cat = st && st.map_category ? st.map_category : "store";
    if (mapColors[cat]) return mapColors[cat];
    try {
      var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (accent) return accent;
    } catch (_e2) {}
    return "currentColor";
  }

  function markerSizeForZoom(z) {
    var zoom = Number(z) || DEFAULT_ZOOM;
    if (zoom <= 8) return 12;
    if (zoom <= 11) return 14;
    if (zoom <= 14) return 18;
    return 22;
  }

  function buildPulseIcon(st) {
    var color = colorForStore(st);
    var size = markerSizeForZoom(map ? map.getZoom() : DEFAULT_ZOOM);
    var ring = Math.round(size * 0.55);
    return L.divIcon({
      className: "erv-live-marker-wrap",
      html:
        '<span class="erv-live-marker" style="--erv-marker-color:' +
        esc(color) +
        ';width:' +
        size +
        "px;height:" +
        size +
        'px"><span class="erv-live-marker__pulse" style="width:' +
        ring +
        "px;height:" +
        ring +
        'px"></span><span class="erv-live-marker__core"></span></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function popupHtml(st) {
    var img = st.logo_url
      ? '<img class="erv-live-popup__img" src="' + esc(st.logo_url) + '" alt="" loading="lazy" />'
      : '<div class="erv-live-popup__img erv-live-popup__img--ph" aria-hidden="true">🏪</div>';
    return (
      '<div class="erv-live-popup">' +
      img +
      '<div class="erv-live-popup__body">' +
      '<strong class="erv-live-popup__name">' +
      esc(st.name) +
      "</strong>" +
      '<p class="erv-live-popup__cat">' +
      esc(st.category_label || "—") +
      "</p>" +
      '<p class="erv-live-popup__meta">' +
      '<span class="erv-live-popup__open' +
      (st.is_open ? " is-open" : "") +
      '">' +
      esc(st.open_label || "—") +
      "</span>" +
      " · ⭐ " +
      esc(st.rating_label || "—") +
      " · 🚚 " +
      esc(st.delivery_eta_label || "—") +
      "</p>" +
      '<div class="erv-live-popup__actions">' +
      '<a class="btn btn-ghost erv-live-popup__btn" href="' +
      esc(st.store_url) +
      '">زيارة النشاط</a>' +
      '<a class="btn btn-primary erv-live-popup__btn" href="' +
      esc(st.order_url) +
      '">ابدأ الطلب</a>' +
      "</div></div></div>"
    );
  }

  function showLoginGate(show) {
    var gate = document.getElementById("liveMapLoginGate");
    var shell = document.getElementById("liveMapShell");
    if (gate) gate.hidden = !show;
    if (shell) shell.hidden = show;
  }

  async function loadBrandingColors() {
    try {
      var j = await api("/api/core/platform-branding");
      var s = (j && j.settings) || {};
      mapColors = {
        restaurant: s.map_color_restaurant,
        store: s.map_color_store,
        pharmacy: s.map_color_pharmacy,
        service: s.map_color_service,
      };
    } catch (_e) {
      mapColors = {};
    }
  }

  function boundsQuery() {
    if (!map) return "";
    var b = map.getBounds();
    var ne = b.getNorthEast();
    var sw = b.getSouthWest();
    return (
      "?north=" +
      encodeURIComponent(ne.lat) +
      "&south=" +
      encodeURIComponent(sw.lat) +
      "&east=" +
      encodeURIComponent(ne.lng) +
      "&west=" +
      encodeURIComponent(sw.lng)
    );
  }

  async function fetchStoresInView() {
    if (!hasToken() || !map || !clusterGroup) return;
    try {
      var j = await api("/api/store/live-map/stores" + boundsQuery());
      if (j && j.map_colors) {
        mapColors = Object.assign(mapColors, j.map_colors);
      }
      var list = (j && j.stores) || [];
      var seen = {};
      list.forEach(function (st) {
        seen[String(st.id)] = true;
        if (markerById[st.id]) {
          markerById[st.id].setIcon(buildPulseIcon(st));
          markerById[st.id].setPopupContent(popupHtml(st));
          return;
        }
        var m = L.marker([st.lat, st.lng], { icon: buildPulseIcon(st) });
        m.bindPopup(popupHtml(st), { maxWidth: 280, className: "erv-live-popup-leaflet" });
        markerById[st.id] = m;
        clusterGroup.addLayer(m);
      });
      Object.keys(markerById).forEach(function (id) {
        if (!seen[id]) {
          clusterGroup.removeLayer(markerById[id]);
          delete markerById[id];
        }
      });
    } catch (e) {
      console.warn("[live-store-map]", e && (e.message || e));
    }
  }

  function scheduleFetch() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(fetchStoresInView, 320);
  }

  function initMap() {
    var el = document.getElementById("liveMap");
    if (!el || typeof L === "undefined") return;

    map = L.map(el, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    if (typeof L.markerClusterGroup === "function") {
      clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 52,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
      });
    } else {
      clusterGroup = L.layerGroup();
    }
    map.addLayer(clusterGroup);

    map.on("moveend", scheduleFetch);
    map.on("zoomend", function () {
      Object.keys(markerById).forEach(function (id) {
        var st = markerById[id];
        if (st && st.setIcon) {
          /* refresh size on zoom — popup data unchanged */
        }
      });
      scheduleFetch();
    });

    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 200);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (!map) return;
          map.setView([pos.coords.latitude, pos.coords.longitude], 13);
          scheduleFetch();
        },
        function () {
          scheduleFetch();
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    } else {
      scheduleFetch();
    }
  }

  async function boot() {
    if (!hasToken()) {
      showLoginGate(true);
      return;
    }
    showLoginGate(false);
    await loadBrandingColors();
    initMap();
  }

  global.ErvenowLiveStoreMap = {
    boot: boot,
    refresh: fetchStoresInView,
    hasToken: hasToken,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : global);
