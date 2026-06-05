(function (global) {
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

  function buildSlideHtml(slide, idx, total) {
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
    }
  }

  function mountCarousel(root, offers) {
    if (!root) return false;
    var data = normalizeOffersPayload(offers);
    var slides = data.slides;
    if (!slides.length) {
      showCarouselRoot(root, false);
      return false;
    }
    showCarouselRoot(root, true);
    var n = slides.length;
    root.innerHTML =
      '<div class="guest-offers-shell" aria-label="عروض المنصة">' +
      '<div class="guest-offers-track" id="guestOffersTrack">' +
      slides
        .map(function (s, i) {
          return buildSlideHtml(s, i, n);
        })
        .join("") +
      "</div>" +
      (n > 1
        ? '<div class="guest-offers-dots" id="guestOffersDots" aria-hidden="true">' +
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
      var track = root.querySelector("#guestOffersTrack");
      var dots = root.querySelectorAll("#guestOffersDots .guest-offers-dot");
      var idx = 0;

      function slideTransform(i) {
        return "translateX(-" + i * 100 + "%)";
      }

      function goTo(i) {
        idx = ((i % n) + n) % n;
        if (track) track.style.transform = slideTransform(idx);
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

      if (global.__guestOffersTimer) clearInterval(global.__guestOffersTimer);
      global.__guestOffersTimer = setInterval(function () {
        goTo(idx + 1);
      }, 5000);
      goTo(0);
    }
    return true;
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
    var offers = null;
    try {
      offers = await fetchOffersPayload();
    } catch (_e) {
      offers = null;
    }
    mountCarousel(root, offers);
    mountOffersTabGrid(offers);
    try {
      global.dispatchEvent(
        new CustomEvent("ervenow:guest-offers-loaded", {
          detail: { offers: offers, visible: !!(offers && normalizeOffersPayload(offers).slides.length) },
        })
      );
    } catch (_e2) {}
  }

  function boot() {
    loadGuestOffersCarousel("guestOffersCarousel");
  }

  global.ErvenowGuestOffers = {
    mount: mountCarousel,
    load: loadGuestOffersCarousel,
    mountOffersTab: mountOffersTabGrid,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
