/**
 * بنرات الصفحة الرئيسية — /api/core/hero-banner
 * بنر واحد: خلفية متحركة (ken-burns) | أكثر من بنر: عرض دوّار تلقائي
 */
(function () {
  var CAROUSEL_MS = 6000;
  var carouselTimer = null;
  var carouselIndex = 0;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    if (parts.line2) {
      return esc(parts.line1) + "<br><span>" + esc(parts.line2) + "</span>";
    }
    return esc(parts.line1);
  }

  function actionsHtml(banner) {
    var html = "";
    if (banner.button1_text && banner.button1_url) {
      html +=
        '<a class="sn-hero__cta" href="' +
        esc(banner.button1_url) +
        '">' +
        esc(banner.button1_text) +
        "</a>";
    }
    if (banner.button2_text && banner.button2_url) {
      html +=
        '<a class="sn-hero__cta sn-hero__cta--outline" href="' +
        esc(banner.button2_url) +
        '">' +
        esc(banner.button2_text) +
        "</a>";
    }
    return html;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function clearCarouselTimer() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  function setCarouselSlide(section, slides, dots, idx) {
    if (!slides.length) return;
    carouselIndex = ((idx % slides.length) + slides.length) % slides.length;
    slides.forEach(function (slide, i) {
      slide.classList.toggle("is-active", i === carouselIndex);
      slide.setAttribute("aria-hidden", i === carouselIndex ? "false" : "true");
    });
    if (dots) {
      dots.querySelectorAll(".sn-hero-carousel__dot").forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === carouselIndex);
        dot.setAttribute("aria-selected", i === carouselIndex ? "true" : "false");
      });
    }
    section.setAttribute("data-hero-slide", String(carouselIndex + 1));
  }

  function startCarousel(section, slides, dots) {
    clearCarouselTimer();
    setCarouselSlide(section, slides, dots, 0);
    if (slides.length < 2 || prefersReducedMotion()) return;
    carouselTimer = setInterval(function () {
      setCarouselSlide(section, slides, dots, carouselIndex + 1);
    }, CAROUSEL_MS);
  }

  function buildSlide(banner, idx, total) {
    var article = document.createElement("article");
    article.className = "sn-hero-carousel__slide";
    article.setAttribute("data-slide-index", String(idx));
    article.setAttribute("aria-hidden", idx === 0 ? "false" : "true");
    if (idx === 0) article.classList.add("is-active");

    if (banner.image_url) {
      var bg = document.createElement("div");
      bg.className = "sn-hero-carousel__bg";
      bg.style.backgroundImage = 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")';
      article.appendChild(bg);
    }

    var overlay = document.createElement("div");
    overlay.className = "sn-hero-carousel__overlay";
    overlay.setAttribute("aria-hidden", "true");
    article.appendChild(overlay);

    var body = document.createElement("div");
    body.className = "sn-hero-carousel__body";

    var eyebrow = document.createElement("div");
    eyebrow.className = "sn-hero__eyebrow";
    eyebrow.textContent = "منصة ERVENOW — خدمة واحدة لكل شيء";
    body.appendChild(eyebrow);

    if (banner.title) {
      var titleEl = document.createElement("h1");
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

    var actionsHtmlStr = actionsHtml(banner);
    if (actionsHtmlStr) {
      var actionsEl = document.createElement("div");
      actionsEl.className = "sn-hero__actions";
      actionsEl.innerHTML = actionsHtmlStr;
      body.appendChild(actionsEl);
    }

    article.appendChild(body);
    if (total > 1) {
      article.setAttribute("aria-label", "بنر " + (idx + 1) + " من " + total);
    }
    return article;
  }

  function applySingleBanner(section, banner) {
    if (banner.image_url) {
      section.classList.add("sn-hero--has-image");
      if (!prefersReducedMotion()) section.classList.add("sn-hero--ken-burns");
      section.style.backgroundImage = 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")';
    }

    var titleEl = document.getElementById("homeHeroTitle");
    var subEl = document.getElementById("homeHeroSub");
    var actionsEl = document.getElementById("homeHeroActions");

    if (banner.title && titleEl) titleEl.innerHTML = titleHtml(banner.title);
    if (banner.description && subEl) subEl.textContent = banner.description;
    if (actionsEl) {
      var html = actionsHtml(banner);
      if (html) actionsEl.innerHTML = html;
    }
  }

  function applyCarousel(section, banners) {
    var guestNote = document.getElementById("guestStartNote");
    section.classList.add("sn-hero--carousel", "sn-hero--has-image");
    section.innerHTML = "";

    var track = document.createElement("div");
    track.className = "sn-hero-carousel__track";
    track.setAttribute("aria-live", "polite");

    banners.forEach(function (banner, idx) {
      track.appendChild(buildSlide(banner, idx, banners.length));
    });
    section.appendChild(track);

    var dots = null;
    if (banners.length > 1) {
      dots = document.createElement("div");
      dots.className = "sn-hero-carousel__dots";
      dots.setAttribute("role", "tablist");
      dots.setAttribute("aria-label", "اختيار البنر");
      banners.forEach(function (_b, idx) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "sn-hero-carousel__dot" + (idx === 0 ? " is-active" : "");
        dot.setAttribute("role", "tab");
        dot.setAttribute("aria-label", "البنر " + (idx + 1));
        dot.setAttribute("aria-selected", idx === 0 ? "true" : "false");
        dot.addEventListener("click", function () {
          clearCarouselTimer();
          setCarouselSlide(section, track.querySelectorAll(".sn-hero-carousel__slide"), dots, idx);
          if (!prefersReducedMotion()) {
            carouselTimer = setInterval(function () {
              setCarouselSlide(section, track.querySelectorAll(".sn-hero-carousel__slide"), dots, carouselIndex + 1);
            }, CAROUSEL_MS);
          }
        });
        dots.appendChild(dot);
      });
      section.appendChild(dots);
    }

    if (guestNote) section.appendChild(guestNote);

    var slides = track.querySelectorAll(".sn-hero-carousel__slide");
    startCarousel(section, slides, dots);

    section.addEventListener("mouseenter", clearCarouselTimer);
    section.addEventListener("mouseleave", function () {
      if (banners.length > 1 && !prefersReducedMotion()) {
        startCarousel(section, slides, dots);
      }
    });
  }

  function applyBanners(banners) {
    var section = document.getElementById("homeHeroSection");
    if (!section || !Array.isArray(banners) || !banners.length) return;

    clearCarouselTimer();

    if (banners.length === 1) {
      applySingleBanner(section, banners[0]);
      return;
    }
    applyCarousel(section, banners);
  }

  function loadHeroBanner() {
    var api = window.PlatformAPI && window.PlatformAPI.apiUrl;
    var url = api ? api("/api/core/hero-banner") : "/api/core/hero-banner";
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j) return;
        var banners = Array.isArray(j.banners) ? j.banners : j.banner ? [j.banner] : [];
        applyBanners(banners);
      })
      .catch(function () {
        /* يبقى المحتوى الافتراضي */
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadHeroBanner);
  } else {
    loadHeroBanner();
  }
})();
