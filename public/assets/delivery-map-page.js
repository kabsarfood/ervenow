/**
 * ERVENOW — صفحة طلب التوصيل من الخريطة (/delivery-map)
 */
(function (global) {
  "use strict";

  function mapPageHasToken() {
    try {
      return !!(global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken());
    } catch (e) {
      return false;
    }
  }

      var km = 0;
      var fromLL = null;
      var toLL = null;
      var deliveryInputMode = "map";
      var pickupMapsUrl = "";
      var dropMapsUrl = "";
      var fromDistrictLabel = "";
      var toDistrictLabel = "";
      var reverseGeoCache = {};
      var selectType = null;
      var geoCache = {};
      var map = null;
      var markerFrom = null;
      var markerTo = null;
      var markerUser = null;
      var routeLine = null;
      var baseTerrain = null;
      var baseSatellite = null;
      var clientLocation = null;
      var selectButtons = { from: "btnSelectFrom", to: "btnSelectTo" };
      var routeCache = {};
      var lastDrawnRouteKey = "";
      var refreshMapSizeTimer = null;
      var resizeObserverPaused = false;

      function isMobileMapLayout() {
        try {
          return window.matchMedia("(max-width: 767px)").matches;
        } catch (e) {
          return false;
        }
      }

      function getMapScrollRoot() {
        if (isMobileMapLayout()) {
          return document.scrollingElement || document.documentElement;
        }
        return document.querySelector(".delivery-map-page__scroll");
      }

      function routeEndpointsKey(a, b) {
        if (!a || !b) return "";
        return (
          roundMapCoord(a.lat) +
          "," +
          roundMapCoord(a.lng) +
          "|" +
          roundMapCoord(b.lat) +
          "," +
          roundMapCoord(b.lng)
        );
      }

      function formatRouteDuration(seconds) {
        var sec = Number(seconds);
        if (!Number.isFinite(sec) || sec <= 0) return "—";
        var mins = Math.max(1, Math.round(sec / 60));
        if (mins < 60) return "≈ " + mins + " د";
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return m ? "≈ " + h + " س " + m + " د" : "≈ " + h + " س";
      }

      function renderRouteDuration(seconds) {
        var el = document.getElementById("routeDuration");
        if (!el) return;
        el.textContent = formatRouteDuration(seconds);
      }

      function getSelectedVehicleType() {
        var el = document.getElementById("vehicleType");
        var v = (el && el.value) || "car";
        return v === "bike" ? "bike" : "car";
      }

      var ERV_PLATFORM_COMMISSION_RATE = 0.07;

      function calcDeliveryPricing(kmValue) {
        var kmNum = Number(kmValue) || 0;
        var vehicleType = getSelectedVehicleType();
        var fee = kmNum <= 7 ? (vehicleType === "bike" ? 15 : 22) : kmNum * 2.3;
        fee = Math.round(fee * 100) / 100;
        var platformFee = Math.round(fee * ERV_PLATFORM_COMMISSION_RATE * 100) / 100;
        var driverNet = Math.round((fee - platformFee) * 100) / 100;
        return { fee: fee, platformFee: platformFee, driverNet: driverNet };
      }

      function renderPricingStats(kmValue) {
        var p = calcDeliveryPricing(kmValue);
        var priceEl = document.getElementById("price");
        var distEl = document.getElementById("distance");
        if (priceEl) priceEl.innerText = p.fee.toFixed(2) + " ر.س";
        if (distEl) distEl.innerText = Number(kmValue).toFixed(2) + " كم";
        var pf = document.getElementById("platformFeeLine");
        var dn = document.getElementById("driverNetLine");
        if (pf) pf.innerText = p.platformFee.toFixed(2) + " ر.س (7%)";
        if (dn) dn.innerText = p.driverNet.toFixed(2) + " ر.س";
      }

      function recalculatePricePreview() {
        if (km > 0) renderPricingStats(km);
      }

      function bindMapTouchIsolation() {
        if (!map || map._erwTouchBound) return;
        map._erwTouchBound = true;
        var container = map.getContainer();
        if (!container || !L || !L.DomEvent) return;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        if (map.touchZoom && map.touchZoom.enable) map.touchZoom.enable();
        if (map.dragging && map.dragging.enable) map.dragging.enable();
        if (map.scrollWheelZoom && map.scrollWheelZoom.disable) map.scrollWheelZoom.disable();
        if (map.doubleClickZoom && map.doubleClickZoom.disable) map.doubleClickZoom.disable();
        if (map.boxZoom && map.boxZoom.disable) map.boxZoom.disable();
      }

      function initMap() {
        if (map || typeof L === "undefined") return;
        map = L.map("pickupDropMap", {
          zoomControl: true,
          scrollWheelZoom: false,
          tap: true,
          touchZoom: true,
          dragging: true,
          inertia: true,
          updateWhenIdle: true,
          updateWhenZooming: false,
        }).setView([24.7136, 46.6753], 11);
        baseTerrain = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors, SRTM | OpenTopoMap",
          maxZoom: 17,
          updateWhenIdle: true,
          updateWhenZooming: false,
          keepBuffer: 2,
        });
        baseSatellite = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution: "Tiles &copy; Esri",
            maxZoom: 19,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 2,
          }
        );
        baseSatellite.addTo(map);
        L.control.layers(
          {
            "أقمار صناعية": baseSatellite,
            "تضاريس": baseTerrain,
          },
          null,
          { position: "topright" }
        ).addTo(map);
        map.on("click", onMapClick);
        bindMapTouchIsolation();
        tryInitClientLocation();
        map.whenReady(function () {
          refreshMapSize(true);
        });
      }

      function refitMapView() {
        if (!map) return;
        try {
          if (routeLine) {
            map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
            return;
          }
          var layers = [];
          if (markerFrom) layers.push(markerFrom);
          if (markerTo) layers.push(markerTo);
          if (layers.length) {
            map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [30, 30] });
          }
        } catch (e) {}
      }

      function refreshMapSize(refit) {
        if (!map) return;
        clearTimeout(refreshMapSizeTimer);
        refreshMapSizeTimer = setTimeout(function () {
          if (!map) return;
          map.invalidateSize({ animate: false, pan: false });
          if (refit) refitMapView();
        }, refit ? 100 : 60);
      }

      var mapResizeObserverBound = false;
      function bindMapResizeObserver() {
        if (mapResizeObserverBound || typeof ResizeObserver === "undefined") return;
        var mapEl = document.getElementById("pickupDropMap");
        var mapCell = document.querySelector(".map-canvas-cell--map");
        var actionsEl = document.getElementById("mapCanvasActions");
        var pageRoot = document.querySelector(".delivery-map-page__shell");
        if (!pageRoot) return;
        mapResizeObserverBound = true;
        var timer = null;
        var observer = new ResizeObserver(function () {
          if (resizeObserverPaused) return;
          clearTimeout(timer);
          timer = setTimeout(function () {
            refreshMapSize(false);
          }, 120);
        });
        observer.observe(mapEl);
        if (mapCell) observer.observe(mapCell);
        if (actionsEl) observer.observe(actionsEl);
        observer.observe(pageRoot);
      }

      function showMap() {
        if (!map || !routeLine) return;
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
      }

      function enableCreate() {
        var btn = document.getElementById("createBtn");
        if (!btn) return;
        btn.disabled = !(km > 0 && fromLL && toLL);
      }

      function setDeliveryMode(mode) {
        deliveryInputMode = mode === "map" ? "map" : "links";
        var linksPanel = document.getElementById("deliveryModeLinks");
        var mapPanel = document.getElementById("deliveryModeMap");
        var tabLinks = document.getElementById("tabModeLinks");
        var tabMap = document.getElementById("tabModeMap");
        var actions = document.getElementById("mapCanvasActions");
        if (linksPanel) linksPanel.hidden = deliveryInputMode !== "links";
        if (mapPanel) mapPanel.hidden = deliveryInputMode !== "map";
        if (tabLinks) {
          tabLinks.classList.toggle("is-active", deliveryInputMode === "links");
          tabLinks.setAttribute("aria-selected", deliveryInputMode === "links" ? "true" : "false");
        }
        if (tabMap) {
          tabMap.classList.toggle("is-active", deliveryInputMode === "map");
          tabMap.setAttribute("aria-selected", deliveryInputMode === "map" ? "true" : "false");
        }
        if (actions) actions.setAttribute("data-route-mode", deliveryInputMode);
        var grid = document.querySelector(".map-canvas-grid");
        if (grid) grid.setAttribute("data-route-mode", deliveryInputMode);
        updateApplyBtnLabel();
        if (deliveryInputMode === "links") {
          selectType = null;
          updateSelectButtonsUi();
        }
        initMap();
        bindMapResizeObserver();
        refreshMapSize(false);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () {
            refreshMapSize(true);
          });
        }
        var res = document.getElementById("result");
        if (res) {
          res.innerText =
            deliveryInputMode === "links"
              ? "الصق رابطي الاستلام والتسليم ثم اضغط «انقر هنا لتطبيق الروابط و رسم المسار»."
              : "اضغط «خريطة» عند الاستلام أو التسليم ثم اختر النقطتين على الخريطة.";
        }
      }

      function updateApplyBtnLabel() {
        var btn = document.getElementById("btnApplyMapRoute");
        if (!btn || btn.disabled || deliveryInputMode !== "links") return;
        btn.textContent = "انقر هنا لتطبيق الروابط و رسم المسار";
      }

      function mapHaversineM(a, b) {
        if (!a || !b) return Infinity;
        var R = 6371000;
        var p = Math.PI / 180;
        var dLat = (b.lat - a.lat) * p;
        var dLng = (b.lng - a.lng) * p;
        var x =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(x));
      }

      function roundMapCoord(n) {
        return Math.round(Number(n) * 1e6) / 1e6;
      }

      function normalizeMapLL(ll) {
        if (!ll) return null;
        return { lat: roundMapCoord(ll.lat), lng: roundMapCoord(ll.lng) };
      }

      function scrollToMapRoutes() {
        var mobile = window.matchMedia("(max-width: 767px)").matches;
        var el =
          deliveryInputMode === "links"
            ? document.getElementById("deliveryModeLinks") || document.querySelector(".map-canvas-cell--method")
            : document.getElementById("mapCanvasActions");
        if (!el) return;
        var panel = getMapScrollRoot();
        if (panel && mobile) {
          var panelRect = panel.getBoundingClientRect();
          var elRect = el.getBoundingClientRect();
          var nextTop = panel.scrollTop + (elRect.top - panelRect.top) - 12;
          panel.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: mobile ? "start" : "nearest" });
      }

      function upsertMapMarker(kind, lat, lng, popupText) {
        if (!map) return null;
        var pos = [lat, lng];
        if (kind === "from") {
          if (!markerFrom) markerFrom = L.marker(pos).addTo(map);
          else markerFrom.setLatLng(pos);
          markerFrom.bindPopup(popupText);
          return markerFrom;
        }
        if (!markerTo) markerTo = L.marker(pos).addTo(map);
        else markerTo.setLatLng(pos);
        markerTo.bindPopup(popupText);
        return markerTo;
      }

      function setRouteLineGeometry(geometry) {
        if (!map || !geometry) return;
        if (routeLine) {
          routeLine.clearLayers();
          routeLine.addData(geometry);
          return;
        }
        routeLine = L.geoJSON(geometry, { style: { color: "#2563eb", weight: 5 } }).addTo(map);
      }

      function saveMapLinkField(inputId) {
        var el = document.getElementById(inputId);
        var res = document.getElementById("result");
        if (!el || !String(el.value || "").trim()) {
          if (res) res.innerText = "❌ الصق الرابط أولاً";
          return;
        }
        if (res) res.innerText = "✓ تم حفظ الرابط";
      }

      async function applyMapRoute() {
        var btn = document.getElementById("btnApplyMapRoute");
        var prevLabel = btn ? btn.textContent : "";
        if (btn) {
          btn.disabled = true;
          btn.textContent = "جارٍ تطبيق المواقع ورسم المسار…";
        }
        try {
          if (deliveryInputMode === "links") {
            await applyMapLinks();
          } else {
            await calculate();
          }
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = prevLabel || "";
            updateApplyBtnLabel();
          }
        }
      }

      function syncMapCustomerPhone() {
        var sender = document.getElementById("mapSenderPhone");
        var hidden = document.getElementById("mapCustomerPhone");
        if (sender && hidden) hidden.value = String(sender.value || "").trim();
      }

      async function pasteMapLink(inputId) {
        var el = document.getElementById(inputId);
        if (!el) return;
        try {
          var t = await navigator.clipboard.readText();
          if (t) {
            el.value = String(t).trim();
            handleLocationInputChange();
          }
        } catch (e) {
          el.focus();
          document.getElementById("result").innerText = "الصق الرابط يدوياً (Ctrl+V) في الحقل.";
        }
      }

      function updateLiveMapPreview() {
        var line = document.getElementById("liveMapLine");
        var a = document.getElementById("liveMapPreview");
        if (!line || !a) return;
        if (fromLL && toLL && window.ErvenowDeliveryMap) {
          var u =
            "https://www.google.com/maps/dir/" +
            encodeURIComponent(fromLL.lat + "," + fromLL.lng) +
            "/" +
            encodeURIComponent(toLL.lat + "," + toLL.lng);
          a.href = u;
          line.hidden = false;
        } else {
          line.hidden = true;
          a.removeAttribute("href");
        }
      }

      function getMapProductPayload() {
        var typeEl = document.getElementById("mapProductType");
        var qtyEl = document.getElementById("mapProductQty");
        var noteEl = document.getElementById("mapProductNote");
        var typeKey = (typeEl && typeEl.value) || "other";
        var qty = (qtyEl && qtyEl.value) || 1;
        var note = (noteEl && noteEl.value) || "";
        var DM = window.ErvenowDeliveryMap;
        var label = DM ? DM.formatProductLine(typeKey, qty, note) : "طلب توصيل";
        return { typeKey: typeKey, qty: qty, note: note, label: label };
      }

      async function resolveMapsLinkInput(linkText) {
        var DM = window.ErvenowDeliveryMap;
        var raw = String(linkText || "").trim();
        if (!raw || !DM) return null;
        if (DM.resolveMapsLinkAsync) {
          var resolved = await DM.resolveMapsLinkAsync(raw);
          if (resolved && resolved.ll) {
            return {
              ll: normalizeMapLL(resolved.ll),
              mapsUrl: resolved.mapsUrl || DM.buildGoogleMapsUrl(resolved.ll.lat, resolved.ll.lng),
            };
          }
          if (resolved && resolved.error) {
            return { error: resolved.error };
          }
        }
        var ll = DM.parseMapsUrl(raw);
        if (ll) {
          ll = normalizeMapLL(ll);
          return {
            ll: ll,
            mapsUrl: /^https?:\/\//i.test(raw) ? raw : DM.buildGoogleMapsUrl(ll.lat, ll.lng),
          };
        }
        return null;
      }

      async function resolveMapsLinkField(linkText, fieldLabel) {
        var raw = String(linkText || "").trim();
        if (!raw) {
          throw new Error("❌ " + fieldLabel + ": الصق رابط Google Maps أولاً.");
        }
        var resolved = await resolveMapsLinkInput(raw);
        if (resolved && resolved.error) {
          throw new Error("❌ " + fieldLabel + ": " + resolved.error);
        }
        if (!resolved || !resolved.ll) {
          throw new Error(
            "❌ " +
              fieldLabel +
              ": تعذر قراءة الإحداثيات. استخدم «مشاركة» من Google Maps (maps.app.goo.gl) أو lat,lng."
          );
        }
        return resolved;
      }

      async function resolveLocationFromField(text, linkFieldId) {
        var DM = window.ErvenowDeliveryMap;
        var raw = String(text || "").trim();
        if (!raw) return null;
        var linkEl = linkFieldId ? document.getElementById(linkFieldId) : null;
        var linkVal = linkEl ? String(linkEl.value || "").trim() : "";
        if (linkVal) {
          var fromDedicated = await resolveMapsLinkInput(linkVal);
          if (fromDedicated) return { ll: fromDedicated.ll, mapsUrl: fromDedicated.mapsUrl };
        }
        if (DM) {
          var fromMapsResolved = await resolveMapsLinkInput(raw);
          if (fromMapsResolved) {
            return { ll: fromMapsResolved.ll, mapsUrl: fromMapsResolved.mapsUrl };
          }
          var fromPair = DM.parseLatLngPair(raw);
          if (fromPair) {
            return {
              ll: fromPair,
              mapsUrl: DM.buildGoogleMapsUrl(fromPair.lat, fromPair.lng),
            };
          }
        }
        var geo = await geocode(raw);
        return { ll: geo, mapsUrl: DM ? DM.buildGoogleMapsUrl(geo.lat, geo.lng) : "" };
      }

      async function applyMapLinks() {
        var resultEl = document.getElementById("result");
        var fromInput = document.getElementById("fromLink");
        var toInput = document.getElementById("toLink");
        try {
          var fromLink = String(fromInput && fromInput.value ? fromInput.value : "").trim();
          var toLink = String(toInput && toInput.value ? toInput.value : "").trim();
          if (!fromLink || !toLink) {
            resultEl.innerText = "❌ الصق رابط الاستلام ورابط التسليم في الحقلين أعلاه.";
            return;
          }
          var DM = window.ErvenowDeliveryMap;
          if (!DM) throw new Error("تعذر تحميل أدوات الخريطة");
          resultEl.innerText = "جارٍ فك روابط Google Maps وتحديد نقاط الاستلام والتسليم بدقة…";
          var fromResolved;
          var toResolved;
          try {
            fromResolved = await resolveMapsLinkField(fromLink, "الاستلام");
            toResolved = await resolveMapsLinkField(toLink, "التسليم");
          } catch (fieldErr) {
            resultEl.innerText = fieldErr.message || "❌ تعذر قراءة أحد الروابط";
            return;
          }
          var sepM = mapHaversineM(fromResolved.ll, toResolved.ll);
          if (!Number.isFinite(sepM) || sepM < 30) {
            resultEl.innerText = "❌ نقطتا الاستلام والتسليم متقاربتان جداً — تحقق من الرابطين.";
            return;
          }
          fromLL = fromResolved.ll;
          toLL = toResolved.ll;
          pickupMapsUrl = fromResolved.mapsUrl || DM.buildGoogleMapsUrl(fromLL.lat, fromLL.lng);
          dropMapsUrl = toResolved.mapsUrl || DM.buildGoogleMapsUrl(toLL.lat, toLL.lng);
          if (fromInput) fromInput.value = pickupMapsUrl;
          if (toInput) toInput.value = dropMapsUrl;
          fromDistrictLabel = await reverseGeocodeDistrict(fromLL.lat, fromLL.lng);
          toDistrictLabel = await reverseGeocodeDistrict(toLL.lat, toLL.lng);
          document.getElementById("from").value =
            fromDistrictLabel && fromDistrictLabel !== "—" ? fromDistrictLabel : "موقع الاستلام";
          document.getElementById("to").value =
            toDistrictLabel && toDistrictLabel !== "—" ? toDistrictLabel : "موقع التسليم";
          await drawRouteAndPricing();
          resultEl.innerText =
            "✓ تم تحديد الاستلام والتسليم — المسافة " +
            (km ? km.toFixed(2) : "—") +
            " كم. راجع الخريطة ثم «أضف إلى السلة».";
        } catch (e) {
          resultEl.innerText = "❌ " + (e.message || "تعذر قراءة الرابط");
        }
      }

      async function drawRouteAndPricing() {
        if (!fromLL || !toLL) return;
        initMap();
        var drawKey = routeEndpointsKey(fromLL, toLL);
        var route = await getRoute(fromLL, toLL);
        km = route.distance / 1000;
        document.getElementById("distance").innerText = km.toFixed(2) + " كم";
        renderRouteDuration(route.duration);
        renderPricingStats(km);
        document.getElementById("result").innerText = "";
        if (map) {
          upsertMapMarker("from", fromLL.lat, fromLL.lng, "📍 الاستلام");
          upsertMapMarker("to", toLL.lat, toLL.lng, "📍 التسليم");
          if (drawKey !== lastDrawnRouteKey || !routeLine) {
            setRouteLineGeometry(route.geometry);
            lastDrawnRouteKey = drawKey;
          }
          showMap();
        }
        updateLiveMapPreview();
        enableCreate();
        refreshMapSize(true);
      }

      function updateSelectButtonsUi() {
        Object.keys(selectButtons).forEach(function (k) {
          var id = selectButtons[k];
          var el = document.getElementById(id);
          if (!el) return;
          if (selectType === k) el.classList.add("is-active");
          else el.classList.remove("is-active");
        });
        var mapEl = document.getElementById("pickupDropMap");
        if (mapEl) {
          if (selectType) mapEl.classList.add("map-selecting");
          else mapEl.classList.remove("map-selecting");
        }
      }

      function setClientLocationMarker(lat, lng) {
        if (!map) return;
        if (markerUser) {
          markerUser.setLatLng([lat, lng]);
        } else {
          markerUser = L.circleMarker([lat, lng], {
            radius: 7,
            weight: 2,
            color: "#2563eb",
            fillColor: "#60a5fa",
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindPopup("📍 موقعك الحالي");
        }
      }

      async function reverseGeocode(lat, lng) {
        try {
          var url =
            "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
            encodeURIComponent(lat) +
            "&lon=" +
            encodeURIComponent(lng) +
            "&accept-language=ar";
          var r = await fetch(url, {
            headers: { "Accept-Language": "ar" },
          });
          var j = await r.json();
          return String(j && j.display_name ? j.display_name : "").trim();
        } catch (e) {
          return "";
        }
      }

      function tryInitClientLocation() {
        if (!navigator.geolocation || clientLocation) return;
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            clientLocation = { lat: lat, lng: lng };
            if (map) {
              map.setView([lat, lng], 14);
              setClientLocationMarker(lat, lng);
            }
          },
          function () {},
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      }

      function handleLocationInputChange() {
        km = 0;
        fromLL = null;
        toLL = null;
        selectType = null;
        if (map && markerFrom) {
          map.removeLayer(markerFrom);
          markerFrom = null;
        }
        if (map && markerTo) {
          map.removeLayer(markerTo);
          markerTo = null;
        }
        if (map && routeLine) {
          map.removeLayer(routeLine);
          routeLine = null;
        }
        document.getElementById("distance").innerText = "—";
        renderRouteDuration(0);
        document.getElementById("price").innerText = "—";
        lastDrawnRouteKey = "";
        document.getElementById("platformFeeLine").innerText = "—";
        document.getElementById("driverNetLine").innerText = "—";
        document.getElementById("result").innerText = "";
        pickupMapsUrl = "";
        dropMapsUrl = "";
        fromDistrictLabel = "";
        toDistrictLabel = "";
        selectType = null;
        updateLiveMapPreview();
        updateSelectButtonsUi();
        enableCreate();
      }

      function selectMode(type) {
        selectType = type;
        updateSelectButtonsUi();
        document.getElementById("result").innerText =
          type === "from" ? "📍 اختر نقطة الاستلام على الخريطة" : "📍 اختر نقطة التسليم على الخريطة";
      }

      function openGoogleMapsFor(kind) {
        initMap();
        var isFrom = kind === "from";
        var ll = isFrom ? fromLL : toLL;
        var input = document.getElementById(isFrom ? "from" : "to");
        var val = input ? String(input.value || "").trim() : "";
        var url;
        if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) {
          url = "https://www.google.com/maps?q=" + encodeURIComponent(ll.lat + "," + ll.lng);
        } else if (val) {
          url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(val);
        } else {
          url = "https://www.google.com/maps";
        }
        window.open(url, "_blank", "noopener,noreferrer");
        var res = document.getElementById("result");
        if (res) {
          res.innerText =
            "🗺 انسخ من Google إلى خانة «" +
            (isFrom ? "الاستلام" : "التسليم") +
            "» ثم اضغط «احسب المسافة».";
        }
      }

      async function onMapClick(e) {
        if (!selectType) return;
        var lat = e.latlng.lat;
        var lng = e.latlng.lng;

        var DM = window.ErvenowDeliveryMap;
        if (selectType === "from") {
          fromLL = { lat: lat, lng: lng };
          var fromAddress = await reverseGeocode(lat, lng);
          document.getElementById("from").value = fromAddress || lat.toFixed(6) + "," + lng.toFixed(6);
          pickupMapsUrl = DM ? DM.buildGoogleMapsUrl(lat, lng) : "";
          upsertMapMarker("from", lat, lng, "📍 الاستلام");
        }

        if (selectType === "to") {
          toLL = { lat: lat, lng: lng };
          var toAddress = await reverseGeocode(lat, lng);
          document.getElementById("to").value = toAddress || lat.toFixed(6) + "," + lng.toFixed(6);
          dropMapsUrl = DM ? DM.buildGoogleMapsUrl(lat, lng) : "";
          upsertMapMarker("to", lat, lng, "📍 التسليم");
        }

        selectType = null;
        updateSelectButtonsUi();

        if (fromLL && toLL) {
          try {
            var DM = window.ErvenowDeliveryMap;
            if (DM && !pickupMapsUrl) pickupMapsUrl = DM.buildGoogleMapsUrl(fromLL.lat, fromLL.lng);
            if (DM && !dropMapsUrl) dropMapsUrl = DM.buildGoogleMapsUrl(toLL.lat, toLL.lng);
            await drawRouteAndPricing();
          } catch (err) {
            document.getElementById("result").innerText = "❌ " + (err.message || "تعذر حساب المسافة");
          }
        }
      }

      function parseLatLngInput(v) {
        var DM = window.ErvenowDeliveryMap;
        return DM ? DM.parseLatLngPair(v) : null;
      }

      async function geocode(q) {
        if (geoCache[q]) return geoCache[q];
        // ملاحظة إنتاج: Nominatim عليه limits؛ الأفضل API مدفوع أو caching على الخادم.
        var url = "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(q);
        var r = await fetch(url, {
          headers: {
            "Accept-Language": "ar",
          },
        });
        var j = await r.json();
        if (!j || !j[0]) throw new Error("تعذر تحديد الموقع");
        var p = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
        geoCache[q] = p;
        return p;
      }

      function isMapsUrl(s) {
        var t = String(s || "").trim();
        return /^(https?:\/\/)/i.test(t) || /google\.com\/maps|maps\.app\.goo|goo\.gl\/maps/i.test(t);
      }

      function humanLocationText(s) {
        var t = String(s || "").trim();
        return t && !isMapsUrl(t) ? t : "";
      }

      async function reverseGeocodeDistrict(lat, lng) {
        var key = Number(lat).toFixed(5) + "," + Number(lng).toFixed(5);
        if (reverseGeoCache[key]) return reverseGeoCache[key];
        var url =
          "https://nominatim.openstreetmap.org/reverse?format=json&lat=" +
          lat +
          "&lon=" +
          lng +
          "&accept-language=ar";
        var r = await fetch(url, { headers: { "Accept-Language": "ar" } });
        var j = await r.json();
        var a = (j && j.address) || {};
        var name =
          a.suburb ||
          a.neighbourhood ||
          a.quarter ||
          a.city_district ||
          a.district ||
          a.city ||
          a.town ||
          a.village ||
          "";
        reverseGeoCache[key] = name || "—";
        return reverseGeoCache[key];
      }

      async function getRoute(a, b) {
        var key = routeEndpointsKey(a, b);
        if (key && routeCache[key]) return routeCache[key];
        var url =
          "https://router.project-osrm.org/route/v1/driving/" +
          a.lng +
          "," +
          a.lat +
          ";" +
          b.lng +
          "," +
          b.lat +
          "?overview=full&geometries=geojson";
        var r = await fetch(url);
        var j = await r.json();
        if (!j.routes || !j.routes[0]) throw new Error("فشل حساب المسار");
        if (key) routeCache[key] = j.routes[0];
        return j.routes[0];
      }

      async function calculate() {
        try {
          initMap();
          var fromResolved;
          var toResolved;
          if (deliveryInputMode === "links") {
            await applyMapLinks();
            return;
          }
          var from = document.getElementById("from").value.trim();
          var to = document.getElementById("to").value.trim();
          if (!from || !to) {
            alert("أدخل موقع الاستلام والتسليم أولاً");
            return;
          }
          fromResolved = await resolveLocationFromField(from, null);
          toResolved = await resolveLocationFromField(to, null);
          fromLL = fromResolved.ll;
          toLL = toResolved.ll;
          pickupMapsUrl = fromResolved.mapsUrl || "";
          dropMapsUrl = toResolved.mapsUrl || "";
          fromDistrictLabel = humanLocationText(from) || (await reverseGeocodeDistrict(fromLL.lat, fromLL.lng));
          toDistrictLabel = humanLocationText(to) || (await reverseGeocodeDistrict(toLL.lat, toLL.lng));
          await drawRouteAndPricing();
        } catch (e) {
          document.getElementById("result").innerText =
            "❌ " + (e.message || "تعذر حساب المسافة");
          enableCreate();
        }
      }

      async function resolveMapPageCustomerPhone() {
        var phone = "";
        try {
          if (mapPageHasToken() && window.PlatformAPI && typeof PlatformAPI.api === "function") {
            var me = await PlatformAPI.api("/api/core/me");
            phone = String(
              (me && me.profile && me.profile.phone) ||
                (me && me.user && me.user.phone) ||
                ""
            ).trim();
          }
        } catch (e) {}
        return phone;
      }

      async function buildMapCartItem() {
        var from = document.getElementById("from").value.trim();
        var to = document.getElementById("to").value.trim();
        if (!km || !fromLL || !toLL) await calculate();
        if (!km) throw new Error("احسب المسافة أولاً");
        var pricing = calcDeliveryPricing(km);
        syncMapCustomerPhone();
        var phone = await resolveMapPageCustomerPhone();
        var senderEl = document.getElementById("mapSenderPhone");
        var recipientEl = document.getElementById("mapRecipientPhone");
        if (!phone && senderEl) phone = String(senderEl.value || "").trim();
        var recipientPhone = recipientEl ? String(recipientEl.value || "").trim() : "";
        if (window.ErvenowServiceCart && typeof ErvenowServiceCart.validateSaPhone === "function") {
          phone = ErvenowServiceCart.validateSaPhone(phone) || phone;
          recipientPhone = ErvenowServiceCart.validateSaPhone(recipientPhone) || recipientPhone;
        }
        var visEl = document.getElementById("mapDriverVisibility");
        var driverVisibility = visEl ? String(visEl.value || "now") : "now";
        var product = getMapProductPayload();
        var DM = window.ErvenowDeliveryMap;
        if (!pickupMapsUrl && DM && fromLL) pickupMapsUrl = DM.buildGoogleMapsUrl(fromLL.lat, fromLL.lng);
        if (!dropMapsUrl && DM && toLL) dropMapsUrl = DM.buildGoogleMapsUrl(toLL.lat, toLL.lng);
        var fromLabel = fromDistrictLabel || humanLocationText(from);
        var toLabel = toDistrictLabel || humanLocationText(to);
        if ((!fromLabel || fromLabel === "—") && fromLL) {
          fromLabel = await reverseGeocodeDistrict(fromLL.lat, fromLL.lng);
        }
        if ((!toLabel || toLabel === "—") && toLL) {
          toLabel = await reverseGeocodeDistrict(toLL.lat, toLL.lng);
        }
        if (fromLabel === "—") fromLabel = "موقع الاستلام";
        if (toLabel === "—") toLabel = "موقع التسليم";
        return {
          type: "delivery",
          title: "توصيل من الخريطة — " + product.label,
          price: pricing.fee,
          customer_phone: phone,
          data: {
            pickup_address: fromLabel,
            drop_address: toLabel,
            from: fromLabel,
            to: toLabel,
            location: toLabel,
            pickup_district_label: fromLabel,
            drop_district_label: toLabel,
            pickup_maps_url: pickupMapsUrl,
            drop_maps_url: dropMapsUrl,
            pickup_lat: fromLL ? fromLL.lat : null,
            pickup_lng: fromLL ? fromLL.lng : null,
            drop_lat: toLL ? toLL.lat : null,
            drop_lng: toLL ? toLL.lng : null,
            distance_km: Math.round(km * 100) / 100,
            delivery_fee: pricing.fee,
            platform_fee: pricing.platformFee,
            driver_earning: pricing.driverNet,
            vehicle_type: getSelectedVehicleType(),
            customer_phone: phone,
            recipient_phone: recipientPhone,
            driver_visibility: driverVisibility,
            payment_status: "unpaid",
            source: "delivery_map_page",
            product_category: product.typeKey,
            product_qty: product.qty,
            product_note: product.note,
            product_label: product.label,
            qty: 1,
          },
        };
      }

      async function createOrder() {
        var btn = document.getElementById("createBtn");
        var result = document.getElementById("result");
        try {
          syncMapCustomerPhone();
          if (!fromLL || !toLL || !km) {
            await applyMapRoute();
          }
          if (!fromLL || !toLL) {
            result.innerText =
              deliveryInputMode === "links"
                ? "❌ الصق رابطي الاستلام والتسليم ثم اضغط «انقر هنا لتطبيق الروابط و رسم المسار»."
                : "❌ اختر نقطة الاستلام والتسليم على الخريطة (زر «خريطة» ثم النقر على الخريطة).";
            return;
          }
          if (!km) return;

          if (!mapPageHasToken()) {
            var draft;
            try {
              draft = await buildMapCartItem();
            } catch (e0) {
              result.innerText = "❌ " + (e0.message || "أكمل المواقع والمسافة أولاً");
              return;
            }
            if (!draft.customer_phone) {
              result.innerText = "❌ أدخل جوال المرسل (05xxxxxxxx) قبل المتابعة.";
              return;
            }
            if (window.ErvenowServiceCart && typeof ErvenowServiceCart.validateSaPhone === "function") {
              var guestPh = ErvenowServiceCart.validateSaPhone(draft.customer_phone);
              if (!guestPh) {
                result.innerText = "❌ أدخل جوالاً سعودياً صحيحاً (05xxxxxxxx).";
                return;
              }
              draft.customer_phone = guestPh;
              if (draft.data) draft.data.customer_phone = guestPh;
            }
            try {
              sessionStorage.setItem("ervenow:pending-map-cart", JSON.stringify(draft));
            } catch (e1) {}
            window.location.href =
              "/login?mode=register&role=customer&next=" + encodeURIComponent("/cart");
            return;
          }

          btn.disabled = true;
          btn.innerText = "جارٍ الإضافة للسلة...";

          var item = await buildMapCartItem();
          if (!item.customer_phone) {
            result.innerText = "❌ أدخل جوال المرسل (05xxxxxxxx).";
            return;
          }

          if (!window.ErvenowServiceCart || typeof ErvenowServiceCart.add !== "function") {
            throw new Error("تعذر تحميل السلة — حدّث الصفحة");
          }

          var cartRes = ErvenowServiceCart.add(item, {
            message:
              "تمت إضافة طلب التوصيل من الخريطة — أكمل الدفع في السلة لاعتماد الطلب وإرساله للمندوبين.",
          });
          if (!cartRes.ok) {
            result.innerText = "❌ " + (cartRes.message || "تعذر الإضافة للسلة");
            return;
          }
        } catch (e) {
          result.innerText = "❌ " + (e.message || "تعذّر إضافة الطلب للسلة");
        } finally {
          btn.innerText = "أضف إلى السلة";
          enableCreate();
        }
      }



  function bootDeliveryMapPage() {
    if (global.ErvenowGuestShell && ErvenowGuestShell.refreshAuthHeader) {
      ErvenowGuestShell.refreshAuthHeader();
    }
    if (typeof global.updateCartCount === "function") global.updateCartCount();
    setDeliveryMode("map");
    updateApplyBtnLabel();
    initMap();
    bindMapResizeObserver();
    refreshMapSize(true);
    var resizeTimer = null;
    global.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        refreshMapSize(true);
      }, 150);
    });
    if (map) {
      map.on("movestart zoomstart", function () {
        resizeObserverPaused = true;
      });
      map.on("moveend zoomend", function () {
        resizeObserverPaused = false;
      });
    }
    global.addEventListener("storage", function (ev) {
      if (ev.key === "cart" && typeof global.updateCartCount === "function") {
        global.updateCartCount();
      }
    });
    global.addEventListener("ervenow-api-retry", function (ev) {
      var d = ev.detail || {};
      var btn = document.getElementById("createBtn");
      var result = document.getElementById("result");
      if (!btn || !btn.disabled || !result) return;
      if (String(d.path || "").indexOf("/api/delivery/orders") === -1) return;
      result.innerText =
        "جارٍ إنشاء الطلب… (إعادة محاولة " + d.attempt + " من " + d.maxAttempts + ")";
    });
    global.addEventListener("ervenow-offline-queued", function () {
      var result = document.getElementById("result");
      if (result) {
        result.innerText =
          "⚠ لا يوجد اتصال: اُحتفظ بالطلب محلياً وسيُرسل تلقائياً عند عودة الشبكة.";
      }
    });
  }

  global.getDeliveryMapPageState = function () {
    return { km: km, fromLL: fromLL, toLL: toLL, hasRoute: !!routeLine };
  };

  global.initMap = initMap;
  global.onMapClick = onMapClick;
  global.getRoute = getRoute;
  global.setDeliveryMode = setDeliveryMode;
  global.applyMapRoute = applyMapRoute;
  global.createOrder = createOrder;
  global.selectMode = selectMode;
  global.recalculatePricePreview = recalculatePricePreview;
  global.handleLocationInputChange = handleLocationInputChange;
  global.scrollToMapRoutes = scrollToMapRoutes;
  global.syncMapCustomerPhone = syncMapCustomerPhone;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootDeliveryMapPage);
  } else {
    bootDeliveryMapPage();
  }
})(typeof window !== "undefined" ? window : global);
