/**
 * ERVENOW — محرّك موحّد لصفحات الأقسام (مطاعم · متاجر · خدمات)
 * بحث · تصنيفات · ترتيب (الأقرب / التقييم / عروض) · عدّاد نتائج
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function displayName(store) {
    return String(store.name || store.label || "").trim();
  }

  function etaMinutesFromKm(km) {
    var n = Number(km);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.max(10, Math.round(n * 4));
  }

  function getUserGeo() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) {
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
        },
        function () {
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
      );
    });
  }

  function init(cfg) {
    if (!cfg) return;

    var container = document.getElementById(cfg.containerId || "container");
    var searchEl = document.getElementById(cfg.searchId || "storeSearch");
    var catBar = document.getElementById(cfg.catBarId || "storesCuisineBar");
    var countLine = document.getElementById(cfg.countLineId || "hubCountLine");
    var guestNote = cfg.guestNoteId ? document.getElementById(cfg.guestNoteId) : null;
    var sortBar = document.getElementById(cfg.sortBarId || "hubSortBar");

    var entityPlural = cfg.entityPlural || "نتائج";
    var ctaLabel = cfg.ctaLabel || "عرض التفاصيل";
    var defaultLogo =
      cfg.defaultLogo ||
      "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f0ebe3"/><stop offset="100%" stop-color="#e5dcd2"/></linearGradient></defs><rect fill="url(#g)" width="320" height="200"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#c9a227" font-family="sans-serif" font-size="18" font-weight="700">ERVENOW</text></svg>'
        );

    function iconSvg(kind) {
      var paths = {
        pin: '<path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
        star: '<path d="m12 3.8 2.3 4.7 5.2.8-3.8 3.7.9 5.2L12 15.8l-4.6 2.4.9-5.2-3.8-3.7 5.2-.8L12 3.8Z"/>',
      };
      return (
        '<svg class="store-meta__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">' +
        (paths[kind] || paths.star) +
        "</svg>"
      );
    }

    var categories = [];
    var allStores = [];
    var activeCategory = cfg.defaultCategory != null ? String(cfg.defaultCategory) : "";
    var activeSort = cfg.defaultSort || "rating";
    var userGeo = null;
    var geoDeniedHint = false;
    var SKELETON_COUNT = cfg.skeletonCount || 8;

    function matchesSearch(store, query) {
      var q = String(query || "").trim().toLowerCase();
      if (!q) return true;
      if (typeof cfg.matchSearch === "function") return cfg.matchSearch(store, q);
      var bits = [
        displayName(store),
        store.category_label_ar || "",
        store.category || "",
        store.type || "",
      ];
      return bits.join(" ").toLowerCase().indexOf(q) !== -1;
    }

    function categoryLabel(id) {
      if (!id) return "كل التصنيفات";
      for (var i = 0; i < categories.length; i++) {
        if (categories[i].id === id) return categories[i].label || id;
      }
      return id;
    }

    function sortLabel() {
      if (activeSort === "nearest") return "الأقرب";
      if (activeSort === "offers") return "عروض فقط";
      return "الأعلى تقييماً";
    }

    function updateCountLine(listLen) {
      if (!countLine) return;
      var line = listLen + " " + entityPlural + " — " + categoryLabel(activeCategory) + " · ترتيب: " + sortLabel();
      if (geoDeniedHint && activeSort === "nearest") {
        line += " · فعّل الموقع لترتيب بالقرب";
      } else if (activeSort === "nearest" && !userGeo) {
        line += " · بدون موقع — ترتيب افتراضي";
      }
      countLine.textContent = line;
    }

    function buildCategoryBar() {
      if (!catBar) return;
      var html =
        '<button type="button" class="stores-cuisine-chip' +
        (activeCategory === "" || activeCategory === "all" ? " is-active" : "") +
        '" data-cat="" role="tab" aria-selected="' +
        (activeCategory === "" || activeCategory === "all" ? "true" : "false") +
        '"><span class="stores-cuisine-chip__icon" aria-hidden="true">▦</span><span>الكل</span></button>';
      categories.forEach(function (c) {
        if (!c || !c.id) return;
        var on = activeCategory === c.id;
        var chipMedia = c.image
          ? '<img class="stores-cuisine-chip__img" src="' + esc(c.image) + '" alt="" loading="lazy" />'
          : '<span class="stores-cuisine-chip__icon" aria-hidden="true">' + esc(c.icon || "▫") + "</span>";
        html +=
          '<button type="button" class="stores-cuisine-chip' +
          (on ? " is-active" : "") +
          '" data-cat="' +
          esc(c.id) +
          '" role="tab" aria-selected="' +
          (on ? "true" : "false") +
          '">' +
          chipMedia +
          "<span>" +
          esc(c.label || c.id) +
          "</span></button>";
      });
      catBar.innerHTML = html;
    }

    function setCategory(catId) {
      activeCategory = catId == null ? "" : String(catId);
      if (activeCategory === "all") activeCategory = "";
      buildCategoryBar();
      if (typeof cfg.onCategoryChange === "function") cfg.onCategoryChange(activeCategory || "all");
      load();
    }

    function renderSkeleton() {
      if (!container) return;
      container.className = "stores-grid stores-grid--skeleton";
      container.setAttribute("aria-busy", "true");
      var html = "";
      for (var i = 0; i < SKELETON_COUNT; i++) {
        html +=
          '<div class="store-skel"><div class="store-skel__banner"></div><div class="store-skel__body">' +
          '<div class="store-skel__line"></div><div class="store-skel__line store-skel__line--short"></div>' +
          '<div class="store-skel__line"></div><div class="store-skel__line store-skel__line--btn"></div></div></div>';
      }
      container.innerHTML = html;
    }

    function renderEmptyBlock(kind, detail) {
      if (!container) return;
      container.className = "stores-grid";
      container.removeAttribute("aria-busy");
      var body = "";
      if (kind === "error") {
        body =
          '<div class="stores-empty" role="alert"><div class="stores-empty__icon" aria-hidden="true">📡</div>' +
          "<h2>تعذر التحميل</h2><p>" +
          esc(detail || "تحقق من الشبكة أو أعد المحاولة.") +
          '</p><div class="stores-empty__actions"><button type="button" class="btn btn-primary" id="hubBtnRetry">إعادة المحاولة</button>' +
          '<a class="btn btn-ghost" href="/">الرئيسية</a></div></div>';
      } else if (kind === "none") {
        body =
          '<div class="stores-empty" role="status"><div class="stores-empty__icon" aria-hidden="true">🏪</div>' +
          "<h2>" +
          esc(cfg.emptyNoneTitle || "لا نتائج بعد") +
          "</h2><p>" +
          esc(cfg.emptyNoneBody || "لم نجد عناصر مطابقة للعرض الحالي.") +
          '</p><div class="stores-empty__actions"><a class="btn btn-primary" href="/">الصفحة الرئيسية</a></div></div>';
      } else {
        body =
          '<div class="stores-empty" role="status"><div class="stores-empty__icon" aria-hidden="true">🔎</div>' +
          "<h2>لا نتائج</h2><p>جرّب «الكل» أو غيّر الترتيب أو امسح البحث.</p>" +
          '<div class="stores-empty__actions"><button type="button" class="btn btn-primary" id="hubBtnClear">مسح البحث</button></div></div>';
      }
      container.innerHTML = body;
      var retry = document.getElementById("hubBtnRetry");
      if (retry) retry.addEventListener("click", load);
      var clearBtn = document.getElementById("hubBtnClear");
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          if (searchEl) searchEl.value = "";
          setCategory("");
        });
      }
    }

    function applyClientFilters() {
      var q = searchEl ? searchEl.value : "";
      var cat = activeCategory;
      return allStores.filter(function (s) {
        if (!s || !s.id) return false;
        if (typeof cfg.filterStore === "function" && !cfg.filterStore(s)) return false;
        if (cat && typeof cfg.matchCategory === "function" && !cfg.matchCategory(s, cat)) return false;
        if (activeSort === "offers" && !s.has_active_offer) return false;
        return matchesSearch(s, q);
      });
    }

    function clientSort(list) {
      var copy = list.slice();
      copy.sort(function (a, b) {
        if (activeSort === "rating") {
          var ra = Number(b.average_rating) || 0;
          var rb = Number(a.average_rating) || 0;
          if (ra !== rb) return ra - rb;
        }
        if (activeSort === "offers") {
          if (a.has_active_offer !== b.has_active_offer) return a.has_active_offer ? -1 : 1;
        }
        if (activeSort === "nearest" && userGeo) {
          var da = Number(a.distance_km);
          var db = Number(b.distance_km);
          if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
        }
        return (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
      });
      return copy;
    }

    function openStore(id) {
      if (typeof cfg.onOpenStore === "function") {
        var store = null;
        for (var i = 0; i < allStores.length; i++) {
          if (String(allStores[i].id) === String(id)) {
            store = allStores[i];
            break;
          }
        }
        cfg.onOpenStore(id, store);
        return;
      }
      window.location.href = "/store.html?id=" + encodeURIComponent(id);
    }

    function renderList() {
      if (!container) return;
      var list = clientSort(applyClientFilters());
      updateCountLine(list.length);
      container.className = "stores-grid";
      container.removeAttribute("aria-busy");
      container.innerHTML = "";

      if (!list.length) {
        renderEmptyBlock(allStores.length ? "filtered" : "none");
        return;
      }

      list.forEach(function (store) {
        var name = displayName(store) || entityPlural;
        var act = store.category_label_ar || store.type || "";
        var km =
          store.distance_km != null && Number.isFinite(Number(store.distance_km))
            ? Number(store.distance_km)
            : null;
        var metaHtml = "";
        if (km != null) {
          var eta = etaMinutesFromKm(km);
          metaHtml =
            '<div class="store-meta"><span>' +
            iconSvg("pin") +
            " " +
            esc(km.toFixed(1)) +
            ' كم</span><span class="store-meta__dot" aria-hidden="true">·</span><span>' +
            iconSvg("clock") +
            " نحو " +
            esc(String(eta)) +
            " د</span></div>";
        } else if (activeSort === "nearest") {
          metaHtml =
            '<div class="store-meta is-muted"><span>فعّل الموقع لعرض المسافة</span></div>';
        }

        var rating =
          store.average_rating != null && Number(store.average_rating) > 0
            ? "<span>" + iconSvg("star") + " " + esc(String(Number(store.average_rating).toFixed(1))) + "</span>"
            : "";

        var logo = store.logo_url || defaultLogo;
        var card = document.createElement("article");
        card.className = "store-card";
        card.setAttribute("data-store-id", String(store.id));
        card.innerHTML =
          '<div class="store-card__media">' +
          (store.has_active_offer ? '<span class="erv-section-hub__offer-badge">عرض</span>' : "") +
          '<img class="store-logo" src="' +
          esc(logo) +
          '" alt="" loading="lazy" decoding="async" />' +
          '</div><div class="store-info"><h3>' +
          esc(name) +
          '</h3><p class="store-type">' +
          esc(act) +
          "</p>" +
          (rating ? '<div class="store-meta">' + rating + "</div>" : "") +
          metaHtml +
          '<div class="store-card__cta"><button type="button" class="store-card__btn">' +
          esc(ctaLabel) +
          "</button></div></div>";

        var img = card.querySelector(".store-logo");
        if (img) {
          img.addEventListener("error", function () {
            img.src = defaultLogo;
          });
        }
        var btn = card.querySelector(".store-card__btn");
        if (btn) btn.addEventListener("click", function () {
          openStore(store.id);
        });
        container.appendChild(card);
      });
    }

    function buildApiQuery() {
      var parts = [];
      if (userGeo) {
        parts.push("user_lat=" + encodeURIComponent(userGeo.lat));
        parts.push("user_lng=" + encodeURIComponent(userGeo.lng));
      }
      if (typeof cfg.buildApiParams === "function") {
        var extra = cfg.buildApiParams(activeCategory, activeSort) || [];
        if (extra.length) parts = parts.concat(extra);
      }
      if (activeSort === "rating") parts.push("sort=rating");
      else if (activeSort === "offers") parts.push("sort=offers", "offers_only=1");
      return parts.length ? "?" + parts.join("&") : "";
    }

    async function load() {
      renderSkeleton();
      geoDeniedHint = false;
      if (searchEl) searchEl.disabled = true;

      if (activeSort === "nearest" && !userGeo) {
        var geo = await getUserGeo();
        if (geo) userGeo = geo;
        else geoDeniedHint = true;
      }

      try {
        var headers = {};
        var tok = global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken();
        if (tok) headers.Authorization = "Bearer " + tok;

        var url = (global.PlatformAPI && PlatformAPI.apiUrl ? PlatformAPI.apiUrl : function (p) {
          return p;
        })("/api/stores" + buildApiQuery());

        var res = await fetch(url, { headers: headers });
        var data = await res.json().catch(function () {
          return {};
        });

        if (!res.ok || data.ok === false) {
          if (searchEl) searchEl.disabled = false;
          renderEmptyBlock("error", data.error || "الخادم لم يرد بشكل صحيح.");
          updateCountLine(0);
          return;
        }

        if (guestNote && data.browse_masked) guestNote.style.display = "block";
        allStores = Array.isArray(data.stores) ? data.stores : [];

        if (activeCategory && data.category_applied === null && typeof cfg.matchCategory === "function") {
          allStores = allStores.filter(function (s) {
            return cfg.matchCategory(s, activeCategory);
          });
        }

        if (searchEl) searchEl.disabled = false;
        if (typeof cfg.onAfterLoad === "function") cfg.onAfterLoad(allStores, activeCategory);

        if (!allStores.length) {
          renderEmptyBlock("none");
          updateCountLine(0);
          return;
        }

        renderList();
      } catch (err) {
        if (searchEl) searchEl.disabled = false;
        renderEmptyBlock("error", "تعذر إكمال الطلب. تحقق من الاتصال.");
        updateCountLine(0);
      }
    }

    function setSort(mode) {
      activeSort = mode || "rating";
      if (sortBar) {
        sortBar.querySelectorAll(".erv-section-hub__sort-btn").forEach(function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-sort") === activeSort);
        });
      }
      if (activeSort !== "nearest") {
        userGeo = null;
        geoDeniedHint = false;
      }
      load();
    }

    function applyUrlParams() {
      var p = new URLSearchParams(location.search);
      var catKey = cfg.urlCategoryKey || "category";
      var typeKey = cfg.urlTypeKey || "type";
      var fromCat = String(p.get(catKey) || "").trim().toLowerCase();
      var fromType = String(p.get(typeKey) || "").trim().toLowerCase();
      if (fromType === "minimarket") fromType = "supermarket";
      if (fromCat) activeCategory = fromCat;
      else if (fromType && fromType !== "all") activeCategory = fromType;
      if (typeof cfg.onUrlParams === "function") cfg.onUrlParams(p, { setCategory: setCategory });
    }

    if (searchEl) {
      if (cfg.searchPlaceholder) searchEl.placeholder = cfg.searchPlaceholder;
      searchEl.disabled = false;
      searchEl.addEventListener("input", function () {
        if (allStores.length) renderList();
      });
    }

    if (catBar) {
      catBar.addEventListener("click", function (e) {
        var btn = e.target.closest(".stores-cuisine-chip");
        if (!btn) return;
        setCategory(btn.getAttribute("data-cat") || "");
      });
    }

    if (sortBar) {
      sortBar.querySelectorAll(".erv-section-hub__sort-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setSort(btn.getAttribute("data-sort") || "rating");
        });
      });
    }

    function boot(cats) {
      categories = Array.isArray(cats) ? cats.filter(function (c) {
        return c && c.id;
      }) : [];
      buildCategoryBar();
      applyUrlParams();
      buildCategoryBar();
      if (sortBar) {
        sortBar.querySelectorAll(".erv-section-hub__sort-btn").forEach(function (b) {
          b.classList.toggle("is-active", b.getAttribute("data-sort") === activeSort);
        });
      }
      if (typeof cfg.onCategoryChange === "function") {
        cfg.onCategoryChange(activeCategory || "all");
      }
      load();
    }

    var catPromise = Promise.resolve([]);
    if (typeof cfg.loadCategories === "function") catPromise = cfg.loadCategories();
    else if (Array.isArray(cfg.categories)) catPromise = Promise.resolve(cfg.categories);

    catPromise.then(boot).catch(function () {
      boot([]);
    });

    return { reload: load, setCategory: setCategory, setSort: setSort };
  }

  global.ErvenowSectionHub = { init: init };
})(typeof window !== "undefined" ? window : global);
