/**
 * ERVENOW Banner Engine V2 — جلب البنرات حسب الهدف + عرض + إحصائيات
 */
(function () {
  var CAROUSEL_MS = 5500;
  var CARD_ROTATE_MS = 7000;
  var trackedImpressions = Object.create(null);

  var PATH_TO_TARGET = {
    "/": "home",
    "/index.html": "home",
    "/dashboard": "visitor_dashboard",
    "/restaurants": "restaurants",
    "/stores": "stores",
    "/services": "services",
    "/delivery-services.html": "delivery",
    "/delivery-services": "delivery",
    "/driver-app": "driver_dashboard",
    "/store-dashboard": "store_dashboard",
    "/provider-dashboard": "service_provider_dashboard",
    "/live-map": "live_map",
    "/my-orders": "orders_page",
    "/wallet": "wallet_page",
    "/wallet.html": "wallet_page",
  };

  var SECTION_CAROUSEL_MOUNTS = {
    visitor_dashboard: { wrap: "ervVisitorBanner", inner: "ervVisitorBannerInner" },
    restaurants: { wrap: "ervRestaurantsBanner", inner: "ervRestaurantsBannerInner" },
    stores: { wrap: "ervStoresBanner", inner: "ervStoresBannerInner" },
    services: { wrap: "ervServicesBanner", inner: "ervServicesBannerInner" },
    delivery: { wrap: "ervDeliveryBanner", inner: "ervDeliveryBannerInner" },
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiUrl(path) {
    if (window.PlatformAPI && window.PlatformAPI.apiUrl) return window.PlatformAPI.apiUrl(path);
    return path;
  }

  function detectTarget() {
    if (window.__ERV_BANNER_TARGET__) return window.__ERV_BANNER_TARGET__;
    var p = String(location.pathname || "/").replace(/\/$/, "") || "/";
    return PATH_TO_TARGET[p] || null;
  }

  function resolveMode(banner) {
    if (banner && String(banner.image_url || "").trim()) return "carousel";
    var mode = String((banner && banner.display_mode) || "carousel").toLowerCase();
    if (mode === "strip" || mode === "carousel" || mode === "auto") return "carousel";
    return "card";
  }

  function appendBannerImage(parent, imageUrl, alt, extraClass) {
    if (!imageUrl || !parent) return null;
    var img = document.createElement("img");
    img.className = "erv-banner-media__img sn-hero-carousel__img" + (extraClass ? " " + extraClass : "");
    img.src = String(imageUrl);
    img.alt = alt || "";
    img.decoding = "async";
    img.loading = "lazy";
    parent.appendChild(img);
    return img;
  }

  function splitTitle(title) {
    var t = String(title || "").trim();
    if (!t) return { line1: "", line2: "" };
    var parts = t.split("|");
    if (parts.length >= 2) {
      return { line1: parts[0].trim(), line2: parts.slice(1).join("|").trim() };
    }
    var br = t.split(/\n|<br\s*\/?>/i);
    if (br.length >= 2) {
      return { line1: br[0].trim(), line2: br.slice(1).join(" ").trim() };
    }
    return { line1: t, line2: "" };
  }

  function titleHtml(title) {
    var parts = splitTitle(title);
    if (!parts.line1 && !parts.line2) return "";
    if (parts.line2) return esc(parts.line1) + "<br><span>" + esc(parts.line2) + "</span>";
    return esc(parts.line1);
  }

  function captionTitleHtml(title) {
    var parts = splitTitle(title);
    if (!parts.line1 && !parts.line2) return "";
    if (parts.line2) return esc(parts.line1) + " — <span>" + esc(parts.line2) + "</span>";
    return esc(parts.line1);
  }

  function actionsHtml(banner, trackClicks) {
    var html = "";
    function link(text, url, cls) {
      if (!text || !url) return "";
      var attrs = ' href="' + esc(url) + '"';
      if (trackClicks && banner.id) {
        attrs += ' data-banner-click="' + esc(banner.id) + '"';
      }
      return '<a class="' + cls + '"' + attrs + ">" + esc(text) + "</a>";
    }
    html += link(
      banner.button1_text || banner.link_label,
      banner.button1_url || banner.link_url,
      "sn-hero__cta"
    );
    html += link(banner.button2_text, banner.button2_url, "sn-hero__cta sn-hero__cta--outline");
    return html;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function recordImpression(id) {
    if (!id || trackedImpressions[id]) return;
    trackedImpressions[id] = true;
    fetch(apiUrl("/api/core/banners/" + encodeURIComponent(id) + "/impression"), {
      method: "POST",
      credentials: "same-origin",
    }).catch(function () {});
  }

  function wireClickTracking(root) {
    if (!root) return;
    root.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-banner-click]") : null;
      if (!el) return;
      var id = el.getAttribute("data-banner-click");
      if (!id) return;
      fetch(apiUrl("/api/core/banners/" + encodeURIComponent(id) + "/click"), {
        method: "POST",
        credentials: "same-origin",
      }).catch(function () {});
    });
  }

  function filterCarousel(banners) {
    return (banners || []).filter(function (b) {
      return b && resolveMode(b) === "carousel" && (String(b.image_url || "").trim() || String(b.title || "").trim());
    });
  }

  /** شرائح البنر المتحرك — صورة أو وضع carousel (لا تُعرض كبطاقة خلفية) */
  function filterMidCarousel(banners) {
    return (banners || []).filter(function (b) {
      if (!b) return false;
      if (resolveMode(b) === "strip") return false;
      if (String(b.image_url || "").trim()) return true;
      return resolveMode(b) === "carousel" && !!String(b.title || "").trim();
    });
  }

  /** بطاقة ترحيب نصية فقط — بدون صورة (الصور تذهب للشريط المتحرك) */
  function filterTextCards(banners) {
    return (banners || []).filter(function (b) {
      if (!b) return false;
      if (resolveMode(b) === "carousel" || resolveMode(b) === "strip") return false;
      if (String(b.image_url || "").trim()) return false;
      return !!String(b.title || "").trim() || !!String(b.description || "").trim();
    });
  }

  function filterCards(banners) {
    return filterTextCards(banners);
  }

  function filterStrips(banners) {
    return (banners || []).filter(function (b) {
      return b && (resolveMode(b) === "strip" || resolveMode(b) === "carousel") && (String(b.title || "").trim() || String(b.image_url || "").trim());
    });
  }

  /** شرائح افتراضية هادئة للرئيسية عند عدم وجود بنرات من الأدمن */
  var HOME_DEFAULT_CAROUSEL = [
    {
      title: "ERVENOW — خدمة واحدة لكل شيء",
      description: "مطاعم · متاجر · توصيل · خدمات — في مكان واحد",
      link_url: "/start-now",
      link_label: "اطلب الآن",
      _theme: 1,
    },
    {
      title: "توصيل سريع وتتبع لحظي",
      description: "اطلب بثقة من أنشطة معتمدة على المنصة",
      link_url: "/dashboard",
      link_label: "استكشف المنصة",
      _theme: 2,
    },
    {
      title: "انضم كشريك على ERVENOW",
      description: "سجّل نشاطك واستقبل الطلبات من عملاء المنصة",
      link_url: "/register-store",
      link_label: "سجّل متجرك",
      _theme: 3,
    },
  ];

  /* ——— Carousel (home promo) ——— */
  var carouselTimer = null;
  var carouselIndex = 0;
  var carouselState = null;

  function clearCarouselTimer() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  function trackTranslateX(viewport, index) {
    var w = viewport ? viewport.clientWidth : 0;
    if (!w) return "translateX(0)";
    var isRtl = false;
    try {
      isRtl = getComputedStyle(viewport).direction === "rtl";
    } catch (_e) {}
    var offset = index * w;
    return isRtl ? "translateX(" + offset + "px)" : "translateX(-" + offset + "px)";
  }

  function setCarouselSlide(state, idx) {
    if (!state || !state.slides.length) return;
    carouselIndex = ((idx % state.slides.length) + state.slides.length) % state.slides.length;
    state.slides.forEach(function (slide, i) {
      slide.classList.toggle("is-active", i === carouselIndex);
      slide.setAttribute("aria-hidden", i === carouselIndex ? "false" : "true");
    });
    if (state.track && state.viewport) {
      state.track.style.transform = trackTranslateX(state.viewport, carouselIndex);
    }
    if (state.dots) {
      state.dots.querySelectorAll(".sn-hero-carousel__dot").forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === carouselIndex);
        dot.setAttribute("aria-selected", i === carouselIndex ? "true" : "false");
      });
    }
    var activeBanner = state.banners[carouselIndex];
    if (activeBanner && activeBanner.id) recordImpression(activeBanner.id);
  }

  function startCarousel(state) {
    clearCarouselTimer();
    setCarouselSlide(state, carouselIndex);
    if (!state || state.slides.length < 2 || prefersReducedMotion()) return;
    carouselTimer = setInterval(function () {
      setCarouselSlide(state, carouselIndex + 1);
    }, CAROUSEL_MS);
  }

  function buildSlide(banner, idx, total) {
    var article = document.createElement("article");
    article.className = "sn-hero-carousel__slide";
    if (!banner.image_url && banner._theme) {
      article.classList.add("sn-hero-carousel__slide--theme-" + String(banner._theme));
    }
    article.setAttribute("data-slide-index", String(idx));
    article.setAttribute("aria-hidden", idx === 0 ? "false" : "true");
    if (idx === 0) article.classList.add("is-active");

    if (banner.image_url) {
      var heroImg = appendBannerImage(article, banner.image_url, banner.title || "", "sn-hero-carousel__bg");
      if (heroImg && idx === 0) heroImg.loading = "eager";
    }

    var overlay = document.createElement("div");
    overlay.className = "sn-hero-carousel__overlay";
    overlay.setAttribute("aria-hidden", "true");
    article.appendChild(overlay);

    var body = document.createElement("div");
    body.className = "sn-hero-carousel__body";
    if (banner.title) {
      var titleEl = document.createElement("h2");
      titleEl.className = "sn-hero__title";
      titleEl.innerHTML = titleHtml(banner.title);
      body.appendChild(titleEl);
    }
    if (banner.description) {
      var subEl = document.createElement("p");
      subEl.className = "sn-hero__sub";
      subEl.textContent = banner.description;
      body.appendChild(subEl);
    }
    var act = actionsHtml(banner, true);
    if (act) {
      var actionsEl = document.createElement("div");
      actionsEl.className = "sn-hero__actions";
      actionsEl.innerHTML = act;
      body.appendChild(actionsEl);
    }
    if (body.childNodes.length) article.appendChild(body);
    if (total > 1) article.setAttribute("aria-label", "بنر " + (idx + 1) + " من " + total);
    return article;
  }

  function renderCarousel(inner, banners) {
    inner.className = "sn-home-banner__inner sn-hero--carousel";
    inner.innerHTML = "";
    carouselIndex = 0;
    wireClickTracking(inner);

    var viewport = document.createElement("div");
    viewport.className = "sn-hero-carousel__viewport";
    viewport.setAttribute("dir", "rtl");
    var track = document.createElement("div");
    track.className = "sn-hero-carousel__track";
    track.setAttribute("aria-live", "polite");
    banners.forEach(function (b, idx) {
      track.appendChild(buildSlide(b, idx, banners.length));
    });
    viewport.appendChild(track);
    inner.appendChild(viewport);

    var dots = null;
    if (banners.length > 1) {
      dots = document.createElement("div");
      dots.className = "sn-hero-carousel__dots";
      dots.setAttribute("role", "tablist");
      banners.forEach(function (_b, idx) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "sn-hero-carousel__dot" + (idx === 0 ? " is-active" : "");
        dot.setAttribute("aria-label", "البنر " + (idx + 1));
        dot.addEventListener("click", function () {
          clearCarouselTimer();
          setCarouselSlide(carouselState, idx);
          startCarousel(carouselState);
        });
        dots.appendChild(dot);
      });
      inner.appendChild(dots);
    }

    var slides = track.querySelectorAll(".sn-hero-carousel__slide");
    carouselState = { root: inner, viewport: viewport, track: track, slides: slides, dots: dots, banners: banners };
    startCarousel(carouselState);
  }

  function renderSingleBanner(inner, banner) {
    inner.className = "sn-home-banner__inner sn-hero--single";
    inner.innerHTML = "";
    wireClickTracking(inner);
    if (banner.image_url && !prefersReducedMotion()) inner.classList.add("sn-hero--ken-burns");
    if (banner.image_url) {
      appendBannerImage(inner, banner.image_url, banner.title || "", "sn-home-banner__bg-img");
    }
    if (banner.title || banner.description) {
      var cap = document.createElement("div");
      cap.className = "sn-home-banner__caption";
      if (banner.title) {
        var t = document.createElement("p");
        t.className = "sn-home-banner__caption-title";
        t.innerHTML = captionTitleHtml(banner.title);
        cap.appendChild(t);
      }
      if (banner.description) {
        var d = document.createElement("p");
        d.className = "sn-home-banner__caption-sub";
        d.textContent = banner.description;
        cap.appendChild(d);
      }
      inner.appendChild(cap);
    }
    var act = actionsHtml(banner, true);
    if (act) {
      var actions = document.createElement("div");
      actions.className = "sn-home-banner__caption-actions";
      actions.innerHTML = act;
      inner.appendChild(actions);
    }
    recordImpression(banner.id);
  }

  function applyCarouselMount(wrapId, innerId, banners) {
    var usable = filterMidCarousel(banners);
    if (!usable.length && wrapId === "homeHeroBanner") {
      usable = HOME_DEFAULT_CAROUSEL.slice();
    }
    if (!usable.length) return;
    var wrap = document.getElementById(wrapId);
    var inner = document.getElementById(innerId);
    if (!wrap || !inner) return;
    wrap.hidden = false;
    wrap.classList.add("sn-home-banner", "erv-banner-unified");
    clearCarouselTimer();
    carouselState = null;
    if (usable.length === 1) renderSingleBanner(inner, usable[0]);
    else renderCarousel(inner, usable);
  }

  /* ——— Card placement (hero sections) ——— */
  var cardStates = Object.create(null);

  function applyCardToTarget(target, banner) {
    if (!banner || !target) return;
    var titleEl = document.getElementById(target.title);
    if (!titleEl) return;
    var subEl = document.getElementById(target.sub);
    var actionsEl = document.getElementById(target.actions);
    var sectionEl = document.getElementById(target.section);
    if (banner.title) titleEl.innerHTML = titleHtml(banner.title);
    if (subEl) subEl.textContent = banner.description || subEl.textContent || "";
    if (actionsEl) {
      var html = actionsHtml(banner, true);
      if (html) actionsEl.innerHTML = html;
    }
    if (sectionEl) {
      sectionEl.hidden = false;
      if (target.managedClass) sectionEl.classList.add(target.managedClass);
      if (banner.image_url) {
        sectionEl.style.setProperty("--platform-hero-bg", 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")');
        if (target.bgClass) sectionEl.classList.add(target.bgClass);
      } else {
        sectionEl.style.removeProperty("--platform-hero-bg");
        if (target.bgClass) sectionEl.classList.remove(target.bgClass);
      }
      wireClickTracking(sectionEl);
    }
    recordImpression(banner.id);
  }

  function applyCardPlacement(key, targets, banners) {
    var usable = filterCards(banners);
    if (!usable.length) return;
    if (!cardStates[key]) cardStates[key] = { cache: [], index: 0, timer: null, targets: targets };
    var state = cardStates[key];
    if (state.timer) clearInterval(state.timer);
    state.cache = usable;
    state.index = 0;
    state.targets.forEach(function (t) {
      applyCardToTarget(t, usable[0]);
    });
    if (usable.length > 1 && !prefersReducedMotion()) {
      state.timer = setInterval(function () {
        state.index = (state.index + 1) % state.cache.length;
        state.targets.forEach(function (t) {
          applyCardToTarget(t, state.cache[state.index]);
        });
      }, CARD_ROTATE_MS);
    }
  }

  /* ——— Generic strip / card slots ——— */
  function filterLiveMapBanners(banners) {
    return (banners || []).filter(function (b) {
      return b && (String(b.title || "").trim() || String(b.description || "").trim() || String(b.image_url || "").trim());
    });
  }

  function renderUnifiedSlot(mountEl, banners) {
    var usable = filterMidCarousel(banners);
    if (!usable.length) {
      usable = filterLiveMapBanners(banners);
    }
    if (!usable.length || !mountEl) return;
    mountEl.hidden = false;
    mountEl.className = "sn-home-banner sn-home-banner--mid erv-banner-unified erv-banner-unified--slot";
    var innerId = mountEl.id ? mountEl.id + "Inner" : "ervBannerSlotInner";
    mountEl.innerHTML = '<div class="sn-home-banner__inner" id="' + innerId + '"></div>';
    var inner = document.getElementById(innerId);
    if (!inner) return;
    clearCarouselTimer();
    carouselState = null;
    if (usable.length === 1) renderSingleBanner(inner, usable[0]);
    else renderCarousel(inner, usable);
  }

  function renderStripSlot(mount, banners) {
    renderUnifiedSlot(mount, banners);
  }

  function renderGenericCard(mount, banners) {
    renderUnifiedSlot(mount, banners);
  }

  function applyLegacyPayload(j, pageTarget) {
    var target = pageTarget || detectTarget();
    var pmap = (j && j.placements) || {};
    var homePromo = pmap.home_promo || (Array.isArray(j.promo_banners) ? j.promo_banners : Array.isArray(j.banners) ? j.banners : j.banner ? [j.banner] : []);
    var homeHero = pmap.home_hero || j.home_hero_banners || [];
    var guestDash = pmap.guest_dashboard || j.guest_dashboard_banners || j.platform_banners || [];
    var homeAll = homePromo.concat(homeHero);

    if (target === "home") {
      if (document.getElementById("homeHeroBanner")) applyCarouselMount("homeHeroBanner", "homeHeroBannerInner", homeAll);
      var homeTextCards = filterTextCards(homeAll);
      if (document.getElementById("homeHeroSection") && homeTextCards.length) {
        applyCardPlacement(
          "home_hero",
          [{ title: "homeHeroTitle", sub: "homeHeroSub", actions: "homeHeroActions", section: "homeHeroSection", managedClass: "sn-hero--platform-managed", bgClass: "sn-hero--has-platform-bg" }],
          homeTextCards
        );
      }
      return;
    }

    if (target === "visitor_dashboard") {
      if (document.getElementById("ervVisitorBanner")) applyCarouselMount("ervVisitorBanner", "ervVisitorBannerInner", guestDash);
      var guestTextCards = filterTextCards(guestDash);
      if (document.getElementById("platformHeroSection") && guestTextCards.length) {
        applyCardPlacement(
          "guest_dashboard",
          [{ title: "platformHeroTitle", sub: "platformHeroSub", actions: "platformHeroActions", section: "platformHeroSection", managedClass: "sn-hero--platform-managed", bgClass: "sn-hero--has-platform-bg" }],
          guestTextCards
        );
      }
    }
  }

  function applySectionCarousel(target, banners) {
    var mount = SECTION_CAROUSEL_MOUNTS[target];
    if (!mount) return false;
    applyCarouselMount(mount.wrap, mount.inner, banners);
    return true;
  }

  function applyTargetBanners(target, banners) {
    if (target === "home") {
      applyCarouselMount("homeHeroBanner", "homeHeroBannerInner", banners);
      var homeTextCards = filterTextCards(banners);
      if (homeTextCards.length) {
        applyCardPlacement(
          "home_hero",
          [{ title: "homeHeroTitle", sub: "homeHeroSub", actions: "homeHeroActions", section: "homeHeroSection", managedClass: "sn-hero--platform-managed", bgClass: "sn-hero--has-platform-bg" }],
          homeTextCards
        );
      }
      return;
    }
    if (target === "visitor_dashboard") {
      applyCarouselMount("ervVisitorBanner", "ervVisitorBannerInner", banners);
      var guestTextCards = filterTextCards(banners);
      if (guestTextCards.length) {
        applyCardPlacement(
          "guest_dashboard",
          [{ title: "platformHeroTitle", sub: "platformHeroSub", actions: "platformHeroActions", section: "platformHeroSection", managedClass: "sn-hero--platform-managed", bgClass: "sn-hero--has-platform-bg" }],
          guestTextCards
        );
      }
      return;
    }
    if (applySectionCarousel(target, banners)) return;
    if (target === "live_map") {
      renderStripSlot(document.getElementById("ervBannerStrip"), banners);
      return;
    }
    renderGenericCard(document.getElementById("ervBannerCard"), banners);
  }

  function showHomeBannerFallback() {
    if (document.getElementById("homeHeroBanner")) {
      applyCarouselMount("homeHeroBanner", "homeHeroBannerInner", []);
    }
  }

  function ensureHomeBannerVisible() {
    var wrap = document.getElementById("homeHeroBanner");
    if (wrap && wrap.hidden) showHomeBannerFallback();
  }

  function loadBanners() {
    var target = detectTarget();
    if (!target) return;

    fetch(apiUrl("/api/core/banners?target=" + encodeURIComponent(target)), { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && Array.isArray(j.banners)) {
          applyTargetBanners(target, j.banners);
          if (target === "home") ensureHomeBannerVisible();
          return;
        }
        return fetch(apiUrl("/api/core/hero-banner"), { credentials: "same-origin" })
          .then(function (r2) {
            return r2.json();
          })
          .then(function (legacy) {
            applyLegacyPayload(legacy, target);
            if (target === "home") ensureHomeBannerVisible();
          });
      })
      .catch(function () {
        fetch(apiUrl("/api/core/hero-banner"), { credentials: "same-origin" })
          .then(function (r) {
            return r.json();
          })
          .then(function (legacy) {
            applyLegacyPayload(legacy, target);
            if (target === "home") ensureHomeBannerVisible();
          })
          .catch(function () {
            if (target === "home") showHomeBannerFallback();
          });
      });
  }

  window.ErvenowBannerEngine = { load: loadBanners, detectTarget: detectTarget };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadBanners);
  } else {
    loadBanners();
  }
})();
