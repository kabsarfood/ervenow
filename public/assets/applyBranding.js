/**
 * تحميل إعدادات الهوية من API وتطبيقها على :root (يتوافق مع styles.css وصفحة الرئيسية)
 */
(function () {
  function apiBrandingUrl() {
    try {
      if (window.PlatformAPI && typeof window.PlatformAPI.apiUrl === "function") {
        return window.PlatformAPI.apiUrl("/api/core/platform-branding");
      }
    } catch (e) {}
    return "/api/core/platform-branding";
  }

  function applySettings(d) {
    if (!d) return;
    var root = document.documentElement;
    if (d.primary_color) {
      root.style.setProperty("--primary", d.primary_color);
      root.style.setProperty("--brown", d.primary_color);
      root.style.setProperty("--erv-primary", d.primary_color);
    }
    if (d.secondary_color) {
      root.style.setProperty("--secondary", d.secondary_color);
      root.style.setProperty("--erv-secondary", d.secondary_color);
    }
    if (d.accent_color) {
      root.style.setProperty("--accent", d.accent_color);
      root.style.setProperty("--gold", d.accent_color);
    }
    if (d.background_color) {
      root.style.setProperty("--background", d.background_color);
      root.style.setProperty("--bg", d.background_color);
      try {
        document.body.style.background = d.background_color;
      } catch (e) {}
    }
    if (d.text_color) {
      root.style.setProperty("--text", d.text_color);
      root.style.setProperty("--erv-text", d.text_color);
    }

    var img = document.getElementById("ervBrandLogo");
    var nameEl = document.querySelector(".lp-brand__name");
    var tagEl = document.querySelector(".lp-brand__tag");
    var logoSlot = document.querySelector(".lp-header__logo-slot");
    if (img && d.logo_url && String(d.logo_url).trim()) {
      var u = String(d.logo_url).trim();
      if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) img.src = u;
      else img.src = u;
      img.style.display = "block";
      img.alt = "ERVENOW";
      if (logoSlot) logoSlot.classList.add("lp-header__logo-slot--has-img");
    } else if (img) {
      var fallback = "/assets/ervenow-logo.png";
      img.src = fallback;
      img.style.display = "block";
      img.alt = "ERVENOW";
      if (logoSlot) logoSlot.classList.add("lp-header__logo-slot--has-img");
    }
    if (nameEl) nameEl.style.display = "";
    if (tagEl) tagEl.style.display = "";
  }

  async function run() {
    try {
      var res = await fetch(apiBrandingUrl(), { credentials: "same-origin" });
      var j = await res.json().catch(function () {
        return {};
      });
      var s = j.settings || j;
      if (s && typeof s === "object") applySettings(s);
    } catch (e) {
      console.warn("[applyBranding]", e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
