(function (global) {
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function buildSlideHtml(slide, idx, total) {
    var href = slide.link_url || "/browse";
    var title = slide.title || "عرض";
    var sub = slide.subtitle || "";
    var price = slide.price_label || "";
    var cta = slide.link_label || "عرض التفاصيل";
    var img = slide.image_url || "";
    return (
      '<a class="guest-offers-slide" href="' +
      esc(href) +
      '" style="--slide-i:' +
      idx +
      ';--slide-count:' +
      total +
      '">' +
      (img ? '<img class="guest-offers-slide__img" src="' + esc(img) + '" alt="" loading="lazy" decoding="async" />' : "") +
      '<div class="guest-offers-slide__shade"></div>' +
      '<div class="guest-offers-slide__body">' +
      (price ? '<span class="guest-offers-slide__price">' + esc(price) + "</span>" : "") +
      "<strong class=\"guest-offers-slide__title\">" +
      esc(title) +
      "</strong>" +
      (sub ? '<span class="guest-offers-slide__sub">' + esc(sub) + "</span>" : "") +
      '<span class="guest-offers-slide__cta">' +
      esc(cta) +
      " ←</span>" +
      "</div></a>"
    );
  }

  function mountCarousel(root, offers) {
    if (!root) return;
    var slides = (offers && offers.slides) || [];
    if (offers && offers.enabled === false) {
      root.hidden = true;
      return;
    }
    slides = slides.filter(function (s) {
      return s && s.active !== false;
    });
    if (!slides.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    var n = slides.length;
    var trackClass = "guest-offers-track";
    root.innerHTML =
      '<div class="guest-offers-shell" aria-label="عروض المنصة">' +
      '<div class="' +
      trackClass +
      '" id="guestOffersTrack" style="--slide-count:' +
      n +
      ';width:' +
      n * 100 +
      '%">' +
      slides.map(function (s, i) {
        return buildSlideHtml(s, i, n);
      }).join("") +
      "</div>" +
      (n > 1
        ? '<div class="guest-offers-dots" id="guestOffersDots" aria-hidden="true">' +
          slides
            .map(function (_s, i) {
              return '<span class="guest-offers-dot' + (i === 0 ? " is-active" : "") + '"></span>';
            })
            .join("") +
          "</div>"
        : "") +
      "</div>";

    if (n > 1) {
      var track = document.getElementById("guestOffersTrack");
      var dots = document.querySelectorAll("#guestOffersDots .guest-offers-dot");
      var idx = 0;
      if (global.__guestOffersTimer) clearInterval(global.__guestOffersTimer);
      global.__guestOffersTimer = setInterval(function () {
        idx = (idx + 1) % n;
        if (track) track.style.transform = "translateX(-" + idx * (100 / n) + "%)";
        for (var d = 0; d < dots.length; d++) {
          dots[d].classList.toggle("is-active", d === idx);
        }
      }, 5000);
    }
  }

  async function loadGuestOffersCarousel(containerId) {
    var root = document.getElementById(containerId || "guestOffersCarousel");
    if (!root) return;
    try {
      var base = global.PlatformAPI && PlatformAPI.apiBase ? PlatformAPI.apiBase() : "";
      var r = await fetch((base || "") + "/api/core/platform-offers", {
        headers: { Accept: "application/json" },
      });
      var j = await r.json();
      mountCarousel(root, j.offers || j);
    } catch (_e) {
      mountCarousel(root, null);
    }
  }

  global.ErvenowGuestOffers = {
    mount: mountCarousel,
    load: loadGuestOffersCarousel,
  };
})(window);
