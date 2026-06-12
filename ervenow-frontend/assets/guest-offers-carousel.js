(function (global) {
  var AUTO_MS = 5000;
  var BANNER_REC_W = 1920;
  var BANNER_REC_H = 730;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function apiUrl(path) {
    if (global.PlatformAPI && typeof global.PlatformAPI.apiUrl === "function") {
      return global.PlatformAPI.apiUrl(path);
    }
    var base =
      global.__ERVENOW_API_BASE__ != null ? String(global.__ERVENOW_API_BASE__).trim().replace(/\/$/, "") : "";
    var p = String(path || "").indexOf("/") === 0 ? path : "/" + path;
    return base ? base + p : p;
  }

  function normalizeOffersPayload(raw) {
    if (!raw || typeof raw !== "object") return { enabled: true, slides: [] };
    var slides = Array.isArray(raw.slides) ? raw.slides : [];
    slides = slides.filter(function (s) {
      return s && s.active !== false && s.active !== "false";
    });
    return {
      enabled: raw.enabled !== false && raw.enabled !== "false",
      slides: slides,
    };
  }

  function buildSlideHtml(slide) {
    var href = slide.link_url || "/browse";
    var title = slide.title || "عرض";
    var sub = slide.subtitle || "";
    var price = slide.price_label || "";
    var cta = slide.link_label || "عرض التفاصيل";
    var img = slide.image_url || "";
    var noImgClass = img ? "" : " guest-offers-slide--noimg";
    return (
      '<a class="guest-offers-slide' +
      noImgClass +
      '" href="' +
      esc(href) +
      '">' +
      (img ? '<img class="guest-offers-slide__img" src="' + esc(img) + '" alt="" loading="lazy" decoding="async" />' : "") +
      '<div class="guest-offers-slide__shade"></div>' +
      '<div class="guest-offers-slide__body">' +
      (price ? '<span class="guest-offers-slide__price">' + esc(price) + "</span>" : "") +
      '<strong class="guest-offers-slide__title">' +
      esc(title) +
      "</strong>" +
      (sub ? '<span class="guest-offers-slide__sub">' + esc(sub) + "</span>" : "") +
      '<span class="guest-offers-slide__cta">' +
      esc(cta) +
      " ←</span>" +
      "</div></a>"
    );
  }

  function showCarouselRoot(root, visible) {
    if (!root) return;
    if (visible) {
      root.hidden = false;
      root.removeAttribute("hidden");
      root.style.display = "";
    } else {
      root.hidden = true;
      root.setAttribute("hidden", "");
      root.innerHTML = "";
      root.classList.remove("guest-offers-carousel--reserved");
    }
  }

  /** يحجز ارتفاع البنر قبل تحميل API لتقليل CLS */
  function reserveCarouselSlot(root) {
    if (!root || root.dataset.ervBannerReserved === "1") return;
    root.dataset.ervBannerReserved = "1";
    root.classList.add("guest-offers-carousel--reserved");
    showCarouselRoot(root, true);
    if (!root.querySelector(".guest-offers-shell")) {
      root.innerHTML =
        '<div class="guest-offers-shell guest-offers-shell--placeholder" aria-hidden="true"></div>';
    }
  }

  function prefersReducedMotion() {
    try {
      return global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_e) {
      return false;
    }
  }

  function mountCarousel(root, offers, opts) {
    opts = opts || {};
    if (!root) return false;
    var data = normalizeOffersPayload(offers);
    var slides = data.slides;
    if (!slides.length) {
      showCarouselRoot(root, false);
      return false;
    }
    showCarouselRoot(root, true);
    var n = slides.length;
    var ariaLabel = opts.ariaLabel || "عروض المنصة";
    var timerKey = opts.timerKey || "__guestOffersTimer";

    root.innerHTML =
      '<div class="guest-offers-shell" aria-label="' +
      esc(ariaLabel) +
      '">' +
      '<div class="guest-offers-track">' +
      slides
        .map(function (s) {
          return buildSlideHtml(s);
        })
        .join("") +
      "</div>" +
      (n > 1
        ? '<div class="guest-offers-dots" aria-hidden="true">' +
          slides
            .map(function (_s, i) {
              return (
                '<button type="button" class="guest-offers-dot' +
                (i === 0 ? " is-active" : "") +
                '" data-slide-idx="' +
                i +
                '" aria-label="الشريحة ' +
                (i + 1) +
                '"></button>'
              );
            })
            .join("") +
          "</div>"
        : "") +
      "</div>";

    if (n > 1) {
      var track = root.querySelector(".guest-offers-track");
      var dots = root.querySelectorAll(".guest-offers-dots .guest-offers-dot");
      var idx = 0;

      function goTo(i) {
        idx = ((i % n) + n) % n;
        if (track) track.style.transform = "translateX(-" + idx * 100 + "%)";
        for (var d = 0; d < dots.length; d++) {
          dots[d].classList.toggle("is-active", d === idx);
        }
      }

      for (var di = 0; di < dots.length; di++) {
        (function (dotIdx) {
          dots[dotIdx].onclick = function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            goTo(dotIdx);
          };
        })(di);
      }

      if (global[timerKey]) clearInterval(global[timerKey]);
      if (!prefersReducedMotion()) {
        global[timerKey] = setInterval(function () {
          goTo(idx + 1);
        }, opts.intervalMs || AUTO_MS);
      }
      goTo(0);
    }
    return true;
  }

  function resolveHomeDisplayMode(banner) {
    var mode = String((banner && banner.display_mode) || "").trim().toLowerCase();
    if (mode && mode !== "auto") return mode;
    if (banner && String(banner.image_url || "").trim()) return "carousel";
    return "card";
  }

  function isHomeCarouselBanner(banner) {
    if (!banner) return false;
    var mode = resolveHomeDisplayMode(banner);
    /* carousel / strip / auto — أو card مع صورة (بطاقة الترحيب أُزيلت من الرئيسية) */
    if (mode === "carousel" || mode === "strip" || mode === "auto") return true;
    if (mode === "card") return !!String(banner.image_url || "").trim();
    return false;
  }

  function splitBannerTitle(title) {
    var t = String(title || "").trim();
    if (!t) return { badge: "", main: "" };
    var parts = t.split("|");
    if (parts.length >= 2) {
      return { badge: parts[0].trim(), main: parts.slice(1).join("|").trim() };
    }
    return { badge: "", main: t };
  }

  function mapHomeBannerToSlide(banner) {
    var parts = splitBannerTitle(banner.title);
    return {
      title: parts.main || banner.title || "ERVENOW",
      subtitle: banner.description || "",
      price_label: parts.badge || String(banner.banner_type || "").trim() || "",
      image_url: banner.image_url || "",
      link_url: banner.button1_url || banner.button2_url || "/start-now",
      link_label: banner.button1_text || banner.button2_text || "اكتشف المزيد",
      active: true,
    };
  }

  async function fetchHomeBannersPayload() {
    var res = await fetch(apiUrl("/api/core/banners?target=home"), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    var j = await res.json().catch(function () {
      return {};
    });
    var list = [];
    if (j && j.ok && Array.isArray(j.banners)) list = j.banners;
    else if (j && Array.isArray(j.banners)) list = j.banners;
    var slides = list.filter(isHomeCarouselBanner).map(mapHomeBannerToSlide);
    return { enabled: true, slides: slides };
  }

  function mountOffersTabGrid(offers) {
    var grid = document.getElementById("dashOffersDynamicGrid");
    if (!grid) return;
    var data = normalizeOffersPayload(offers);
    var slides = data.slides;
    if (!slides.length) {
      grid.innerHTML =
        '<p class="dash-section-hint" style="grid-column:1/-1;margin:0">لا توجد عروض منشورة حالياً — تُدار من لوحة الإدارة.</p>';
      return;
    }
    grid.innerHTML = slides
      .map(function (s) {
        var href = s.link_url || "/browse";
        var title = s.title || "عرض";
        var sub = s.subtitle || s.price_label || "اضغط لعرض التفاصيل";
        var img = s.image_url || "";
        var thumb = img
          ? '<img class="dash-offer-card__img" src="' +
            esc(img) +
            '" alt="" loading="lazy" decoding="async" />'
          : '<span class="cat-card__icon" aria-hidden="true">🎁</span>';
        return (
          '<a class="cat-card dash-offer-card" href="' +
          esc(href) +
          '">' +
          thumb +
          "<strong>" +
          esc(title) +
          "</strong>" +
          "<span>" +
          esc(sub) +
          "</span></a>"
        );
      })
      .join("");
  }

  async function fetchOffersPayload() {
    var res = await fetch(apiUrl("/api/core/platform-offers"), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    var j = await res.json().catch(function () {
      return {};
    });
    if (j && j.ok && j.offers) return j.offers;
    if (j && j.offers) return j.offers;
    if (j && Array.isArray(j.slides)) return j;
    return null;
  }

  async function loadGuestOffersCarousel(containerId) {
    var root = document.getElementById(containerId || "guestOffersCarousel");
    if (root) reserveCarouselSlot(root);
    var offers = null;
    try {
      offers = await fetchOffersPayload();
    } catch (_e) {
      offers = null;
    }
    mountCarousel(root, offers, { timerKey: "__guestOffersTimer", ariaLabel: "عروض المنصة" });
    mountOffersTabGrid(offers);
    try {
      global.dispatchEvent(
        new CustomEvent("ervenow:guest-offers-loaded", {
          detail: { offers: offers, visible: !!(offers && normalizeOffersPayload(offers).slides.length) },
        })
      );
    } catch (_e2) {}
  }

  async function loadHomeMainBanner(containerId) {
    var root = document.getElementById(containerId || "homeMainBanner");
    if (root) reserveCarouselSlot(root);
    var payload = { enabled: true, slides: [] };
    try {
      payload = await fetchHomeBannersPayload();
    } catch (_e) {
      payload = { enabled: true, slides: [] };
    }
    var visible = mountCarousel(root, payload, {
      timerKey: "__homeMainBannerTimer",
      ariaLabel: "بنرات المنصة الرئيسية",
    });
    try {
      global.dispatchEvent(
        new CustomEvent("ervenow:home-main-banner-loaded", {
          detail: { slides: payload.slides, visible: visible },
        })
      );
    } catch (_e2) {}
  }

  function boot() {
    var dashCarousel = document.getElementById("guestOffersCarousel");
    var homeBanner = document.getElementById("homeMainBanner");
    if (dashCarousel) reserveCarouselSlot(dashCarousel);
    if (homeBanner) reserveCarouselSlot(homeBanner);
    if (dashCarousel) loadGuestOffersCarousel("guestOffersCarousel");
    if (homeBanner) loadHomeMainBanner("homeMainBanner");
  }

  global.ErvenowGuestOffers = {
    mount: mountCarousel,
    load: loadGuestOffersCarousel,
    loadHome: loadHomeMainBanner,
    mountOffersTab: mountOffersTabGrid,
    mapHomeBannerToSlide: mapHomeBannerToSlide,
    BANNER_REC_W: BANNER_REC_W,
    BANNER_REC_H: BANNER_REC_H,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
