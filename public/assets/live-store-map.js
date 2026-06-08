/**
 * ERVENOW — الخريطة الحية للأنشطة (متاجر / مطاعم / صيدليات / خدمات)
 * تظهر فقط بعد تسجيل الدخول — أقمار صناعية + تضاريس + بحث مدينة/قسم
 */
(function (global) {
  "use strict";

  var DEFAULT_CENTER = [24.7136, 46.6753];
  var DEFAULT_ZOOM = 11;
  var LIVE_MAP_CITIES = [
    { id: "all", label: "كل المملكة", lat: 24.0, lng: 45.0, zoom: 6 },
    { id: "riyadh", label: "الرياض", lat: 24.7136, lng: 46.6753, zoom: 11 },
    { id: "jeddah", label: "جدة", lat: 21.4858, lng: 39.1925, zoom: 11 },
    { id: "makkah", label: "مكة المكرمة", lat: 21.3891, lng: 39.8579, zoom: 12 },
    { id: "madinah", label: "المدينة المنورة", lat: 24.5247, lng: 39.5692, zoom: 11 },
    { id: "dammam", label: "الدمام / الخبر", lat: 26.3927, lng: 49.9777, zoom: 11 },
    { id: "tabuk", label: "تبوك", lat: 28.3838, lng: 36.555, zoom: 12 },
    { id: "abha", label: "أبها", lat: 18.2164, lng: 42.5053, zoom: 12 },
    { id: "taif", label: "الطائف", lat: 21.2703, lng: 40.4158, zoom: 12 },
    { id: "buraidah", label: "بريدة", lat: 26.3592, lng: 43.9815, zoom: 12 },
    { id: "khamis", label: "خميس مشيط", lat: 18.3, lng: 42.7333, zoom: 12 },
    { id: "hail", label: "حائل", lat: 27.5236, lng: 41.7001, zoom: 12 },
    { id: "jazan", label: "جازان", lat: 16.8894, lng: 42.5706, zoom: 12 },
    { id: "najran", label: "نجران", lat: 17.4933, lng: 44.1277, zoom: 12 },
  ];

  var CATEGORY_LABELS = {
    all: "كل الأقسام",
    restaurant: "مطاعم",
    store: "متاجر",
    pharmacy: "صيدليات",
    service: "خدمات",
  };

  var map = null;
  var clusterGroup = null;
  var loadTimer = null;
  var mapColors = {};
  var markerById = {};
  var storeCache = {};
  var selectedCategory = "all";
  var selectedCityId = "all";
  var controlsWired = false;
  var feederWired = false;
  var mapBaseLayers = null;
  var activeBaseMode = "satellite";
  var baseLayerControl = null;

  var runtime = {
    adminMode: !!(global.__ERV_LIVE_MAP_OPTS__ && global.__ERV_LIVE_MAP_OPTS__.adminMode),
    skipAutoBoot: !!(global.__ERV_LIVE_MAP_OPTS__ && global.__ERV_LIVE_MAP_OPTS__.skipAutoBoot),
    isPublicPage: !!(document.body && document.body.classList.contains("erv-live-map-page")),
  };

  function hasToken() {
    if (runtime.adminMode) return true;
    try {
      return !!(global.PlatformAPI && global.PlatformAPI.getToken && global.PlatformAPI.getToken());
    } catch (_e) {
      return false;
    }
  }

  function showFeatureDisabled(show) {
    var gate = document.getElementById("liveMapFeatureDisabled");
    var loginGate = document.getElementById("liveMapLoginGate");
    var shell = document.getElementById("liveMapShell");
    if (gate) {
      gate.hidden = !show;
      gate.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (loginGate) {
      loginGate.hidden = show;
      loginGate.setAttribute("aria-hidden", show ? "true" : "false");
    }
    if (shell) {
      shell.hidden = show;
      shell.setAttribute("aria-hidden", show ? "true" : "false");
    }
    if (show && map) {
      if (baseLayerControl) {
        try {
          map.removeControl(baseLayerControl);
        } catch (_rc) {}
        baseLayerControl = null;
      }
      mapBaseLayers = null;
      try {
        map.remove();
      } catch (_rm) {}
      map = null;
      clusterGroup = null;
      markerById = {};
      storeCache = {};
    }
  }

  async function checkPublicEnabled() {
    if (runtime.adminMode) return true;
    try {
      var j = await api("/api/core/live-map-public");
      return !!(j && j.enabled !== false);
    } catch (_e) {
      return true;
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

  function cityById(id) {
    var needle = String(id || "all").trim();
    for (var i = 0; i < LIVE_MAP_CITIES.length; i++) {
      if (LIVE_MAP_CITIES[i].id === needle) return LIVE_MAP_CITIES[i];
    }
    return LIVE_MAP_CITIES[0];
  }

  function resolveCityQuery(query) {
    var needle = String(query || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!needle || needle === "كل المملكة" || needle === "كل") return cityById("all");
    var partial = null;
    for (var i = 0; i < LIVE_MAP_CITIES.length; i++) {
      var c = LIVE_MAP_CITIES[i];
      var lab = String(c.label || "").toLowerCase();
      var id = String(c.id || "").toLowerCase();
      if (lab === needle || id === needle) return c;
      if (!partial && (lab.indexOf(needle) >= 0 || needle.indexOf(lab) >= 0 || id.indexOf(needle) >= 0)) {
        partial = c;
      }
    }
    return partial;
  }

  function updateToolbarHint() {
    var lbl = document.getElementById("liveMapCityLabel");
    if (!lbl) return;
    var city = cityById(selectedCityId);
    var cat = CATEGORY_LABELS[selectedCategory] || CATEGORY_LABELS.all;
    lbl.textContent =
      (city.id === "all" ? "كل المملكة" : city.label) + " — " + cat;
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
    if (gate) {
      gate.hidden = !show;
      gate.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (shell) {
      shell.hidden = show;
      shell.setAttribute("aria-hidden", show ? "true" : "false");
    }
    if (show && map) {
      if (baseLayerControl) {
        try {
          map.removeControl(baseLayerControl);
        } catch (_rc) {}
        baseLayerControl = null;
      }
      mapBaseLayers = null;
      try {
        map.remove();
      } catch (_rm) {}
      map = null;
      clusterGroup = null;
      markerById = {};
      storeCache = {};
    }
  }

  function storeMatchesCategory(st) {
    if (!st) return false;
    if (selectedCategory === "all") return true;
    return String(st.map_category || "store") === selectedCategory;
  }

  function upsertMarker(st) {
    if (!clusterGroup || !st || !st.id) return;
    storeCache[String(st.id)] = st;
    if (!storeMatchesCategory(st)) {
      if (markerById[st.id]) {
        clusterGroup.removeLayer(markerById[st.id]);
        delete markerById[st.id];
      }
      return;
    }
    if (markerById[st.id]) {
      markerById[st.id].setIcon(buildPulseIcon(st));
      markerById[st.id].setPopupContent(popupHtml(st));
      return;
    }
    var m = L.marker([st.lat, st.lng], { icon: buildPulseIcon(st) });
    m.bindPopup(popupHtml(st), { maxWidth: 280, className: "erv-live-popup-leaflet" });
    markerById[st.id] = m;
    clusterGroup.addLayer(m);
  }

  function renderFeeder() {
    var listEl = document.getElementById("liveMapFeederList");
    var countEl = document.getElementById("liveMapFeederCount");
    if (!listEl) return;
    var items = Object.keys(storeCache)
      .map(function (id) {
        return storeCache[id];
      })
      .filter(function (st) {
        return st && storeMatchesCategory(st);
      })
      .sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""), "ar");
      });
    if (countEl) countEl.textContent = String(items.length);
    if (!items.length) {
      listEl.innerHTML =
        '<p class="erv-live-map-feeder__empty">لا توجد أنشطة في هذه المنطقة — حرّك الخريطة أو غيّر المدينة/القسم.</p>';
      return;
    }
    listEl.innerHTML = items
      .slice(0, 40)
      .map(function (st) {
        return (
          '<a class="erv-live-map-feeder__item" role="listitem" href="' +
          esc(st.store_url) +
          '">' +
          '<span class="erv-live-map-feeder__dot" style="--erv-marker-color:' +
          esc(colorForStore(st)) +
          '"></span>' +
          '<span class="erv-live-map-feeder__meta">' +
          '<strong class="erv-live-map-feeder__name">' +
          esc(st.name) +
          "</strong>" +
          '<span class="erv-live-map-feeder__cat">' +
          esc(st.category_label || "—") +
          "</span>" +
          "</span>" +
          '<span class="erv-live-map-feeder__open' +
          (st.is_open ? " is-open" : "") +
          '">' +
          esc(st.open_label || "—") +
          "</span></a>"
        );
      })
      .join("");
  }

  function wireFeederToggle() {
    if (feederWired) return;
    var toggle = document.getElementById("liveMapFeederToggle");
    var body = document.getElementById("liveMapFeederBody");
    if (!toggle || !body) return;
    feederWired = true;
    toggle.addEventListener("click", function () {
      var open = body.hidden;
      body.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function applyCategoryFilter() {
    if (!clusterGroup) return;
    Object.keys(markerById).forEach(function (id) {
      clusterGroup.removeLayer(markerById[id]);
      delete markerById[id];
    });
    Object.keys(storeCache).forEach(function (id) {
      upsertMarker(storeCache[id]);
    });
    var visible = Object.keys(markerById).length;
    var emptyEl = document.getElementById("liveMapEmpty");
    if (emptyEl) emptyEl.hidden = visible > 0;
    renderFeeder();
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
    var emptyEl = document.getElementById("liveMapEmpty");
    try {
      var j = await api("/api/store/live-map/stores" + boundsQuery());
      if (j && j.map_colors) {
        mapColors = Object.assign(mapColors, j.map_colors);
      }
      var list = (j && j.stores) || [];
      var seen = {};
      list.forEach(function (st) {
        seen[String(st.id)] = true;
        upsertMarker(st);
      });
      Object.keys(storeCache).forEach(function (id) {
        if (!seen[id]) {
          delete storeCache[id];
          if (markerById[id]) {
            clusterGroup.removeLayer(markerById[id]);
            delete markerById[id];
          }
        }
      });
      if (emptyEl) emptyEl.hidden = Object.keys(markerById).length > 0;
      renderFeeder();
    } catch (e) {
      var msg = e && (e.message || e);
      if (/401|403|unauthorized|غير مصر|تسجيل/i.test(String(msg || ""))) {
        showLoginGate(true);
        return;
      }
      console.warn("[live-store-map]", msg);
    }
  }

  function scheduleFetch() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = setTimeout(fetchStoresInView, 320);
  }

  function flyToCity(cityId) {
    var city = cityById(cityId);
    selectedCityId = city.id;
    var search = document.getElementById("liveMapCitySearch");
    if (search) search.value = city.id === "all" ? "" : city.label;
    updateToolbarHint();
    if (!map) return;
    try {
      map.flyTo([city.lat, city.lng], city.zoom || DEFAULT_ZOOM, { animate: true, duration: 0.85 });
    } catch (_f) {
      map.setView([city.lat, city.lng], city.zoom || DEFAULT_ZOOM);
    }
    scheduleFetch();
  }

  function applySearchFromToolbar() {
    var search = document.getElementById("liveMapCitySearch");
    var catSel = document.getElementById("liveMapCategorySelect");
    if (catSel) selectedCategory = String(catSel.value || "all");
    var resolved = resolveCityQuery(search ? search.value : "");
    if (search && search.value.trim() && !resolved) {
      if (typeof global.alert === "function") {
        global.alert("لم نتعرف على هذه المدينة — جرّب الرياض، جدة، مكة…");
      }
      return;
    }
    flyToCity(resolved ? resolved.id : "all");
    applyCategoryFilter();
  }

  function wireToolbar() {
    if (controlsWired) return;
    var search = document.getElementById("liveMapCitySearch");
    var list = document.getElementById("liveMapCityList");
    var catSel = document.getElementById("liveMapCategorySelect");
    var btn = document.getElementById("liveMapSearchBtn");
    if (!search && !catSel) return;
    controlsWired = true;

    if (list) {
      list.innerHTML = "";
      LIVE_MAP_CITIES.forEach(function (city) {
        if (city.id === "all") return;
        var opt = document.createElement("option");
        opt.value = city.label;
        list.appendChild(opt);
      });
    }

    if (btn) btn.addEventListener("click", applySearchFromToolbar);
    if (search) {
      search.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          applySearchFromToolbar();
        }
      });
    }
    if (catSel) {
      catSel.addEventListener("change", function () {
        selectedCategory = String(catSel.value || "all");
        updateToolbarHint();
        applyCategoryFilter();
      });
    }
    updateToolbarHint();
  }

  function createMapBaseLayers() {
    return {
      satellite: [
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          attribution: "Imagery &copy; Esri",
        }),
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
          subdomains: "abcd",
          maxZoom: 19,
          opacity: 0.75,
          attribution: "&copy; CARTO",
        }),
      ],
      terrain: [
        L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          maxZoom: 17,
          attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
        }),
      ],
    };
  }

  function updateBaseLayerButtons() {
    var root = document.querySelector(".erv-live-map-layer-ctrl");
    if (!root) return;
    root.querySelectorAll("[data-base-mode]").forEach(function (btn) {
      var on = btn.getAttribute("data-base-mode") === activeBaseMode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function applyMapBaseMode(mode) {
    if (!map || !mapBaseLayers) return;
    mode = mode === "terrain" ? "terrain" : "satellite";
    ["satellite", "terrain"].forEach(function (key) {
      (mapBaseLayers[key] || []).forEach(function (layer) {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    });
    (mapBaseLayers[mode] || []).forEach(function (layer) {
      layer.addTo(map);
    });
    activeBaseMode = mode;
    try {
      sessionStorage.setItem("erv_live_map_base", mode);
    } catch (_e) {}
    updateBaseLayerButtons();
  }

  function addBaseLayerControl() {
    if (baseLayerControl || !map) return;
    baseLayerControl = L.control({ position: "topright" });
    baseLayerControl.onAdd = function () {
      var div = L.DomUtil.create("div", "erv-live-map-layer-ctrl leaflet-bar");
      div.setAttribute("role", "group");
      div.setAttribute("aria-label", "نوع الخريطة");
      div.innerHTML =
        '<button type="button" class="erv-live-map-layer-ctrl__btn' +
        (activeBaseMode === "satellite" ? " is-active" : "") +
        '" data-base-mode="satellite" aria-pressed="' +
        (activeBaseMode === "satellite" ? "true" : "false") +
        '" title="أقمار صناعية">' +
        '<span class="erv-live-map-layer-ctrl__ic" aria-hidden="true">🛰️</span>' +
        '<span class="erv-live-map-layer-ctrl__txt">أقمار</span></button>' +
        '<button type="button" class="erv-live-map-layer-ctrl__btn' +
        (activeBaseMode === "terrain" ? " is-active" : "") +
        '" data-base-mode="terrain" aria-pressed="' +
        (activeBaseMode === "terrain" ? "true" : "false") +
        '" title="تضاريس">' +
        '<span class="erv-live-map-layer-ctrl__ic" aria-hidden="true">⛰️</span>' +
        '<span class="erv-live-map-layer-ctrl__txt">تضاريس</span></button>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelectorAll("[data-base-mode]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          applyMapBaseMode(btn.getAttribute("data-base-mode"));
        });
      });
      return div;
    };
    baseLayerControl.addTo(map);
  }

  function initMap() {
    var el = document.getElementById("liveMap");
    if (!el || typeof L === "undefined" || map) return;

    map = L.map(el, { zoomControl: true, preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    mapBaseLayers = createMapBaseLayers();
    var savedMode = "satellite";
    try {
      savedMode = sessionStorage.getItem("erv_live_map_base") || "satellite";
    } catch (_ss) {}
    applyMapBaseMode(savedMode);
    addBaseLayerControl();

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
    map.on("zoomend", scheduleFetch);

    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 200);
    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 800);

    wireToolbar();
    wireFeederToggle();

    if (!runtime.adminMode && navigator.geolocation && selectedCityId === "all") {
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
    if (runtime.isPublicPage && !runtime.adminMode) {
      var enabled = await checkPublicEnabled();
      if (!enabled) {
        showFeatureDisabled(true);
        return;
      }
      showFeatureDisabled(false);
    }
    if (!runtime.adminMode && !hasToken()) {
      showLoginGate(true);
      return;
    }
    if (!runtime.adminMode) showLoginGate(false);
    await loadBrandingColors();
    if (!map) initMap();
    else {
      map.invalidateSize();
      scheduleFetch();
    }
  }

  global.ErvenowLiveStoreMap = {
    boot: boot,
    refresh: fetchStoresInView,
    hasToken: hasToken,
    flyToCity: flyToCity,
    getMap: function () {
      return map;
    },
    configure: function (opts) {
      opts = opts && typeof opts === "object" ? opts : {};
      if (opts.adminMode) runtime.adminMode = true;
      if (opts.skipAutoBoot) runtime.skipAutoBoot = true;
    },
  };

  if (typeof global.addEventListener === "function") {
    global.addEventListener("ervenow:auth-changed", function () {
      if (runtime.isPublicPage && !runtime.adminMode) void boot();
    });
    global.addEventListener("pageshow", function (ev) {
      if (runtime.isPublicPage && !runtime.adminMode && ev && ev.persisted) void boot();
    });
    global.addEventListener("storage", function (ev) {
      if (runtime.isPublicPage && !runtime.adminMode && ev && /token|auth/i.test(String(ev.key || ""))) {
        void boot();
      }
    });
    var resizeTimer = null;
    global.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (map) {
          try {
            map.invalidateSize();
          } catch (_e) {}
        }
      }, 150);
    });
    global.addEventListener("orientationchange", function () {
      setTimeout(function () {
        if (map) {
          try {
            map.invalidateSize();
          } catch (_e2) {}
        }
      }, 350);
    });
  }

  if (!runtime.skipAutoBoot && runtime.isPublicPage) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(typeof window !== "undefined" ? window : global);
