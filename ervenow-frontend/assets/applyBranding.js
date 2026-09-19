/**
 * تحميل إعدادات الهوية من API وتطبيقها على :root (يتوافق مع styles.css وصفحة الرئيسية)
 * الهوية الرسمية: أخضر أساسي #146c43 · برتقالي accent #ff7a00 · خلفية #f7f4ef
 */
(function () {
  var LEGACY_PRIMARY = {
    "#5b371d": 1,
    "#3d2213": 1,
    "#2a1810": 1,
    "#2b1f16": 1,
  };
  var LEGACY_ACCENT = {
    "#d4a76a": 1,
    "#b9872f": 1,
    "#c9a227": 1,
    "#d4a84b": 1,
  };
  var OFFICIAL = {
    primary_color: "#146c43",
    secondary_color: "#0f5a37",
    accent_color: "#ff7a00",
    background_color: "#f7f4ef",
    text_color: "#111827",
  };

  function normHex(v) {
    return String(v || "").trim().toLowerCase();
  }

  function mapPrimary(v) {
    var h = normHex(v);
    if (!h || LEGACY_PRIMARY[h]) return OFFICIAL.primary_color;
    return v;
  }
  function mapSecondary(v) {
    var h = normHex(v);
    if (!h || LEGACY_PRIMARY[h] || h === "#8b5e34") return OFFICIAL.secondary_color;
    return v;
  }
  function mapAccent(v) {
    var h = normHex(v);
    if (!h || LEGACY_ACCENT[h]) return OFFICIAL.accent_color;
    return v;
  }
  function mapBg(v) {
    var h = normHex(v);
    if (!h || h === "#f8f5f0" || h === "#f8f4ee" || h === "#faf4ee") return OFFICIAL.background_color;
    return v;
  }
  function mapText(v) {
    var h = normHex(v);
    if (!h || LEGACY_PRIMARY[h]) return OFFICIAL.text_color;
    return v;
  }

  function apiBrandingUrl() {
    try {
      if (window.PlatformAPI && typeof window.PlatformAPI.apiUrl === "function") {
        return window.PlatformAPI.apiUrl("/api/core/platform-branding");
      }
    } catch (e) {}
    return "/api/core/platform-branding";
  }

  function resolveLogoUrl(raw) {
    var u = String(raw || "").trim();
    if (!u) return "/assets/ervenow-logo.png?erv=20260919logo";
    if (/uploads\/platform\/logo\.png/i.test(u) || /\/assets\/ervenow-logo\.png/i.test(u)) {
      return "/assets/ervenow-logo.png?erv=20260919logo";
    }
    return u;
  }

  function applySettings(d) {
    if (!d) return;
    var root = document.documentElement;

    var primary = mapPrimary(d.primary_color);
    var secondary = mapSecondary(d.secondary_color);
    var accent = mapAccent(d.accent_color);
    var background = mapBg(d.background_color);
    var text = mapText(d.text_color);

    root.style.setProperty("--primary", primary);
    root.style.setProperty("--erve-primary", primary);
    root.style.setProperty("--erv-primary", primary);
    root.style.setProperty("--gold", primary);

    root.style.setProperty("--secondary", secondary);
    root.style.setProperty("--erve-primary-deep", secondary);
    root.style.setProperty("--erv-secondary", secondary);

    root.style.setProperty("--accent", accent);
    root.style.setProperty("--erve-accent", accent);

    root.style.setProperty("--background", background);
    root.style.setProperty("--bg", background);
    root.style.setProperty("--erve-bg", background);
    try {
      var skipBodyBg =
        (document.body && document.body.classList.contains("erv-keep-page-bg")) ||
        /admin-login/i.test(location.pathname || "");
      if (!skipBodyBg) document.body.style.background = background;
    } catch (e) {}

    root.style.setProperty("--text", text);
    root.style.setProperty("--erv-text", text);
    root.style.setProperty("--erve-text", text);
    root.style.setProperty("--erve-ink", text);
    root.style.setProperty("--brown", text);

    var img = document.getElementById("ervBrandLogo");
    var nameEl = document.querySelector(".lp-brand__name");
    var tagEl = document.querySelector(".lp-brand__tag");
    var logoSlot = document.querySelector(".lp-header__logo-slot");
    if (img) {
      var u = resolveLogoUrl(d.logo_url);
      img.src = u;
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
      else applySettings(OFFICIAL);
    } catch (e) {
      console.warn("[applyBranding]", e);
      applySettings(OFFICIAL);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
