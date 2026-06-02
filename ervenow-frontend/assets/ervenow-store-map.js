/**
 * ERVENOW — خريطة تحديد موقع المتجر (مع عرض المتاجر المعتمدة + نطاق التوصيل)
 */
(function (global) {
  "use strict";

  var DEFAULT_CENTER = [24.7136, 46.6753];
  var DEFAULT_ZOOM = 11;

  function apiUrl(path) {
    if (global.PlatformAPI && typeof global.PlatformAPI.apiUrl === "function") {
      return global.PlatformAPI.apiUrl(path);
    }
    return path;
  }

  function storePinIcon() {
    return L.divIcon({
      className: "erv-store-map__pin erv-store-map__pin--new",
      html: "<span aria-hidden=\"true\"></span>",
      iconSize: [28, 36],
      iconAnchor: [14, 34],
    });
  }

  function existingStoreIcon() {
    return L.divIcon({
      className: "erv-store-map__pin erv-store-map__pin--existing",
      html: "<span aria-hidden=\"true\"></span>",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function parseRadiusKm(selectEl) {
    if (!selectEl) return 5;
    var n = Number(selectEl.value);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  function ErvenowStoreMap(options) {
    this.opts = options || {};
    this.map = null;
    this.marker = null;
    this.radiusCircle = null;
    this.hasLocation = false;
    this.contextLayer = L.layerGroup();
    this.nameInput = null;
    this._init();
  }

  ErvenowStoreMap.prototype._init = function () {
    var self = this;
    var mapId = this.opts.mapId || "map";
    var el = document.getElementById(mapId);
    if (!el || typeof L === "undefined") return;

    this.latInput = this.opts.latInput;
    this.lngInput = this.opts.lngInput;
    this.addressInput = this.opts.addressInput;
    this.statusEl = this.opts.statusEl;
    this.radiusSelect = this.opts.radiusSelectId
      ? document.getElementById(this.opts.radiusSelectId)
      : null;
    this.nameInput = this.opts.nameInputId ? document.getElementById(this.opts.nameInputId) : null;

    if (this.latInput) this.latInput.value = "";
    if (this.lngInput) this.lngInput.value = "";
    this._setStatus("انقر على الخريطة أو اسحب الدبوس الذهبي لتحديد موقع متجرك.", false);

    this.map = L.map(mapId, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(this.map);

    this.contextLayer.addTo(this.map);

    this.marker = L.marker(DEFAULT_CENTER, {
      draggable: true,
      icon: storePinIcon(),
      opacity: 0,
      interactive: false,
    }).addTo(this.map);

    this.map.on("click", function (e) {
      self.placeAt(e.latlng.lat, e.latlng.lng, true);
    });

    this.marker.on("dragend", function () {
      var p = self.marker.getLatLng();
      self.placeAt(p.lat, p.lng, true);
    });

    if (this.radiusSelect) {
      this.radiusSelect.addEventListener("change", function () {
        self._updateRadiusCircle();
      });
    }
    if (this.nameInput) {
      this.nameInput.addEventListener("input", function () {
        self._syncStorePinLabel();
      });
    }

    var myBtn = this.opts.myLocationBtnId
      ? document.getElementById(this.opts.myLocationBtnId)
      : null;
    if (myBtn) {
      myBtn.addEventListener("click", function () {
        self.useMyLocation();
      });
    }

    var searchBtn = this.opts.searchBtnId
      ? document.getElementById(this.opts.searchBtnId)
      : null;
    var searchInput = this.opts.searchInputId
      ? document.getElementById(this.opts.searchInputId)
      : null;
    if (searchBtn && searchInput) {
      searchBtn.addEventListener("click", function () {
        self.searchAddress(searchInput.value);
      });
      searchInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          self.searchAddress(searchInput.value);
        }
      });
    }

    setTimeout(function () {
      if (self.map) self.map.invalidateSize();
    }, 200);
    setTimeout(function () {
      if (self.map) self.map.invalidateSize();
    }, 600);

    this._loadContextStores();
    this._tryCenterOnUser(false);
  };

  ErvenowStoreMap.prototype._setStatus = function (text, ok) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("is-ok", !!ok);
    this.statusEl.classList.toggle("is-pending", !ok);
  };

  ErvenowStoreMap.prototype._updateRadiusCircle = function () {
    if (!this.map || !this.hasLocation) return;
    var lat = Number(this.latInput && this.latInput.value);
    var lng = Number(this.lngInput && this.lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    var km = parseRadiusKm(this.radiusSelect);
    var meters = km * 1000;
    if (this.radiusCircle) {
      this.radiusCircle.setLatLng([lat, lng]);
      this.radiusCircle.setRadius(meters);
      return;
    }
    this.radiusCircle = L.circle([lat, lng], {
      radius: meters,
      color: "#b9872f",
      weight: 2,
      fillColor: "#b9872f",
      fillOpacity: 0.12,
      dashArray: "6 4",
    }).addTo(this.map);
  };

  ErvenowStoreMap.prototype.placeAt = function (lat, lng, reverseLookup) {
    if (!this.map || !this.marker) return;
    this.hasLocation = true;
    if (this.latInput) this.latInput.value = String(lat);
    if (this.lngInput) this.lngInput.value = String(lng);
    this.marker.setLatLng([lat, lng]);
    this.marker.setOpacity(1);
    this.marker.setInteractive(true);
    this._syncStorePinLabel();
    this._setStatus("تم تحديد موقع متجرك — الدائرة تمثل نطاق التوصيل.", true);
    this._updateRadiusCircle();
    this.map.panTo([lat, lng], { animate: true });
    if (this.map.getZoom() < 14) this.map.setZoom(14);
    if (reverseLookup) this._reverseGeocode(lat, lng);
    if (typeof this.opts.onPlace === "function") {
      this.opts.onPlace(lat, lng);
    }
  };

  ErvenowStoreMap.prototype._syncStorePinLabel = function () {
    if (!this.marker) return;
    var storeName = this.nameInput ? String(this.nameInput.value || "").trim() : "";
    var label = storeName || "متجر جديد";
    this.marker.bindTooltip(label, {
      direction: "top",
      offset: [0, -28],
      opacity: 0.96,
      permanent: true,
    });
  };

  ErvenowStoreMap.prototype._reverseGeocode = function (lat, lng) {
    var addrEl = this.addressInput;
    if (!addrEl) return;
    var url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lng) +
      "&accept-language=ar";
    fetch(url, { headers: { Accept: "application/json", "Accept-Language": "ar" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var d = j && j.display_name ? String(j.display_name).trim() : "";
        if (d && (!addrEl.value || addrEl.value.length < 8)) addrEl.value = d;
      })
      .catch(function () {});
  };

  ErvenowStoreMap.prototype.useMyLocation = function () {
    var self = this;
    if (!navigator.geolocation) {
      self._setStatus("المتصفح لا يدعم تحديد الموقع.", false);
      return;
    }
    self._setStatus("جارٍ تحديد موقعك…", false);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        self.placeAt(pos.coords.latitude, pos.coords.longitude, true);
      },
      function () {
        self._setStatus("تعذر الحصول على موقعك — فعّل أذونات الموقع أو حدد يدوياً على الخريطة.", false);
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
    );
  };

  ErvenowStoreMap.prototype.searchAddress = function (q) {
    var self = this;
    var query = String(q || "").trim();
    if (query.length < 3) {
      self._setStatus("اكتب عنواناً أو حياً للبحث (3 أحرف على الأقل).", false);
      return;
    }
    self._setStatus("جارٍ البحث عن العنوان…", false);
    var url =
      "https://nominatim.openstreetmap.org/search?format=json&q=" +
      encodeURIComponent(query) +
      "&countrycodes=sa&limit=1&accept-language=ar";
    fetch(url, { headers: { Accept: "application/json", "Accept-Language": "ar" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (list) {
        if (!list || !list[0]) {
          self._setStatus("لم يُعثر على العنوان — جرّب وصفاً أدق أو حدد على الخريطة.", false);
          return;
        }
        var hit = list[0];
        self.placeAt(Number(hit.lat), Number(hit.lon), false);
        if (self.addressInput && !self.addressInput.value) {
          self.addressInput.value = String(hit.display_name || query).trim();
        }
      })
      .catch(function () {
        self._setStatus("تعذر البحث — حدد الموقع بالنقر على الخريطة.", false);
      });
  };

  ErvenowStoreMap.prototype._tryCenterOnUser = function (placeMarker) {
    var self = this;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        if (self.map) self.map.setView([lat, lng], 13);
        if (placeMarker) self.placeAt(lat, lng, true);
      },
      function () {},
      { enableHighAccuracy: false, maximumAge: 120000, timeout: 12000 }
    );
  };

  ErvenowStoreMap.prototype._loadContextStores = function () {
    var self = this;
    fetch(apiUrl("/api/store/register-map-context"), { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var list = j && Array.isArray(j.stores) ? j.stores : [];
        list.forEach(function (s) {
          var lat = Number(s.lat);
          var lng = Number(s.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          L.marker([lat, lng], {
            icon: existingStoreIcon(),
            interactive: false,
            keyboard: false,
          })
            .bindTooltip("متجر معتمد على ERVENOW", { direction: "top", opacity: 0.9 })
            .addTo(self.contextLayer);
        });
      })
      .catch(function () {});
  };

  ErvenowStoreMap.prototype.hasCoords = function () {
    var lat = this.latInput && this.latInput.value.trim();
    var lng = this.lngInput && this.lngInput.value.trim();
    return !!(lat && lng && this.hasLocation);
  };

  global.ErvenowStoreMap = {
    create: function (options) {
      return new ErvenowStoreMap(options);
    },
  };
})(typeof window !== "undefined" ? window : global);
