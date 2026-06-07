/**
 * بنرات الصفحة الرئيسية — شريط شرائح تحت الهيدر (/api/core/hero-banner)
 */
(function () {
  var CAROUSEL_MS = 5500;
  var carouselTimer = null;
  var carouselIndex = 0;
  var carouselState = null;

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

  function captionTitleHtml(title) {
    var parts = splitTitle(title);
    if (!parts.line1 && !parts.line2) return "";
    if (parts.line2) {
      return esc(parts.line1) + " — <span>" + esc(parts.line2) + "</span>";
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

  function getBannerShell() {
    return {
      wrap: document.getElementById("homeHeroBanner"),
      inner: document.getElementById("homeHeroBannerInner"),
    };
  }

  function showBannerShell() {
    var shell = getBannerShell();
    if (shell.wrap) shell.wrap.hidden = false;
    return shell;
  }

  function filterUsableBanners(banners) {
    if (!Array.isArray(banners)) return [];
    return banners.filter(function (b) {
      return b && (String(b.image_url || "").trim() || String(b.title || "").trim());
    });
  }

  function updateHomeCard(banner) {
    if (!banner) return;
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
    if (state.root) state.root.setAttribute("data-hero-slide", String(carouselIndex + 1));
  }

  function startCarousel(state) {
    clearCarouselTimer();
    setCarouselSlide(state, carouselIndex);
    if (!state || state.slides.length < 2 || prefersReducedMotion()) return;
    carouselTimer = setInterval(function () {
      setCarouselSlide(state, carouselIndex + 1);
    }, CAROUSEL_MS);
  }

  function wireCarouselNav(state) {
    if (!state || state.slides.length < 2) return;
    if (state.prevBtn) {
      state.prevBtn.addEventListener("click", function () {
        clearCarouselTimer();
        setCarouselSlide(state, carouselIndex - 1);
        startCarousel(state);
      });
    }
    if (state.nextBtn) {
      state.nextBtn.addEventListener("click", function () {
        clearCarouselTimer();
        setCarouselSlide(state, carouselIndex + 1);
        startCarousel(state);
      });
    }
    if (state.viewport) {
      var touchStartX = null;
      state.viewport.addEventListener(
        "touchstart",
        function (ev) {
          touchStartX = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : null;
        },
        { passive: true }
      );
      state.viewport.addEventListener(
        "touchend",
        function (ev) {
          if (touchStartX == null) return;
          var endX = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientX : touchStartX;
          var dx = endX - touchStartX;
          if (Math.abs(dx) < 42) return;
          clearCarouselTimer();
          var isRtl = false;
          try {
            isRtl = getComputedStyle(state.viewport).direction === "rtl";
          } catch (_e2) {}
          if (isRtl ? dx > 0 : dx < 0) {
            setCarouselSlide(state, carouselIndex + 1);
          } else {
            setCarouselSlide(state, carouselIndex - 1);
          }
          startCarousel(state);
          touchStartX = null;
        },
        { passive: true }
      );
    }
    window.addEventListener("resize", function () {
      if (state && state.viewport && state.track) {
        state.track.style.transform = trackTranslateX(state.viewport, carouselIndex);
      }
    });
  }

  function buildSlide(banner, idx, total) {
    var article = document.createElement("article");
    article.className = "sn-hero-carousel__slide";
    article.setAttribute("data-slide-index", String(idx));
    article.setAttribute("aria-hidden", idx === 0 ? "false" : "true");
    if (idx === 0) article.classList.add("is-active");

    var linkUrl = banner.button1_url || banner.button2_url || "";

    if (banner.image_url) {
      var bg = document.createElement("div");
      bg.className = "sn-hero-carousel__bg";
      bg.style.backgroundImage = 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")';
      if (linkUrl && !banner.title && !banner.description && !actionsHtml(banner)) {
        var linkWrap = document.createElement("a");
        linkWrap.className = "sn-hero-carousel__cover-link";
        linkWrap.href = linkUrl;
        linkWrap.setAttribute("aria-label", "فتح العرض");
        linkWrap.appendChild(bg);
        article.appendChild(linkWrap);
      } else {
        article.appendChild(bg);
      }
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

    var actionsHtmlStr = actionsHtml(banner);
    if (actionsHtmlStr) {
      var actionsEl = document.createElement("div");
      actionsEl.className = "sn-hero__actions";
      actionsEl.innerHTML = actionsHtmlStr;
      body.appendChild(actionsEl);
    }

    if (body.childNodes.length) article.appendChild(body);
    if (total > 1) {
      article.setAttribute("aria-label", "بنر " + (idx + 1) + " من " + total);
    }
    return article;
  }

  function renderSingleBanner(inner, banner) {
    inner.className = "sn-home-banner__inner sn-hero--single";
    if (banner.image_url && !prefersReducedMotion()) {
      inner.classList.add("sn-hero--ken-burns");
    }
    inner.innerHTML = "";

    if (banner.image_url) {
      var bg = document.createElement("div");
      bg.className = "sn-home-banner__bg";
      bg.style.backgroundImage = 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")';
      inner.appendChild(bg);
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
  }

  function renderCarousel(inner, banners) {
    inner.className = "sn-home-banner__inner sn-hero--carousel";
    inner.innerHTML = "";
    carouselIndex = 0;

    var viewport = document.createElement("div");
    viewport.className = "sn-hero-carousel__viewport";
    viewport.setAttribute("dir", "rtl");

    var track = document.createElement("div");
    track.className = "sn-hero-carousel__track";
    track.setAttribute("aria-live", "polite");

    banners.forEach(function (banner, idx) {
      track.appendChild(buildSlide(banner, idx, banners.length));
    });
    viewport.appendChild(track);
    inner.appendChild(viewport);

    var prevBtn = null;
    var nextBtn = null;
    if (banners.length > 1) {
      prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "sn-hero-carousel__nav sn-hero-carousel__nav--prev";
      prevBtn.setAttribute("aria-label", "البنر السابق");
      prevBtn.textContent = "›";

      nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "sn-hero-carousel__nav sn-hero-carousel__nav--next";
      nextBtn.setAttribute("aria-label", "البنر التالي");
      nextBtn.textContent = "‹";

      inner.appendChild(prevBtn);
      inner.appendChild(nextBtn);
    }

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
          setCarouselSlide(carouselState, idx);
          startCarousel(carouselState);
        });
        dots.appendChild(dot);
      });
      inner.appendChild(dots);
    }

    var slides = track.querySelectorAll(".sn-hero-carousel__slide");
    carouselState = {
      root: inner,
      viewport: viewport,
      track: track,
      slides: slides,
      dots: dots,
      prevBtn: prevBtn,
      nextBtn: nextBtn,
    };

    wireCarouselNav(carouselState);
    startCarousel(carouselState);

    inner.addEventListener("mouseenter", clearCarouselTimer);
    inner.addEventListener("mouseleave", function () {
      if (banners.length > 1 && !prefersReducedMotion()) {
        startCarousel(carouselState);
      }
    });
  }

  function applyBanners(banners) {
    var usable = filterUsableBanners(banners);
    if (!usable.length) return;

    var shell = showBannerShell();
    if (!shell.inner) return;

    clearCarouselTimer();
    carouselState = null;
    updateHomeCard(usable[0]);

    if (usable.length === 1) {
      renderSingleBanner(shell.inner, usable[0]);
      return;
    }
    renderCarousel(shell.inner, usable);
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
