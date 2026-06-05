/**
 * يحمّل أول بنر نشط من /api/core/hero-banner ويطبّقه على قسم الصفحة الرئيسية.
 */
(function () {
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

  function renderTitle(el, title) {
    if (!el) return;
    var parts = splitTitle(title);
    if (!parts.line1 && !parts.line2) return;
    if (parts.line2) {
      el.innerHTML = esc(parts.line1) + "<br><span>" + esc(parts.line2) + "</span>";
    } else {
      el.textContent = parts.line1;
    }
  }

  function applyBanner(banner) {
    if (!banner) return;
    var section = document.getElementById("homeHeroSection");
    var titleEl = document.getElementById("homeHeroTitle");
    var subEl = document.getElementById("homeHeroSub");
    var actionsEl = document.getElementById("homeHeroActions");
    if (!section) return;

    if (banner.image_url) {
      section.classList.add("sn-hero--has-image");
      section.style.backgroundImage = 'url("' + String(banner.image_url).replace(/"/g, "%22") + '")';
    }

    if (banner.title) renderTitle(titleEl, banner.title);
    if (banner.description && subEl) subEl.textContent = banner.description;

    if (actionsEl) {
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
      if (html) actionsEl.innerHTML = html;
    }
  }

  function loadHeroBanner() {
    var api = window.PlatformAPI && window.PlatformAPI.apiUrl;
    var url = api ? api("/api/core/hero-banner") : "/api/core/hero-banner";
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.banner) applyBanner(j.banner);
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
