/**
 * ERVENOW — Desktop marketplace homepage behaviors
 * Search → /restaurants?q= (real section-hub search)
 * Location → geolocation + localStorage
 * Discovery grids → /api/stores (real data only)
 */
(function () {
  "use strict";

  var GEO_KEY = "ervenow_home_geo";

  function isDesktopMp() {
    try {
      return (
        !document.documentElement.classList.contains("erv-mobile-shell") &&
        window.matchMedia("(min-width: 1025px)").matches
      );
    } catch (e) {
      return false;
    }
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function apiUrl(path) {
    if (window.PlatformAPI && typeof PlatformAPI.apiUrl === "function") {
      return PlatformAPI.apiUrl(path);
    }
    return path;
  }

  function readGeo() {
    try {
      var raw = localStorage.getItem(GEO_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !Number.isFinite(Number(o.lat)) || !Number.isFinite(Number(o.lng))) return null;
      return { lat: Number(o.lat), lng: Number(o.lng) };
    } catch (e) {
      return null;
    }
  }

  function writeGeo(lat, lng) {
    try {
      localStorage.setItem(
        GEO_KEY,
        JSON.stringify({ lat: lat, lng: lng, at: Date.now() })
      );
    } catch (e) {}
  }

  function setLocateLabels(text) {
    document.querySelectorAll("[data-erv-mp-locate-label]").forEach(function (el) {
      el.textContent = text;
    });
  }

  function bindSearchForms() {
    document.querySelectorAll("[data-erv-mp-search]").forEach(function (form) {
      function go() {
        var input = form.querySelector('input[type="search"], input[name="q"]');
        var q = input ? String(input.value || "").trim() : "";
        if (q) {
          window.location.href = "/restaurants?q=" + encodeURIComponent(q);
        } else {
          window.location.href = "/restaurants";
        }
      }
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        go();
      });
      var ic = form.querySelector(".erv-mp-header-search__ic, .erv-mp-hero-search__ic");
      if (ic) {
        ic.style.cursor = "pointer";
        ic.addEventListener("click", function () {
          go();
        });
      }
    });
  }

  function requestLocation(btn) {
    if (!navigator.geolocation) {
      setLocateLabels("الموقع غير مدعوم");
      return;
    }
    if (btn) btn.disabled = true;
    setLocateLabels("جاري التحديد…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        writeGeo(pos.coords.latitude, pos.coords.longitude);
        setLocateLabels("تم تحديد موقعك");
        if (btn) btn.disabled = false;
        loadDiscovery();
      },
      function () {
        setLocateLabels("تعذر تحديد الموقع");
        if (btn) btn.disabled = false;
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  function bindLocateButtons() {
    document.querySelectorAll("[data-erv-mp-locate]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        requestLocation(btn);
      });
    });
    var geo = readGeo();
    if (geo) setLocateLabels("موقعك محفوظ");
  }

  function syncOrdersBadge() {
    var src = document.getElementById("ordersBadge");
    var dest = document.getElementById("ervMpOrdersBadge");
    if (!src || !dest) return;
    function copy() {
      dest.textContent = src.textContent || "0";
    }
    copy();
    try {
      var mo = new MutationObserver(copy);
      mo.observe(src, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
  }

  function defaultCover() {
    return (
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e8f6ef"/><text x="50%" y="52%" text-anchor="middle" fill="#146c43" font-family="Tajawal,Cairo,sans-serif" font-size="28" font-weight="700">ERVENOW</text></svg>'
      )
    );
  }

  function isStoreOpen(store) {
    if (!store) return false;
    if (store.is_open === true || store.open === true) return true;
    var st = String(store.status || store.open_status || "").toLowerCase();
    return st === "open" || st === "opened" || st === "مفتوح";
  }

  function storeCardHtml(store) {
    var name = String(store.name || store.label || "متجر").trim();
    var type = String(store.category_label_ar || store.type || "").trim();
    var logo = store.logo_url || defaultCover();
    var cover = store.cover_url || store.banner_url || logo || defaultCover();
    var rating =
      store.average_rating != null && Number(store.average_rating) > 0
        ? Number(store.average_rating).toFixed(1)
        : "";
    var km =
      store.distance_km != null && Number.isFinite(Number(store.distance_km))
        ? Number(store.distance_km).toFixed(1)
        : "";
    var eta = "";
    if (km) {
      eta = String(Math.max(10, Math.round(Number(km) * 4)));
    }
    var fee =
      store.delivery_fee != null && Number.isFinite(Number(store.delivery_fee))
        ? Number(store.delivery_fee)
        : store.delivery_price != null && Number.isFinite(Number(store.delivery_price))
          ? Number(store.delivery_price)
          : null;
    var meta = "";
    if (rating) meta += "<span>★ " + esc(rating) + "</span>";
    if (eta) meta += "<span>~" + esc(eta) + " د</span>";
    if (fee != null) meta += "<span>" + esc(String(fee)) + " ر.س</span>";
    else if (km) meta += "<span>" + esc(km) + " كم</span>";

    var openBadge = isStoreOpen(store)
      ? '<span class="erv-mp-store__badge">مفتوح</span>'
      : "";

    return (
      '<a class="erv-mp-store" href="/store.html?id=' +
      encodeURIComponent(String(store.id)) +
      '">' +
      '<div class="erv-mp-store__media">' +
      openBadge +
      '<img class="erv-mp-store__cover" src="' +
      esc(cover) +
      '" alt="" loading="lazy" decoding="async" />' +
      '<img class="erv-mp-store__logo" src="' +
      esc(logo) +
      '" alt="" loading="lazy" decoding="async" />' +
      "</div>" +
      '<div class="erv-mp-store__body">' +
      '<h3 class="erv-mp-store__name">' +
      esc(name) +
      "</h3>" +
      (type ? '<p class="erv-mp-store__type">' + esc(type) + "</p>" : "") +
      (meta ? '<div class="erv-mp-store__meta">' + meta + "</div>" : "") +
      "</div></a>"
    );
  }

  function productCardHtml(product, storeId) {
    var name = String(product.name || product.title || "منتج").trim();
    var price =
      product.price != null && Number.isFinite(Number(product.price))
        ? Number(product.price)
        : product.sale_price != null && Number.isFinite(Number(product.sale_price))
          ? Number(product.sale_price)
          : null;
    var img = product.image_url || product.photo_url || product.image || defaultCover();
    var href = storeId
      ? "/store.html?id=" + encodeURIComponent(String(storeId))
      : "/restaurants";

    return (
      '<a class="erv-mp-product" href="' +
      href +
      '">' +
      '<div class="erv-mp-product__media"><img src="' +
      esc(img) +
      '" alt="" loading="lazy" decoding="async" /></div>' +
      '<div class="erv-mp-product__body">' +
      '<h3 class="erv-mp-product__name">' +
      esc(name) +
      "</h3>" +
      '<div class="erv-mp-product__row">' +
      (price != null
        ? '<span class="erv-mp-product__price">' + esc(String(price)) + " ر.س</span>"
        : "<span></span>") +
      '<span class="erv-mp-product__add" aria-hidden="true">+</span>' +
      "</div></div></a>"
    );
  }

  function renderGrid(el, list) {
    if (!el) return;
    el.innerHTML = list.map(storeCardHtml).join("");
    el.querySelectorAll("img").forEach(function (img) {
      img.addEventListener("error", function () {
        img.src = defaultCover();
      });
    });
  }

  function showSection(sectionEl, gridEl, list) {
    if (!sectionEl || !gridEl) return;
    if (!list.length) {
      sectionEl.hidden = true;
      gridEl.innerHTML = "";
      return;
    }
    sectionEl.hidden = false;
    renderGrid(gridEl, list.slice(0, 8));
  }

  async function fetchStores(query) {
    var headers = {};
    try {
      var tok = window.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken();
      if (tok) headers.Authorization = "Bearer " + tok;
    } catch (e) {}
    var res = await fetch(apiUrl("/api/stores" + (query || "")), { headers: headers });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.ok === false) return [];
    return Array.isArray(data.stores) ? data.stores : [];
  }

  async function fetchProducts(storeId) {
    if (!storeId) return [];
    try {
      var headers = {};
      var tok = window.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken();
      if (tok) headers.Authorization = "Bearer " + tok;
      var res = await fetch(
        apiUrl("/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=10&offset=0"),
        { headers: headers }
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) return [];
      var list = data.products || data.items || data.data || [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  var discoveryGen = 0;
  var discoveryTimer = null;

  function scheduleDiscovery(delay) {
    clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(function () {
      loadDiscovery();
    }, typeof delay === "number" ? delay : 50);
  }

  async function loadDiscovery() {
    if (!isDesktopMp()) return;

    var gen = ++discoveryGen;
    var nearbySection = document.getElementById("ervMpNearbySection");
    var nearbyGrid = document.getElementById("ervMpNearbyGrid");
    var restaurantsSection = document.getElementById("ervMpRestaurantsSection");
    var restaurantsGrid = document.getElementById("ervMpRestaurantsGrid");
    var storesSection = document.getElementById("ervMpStoresSection");
    var storesGrid = document.getElementById("ervMpStoresGrid");
    var productsSection = document.getElementById("ervMpProductsSection");
    var productsGrid = document.getElementById("ervMpProductsGrid");
    var discover = document.getElementById("ervMpDiscover");

    if (discover) discover.hidden = false;

    var geo = readGeo();
    var geoQs = "";
    if (geo) {
      geoQs =
        "&user_lat=" +
        encodeURIComponent(geo.lat) +
        "&user_lng=" +
        encodeURIComponent(geo.lng);
    }

    try {
      var all = await fetchStores("?sort=rating" + geoQs);
      if (gen !== discoveryGen) return;

      var restaurants = all.filter(function (s) {
        return String(s.type || "").toLowerCase() === "restaurant";
      });
      var stores = all.filter(function (s) {
        return String(s.type || "").toLowerCase() !== "restaurant";
      });

      if (!restaurants.length) {
        restaurants = await fetchStores("?type=restaurant&sort=rating" + geoQs);
        if (gen !== discoveryGen) return;
      }

      var nearby = all.length ? all : restaurants.concat(stores);
      showSection(nearbySection, nearbyGrid, nearby);
      showSection(
        restaurantsSection,
        restaurantsGrid,
        restaurants.length && nearby.length ? [] : restaurants
      );
      showSection(
        storesSection,
        storesGrid,
        stores.length && nearby.length >= stores.length ? [] : stores
      );

      if (nearby.length) {
        if (restaurantsSection) restaurantsSection.hidden = true;
        if (storesSection) storesSection.hidden = true;
      }

      if (productsSection && productsGrid) {
        var first = nearby[0] || restaurants[0];
        var products = first ? await fetchProducts(first.id) : [];
        // Products are expensive — apply even if a newer layout pin started,
        // unless a newer discovery already painted products.
        if (products.length && (gen === discoveryGen || !productsGrid.children.length)) {
          productsSection.hidden = false;
          productsGrid.innerHTML = products
            .slice(0, 10)
            .map(function (p) {
              return productCardHtml(p, first && first.id);
            })
            .join("");
          productsGrid.querySelectorAll("img").forEach(function (img) {
            img.addEventListener("error", function () {
              img.src = defaultCover();
            });
          });
        } else if (!products.length && !productsGrid.children.length && gen === discoveryGen) {
          productsSection.hidden = true;
          productsGrid.innerHTML = "";
        }
      }
    } catch (e) {
      if (nearbyGrid && !nearbyGrid.children.length && nearbySection) {
        nearbySection.hidden = true;
      }
      if (productsGrid && !productsGrid.children.length && productsSection) {
        productsSection.hidden = true;
      }
    }
  }

  function watchBannerVisual() {
    var visual = document.getElementById("ervMpHeroVisual");
    var banner = document.getElementById("homeMainBanner");
    if (!visual || !banner) return;

    function sync() {
      var empty = banner.hasAttribute("hidden") || banner.hidden;
      visual.classList.toggle("is-empty", empty);
    }

    sync();
    try {
      var mo = new MutationObserver(sync);
      mo.observe(banner, { attributes: true, attributeFilter: ["hidden", "class"] });
    } catch (e) {}
  }

  function placeStatsStrip() {
    var stats = document.getElementById("stats");
    var why = document.getElementById("why");
    if (!stats || !why) return;
    if (stats.previousElementSibling !== why) {
      why.insertAdjacentElement("afterend", stats);
    }
  }

  function ensurePreregHeaderOrder() {
    var body = document.body;
    var prereg = document.getElementById("ervPreRegBanner");
    var header = document.getElementById("top") || document.querySelector(".lp-header");
    if (!header || !body) return;
    /* دائماً: شريط التسجيل أولاً ثم الهيدر مباشرة — حتى لو كان الشريط أول عنصر مسبقاً */
    if (prereg) {
      if (body.firstElementChild !== prereg) {
        body.insertBefore(prereg, body.firstElementChild);
      }
      if (prereg.nextElementSibling !== header) {
        body.insertBefore(header, prereg.nextSibling);
      }
    } else if (body.firstElementChild !== header) {
      body.insertBefore(header, body.firstElementChild);
    }
    if (global.ErvenowPreRegBanner && typeof global.ErvenowPreRegBanner.measure === "function") {
      global.ErvenowPreRegBanner.measure();
    }
  }

  function pinTopChrome() {
    var body = document.body;
    if (!body) return;
    var prereg = document.getElementById("ervPreRegBanner");
    var header = document.getElementById("top") || document.querySelector(".lp-header");
    var stage = document.querySelector(".erv-mp-stage");
    ensurePreregHeaderOrder();
    if (header && stage && header.nextElementSibling !== stage) {
      body.insertBefore(stage, header.nextSibling);
    }
    ensurePreregHeaderOrder();
  }

  var topChromeMo = null;
  var topChromeMoTimer = null;
  function watchTopChrome(ms) {
    pinTopChrome();
    if (topChromeMo || !document.body) return;
    try {
      topChromeMo = new MutationObserver(function () {
        if (topChromeMoTimer) return;
        topChromeMoTimer = setTimeout(function () {
          topChromeMoTimer = null;
          pinTopChrome();
        }, 40);
      });
      topChromeMo.observe(document.body, { childList: true });
      setTimeout(function () {
        if (topChromeMo) {
          topChromeMo.disconnect();
          topChromeMo = null;
        }
      }, ms || 8000);
    } catch (e) {}
  }

  function pinMarketplaceLayout() {
    var body = document.body;
    if (!body) return;

    var visual = document.getElementById("ervMpHeroVisual");
    var bannerWrap = document.getElementById("homeMainBannerWrap");
    if (visual && bannerWrap && bannerWrap.parentElement !== visual) {
      var tiles = document.getElementById("ervMpTiles");
      if (tiles && tiles.parentElement === visual) {
        visual.insertBefore(bannerWrap, tiles);
      } else {
        visual.insertBefore(bannerWrap, visual.firstChild);
      }
    }

    placeStatsStrip();
    pinTopChrome();

    if (!isDesktopMp()) {
      watchBannerVisual();
      return;
    }

    var prereg = document.getElementById("ervPreRegBanner");
    var header = document.getElementById("top");
    var stage = document.querySelector(".erv-mp-stage");
    var hub = document.querySelector(".sn-section--hub");
    var discover = document.getElementById("ervMpDiscover");
    var main = document.querySelector("main[data-marketing-region='main'], main");
    var footer = document.querySelector(".lp-footer");

    var sequence = [prereg, header, stage, hub, discover, main, footer].filter(Boolean);
    if (sequence.length) {
      body.insertBefore(sequence[0], body.firstChild);
      for (var i = 1; i < sequence.length; i++) {
        body.insertBefore(sequence[i], sequence[i - 1].nextSibling);
      }
    }

    pinTopChrome();
    placeStatsStrip();
    watchBannerVisual();
  }

  function refreshMp() {
    pinMarketplaceLayout();
    if (isDesktopMp()) scheduleDiscovery(80);
  }

  async function hydrateStatsStrip() {
    var el = document.querySelector('[data-erv-mp-stat="stores"]');
    if (!el) return;
    try {
      var stores = await fetchStores("?limit=200");
      var n = Array.isArray(stores) ? stores.length : 0;
      if (n > 0) {
        var shown = Math.max(n, Number(el.getAttribute("data-target")) || n);
        // Prefer live count when real data exceeds placeholder floor
        if (n >= 3) {
          el.setAttribute("data-target", String(n));
          if (!el.classList.contains("js-count-ran")) {
            el.textContent = n + "+";
          }
        } else if (shown) {
          el.textContent = shown + "+";
        }
      }
    } catch (e) {}
  }

  function boot() {
    bindSearchForms();
    bindLocateButtons();
    syncOrdersBadge();
    watchBannerVisual();
    hydrateStatsStrip();
    refreshMp();
    watchTopChrome(10000);

    window.addEventListener("ervenow:marketing-applied", function () {
      refreshMp();
      watchTopChrome(6000);
    });

    // One delayed settle pass after marketing/shell may finish
    setTimeout(refreshMp, 900);
    setTimeout(pinTopChrome, 1400);
    setTimeout(pinTopChrome, 2400);

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        refreshMp();
        pinTopChrome();
      }, 250);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
