/**
 * ERVENOW Portal Framework v1 — ThemeEngine
 * Applies per-role color tokens while preserving ERVENOW identity.
 */
(function (global) {
  "use strict";

  var THEMES = {
    customer: {
      bg: "#f3f8f4",
      surface: "#fefffe",
      sidebar: "#1a3d28",
      sidebarText: "#e8f5ec",
      accent: "#2d8a4e",
      accentSoft: "#d4edda",
      text: "#1a2e22",
      muted: "#4a6358",
      border: "rgba(26, 61, 40, 0.12)",
      bannerFrom: "#1a3d28",
      bannerTo: "#2d6a3f",
      themeColor: "#1a3d28",
    },
    driver: {
      bg: "#f0f4f8",
      surface: "#feffff",
      sidebar: "#1a2d4a",
      sidebarText: "#e8eef5",
      accent: "#2563eb",
      accentSoft: "#dbeafe",
      text: "#1a2433",
      muted: "#4a5568",
      border: "rgba(26, 45, 74, 0.12)",
      bannerFrom: "#1a2d4a",
      bannerTo: "#2563eb",
      themeColor: "#1a2d4a",
    },
    merchant: {
      bg: "#f4efe8",
      surface: "#fffefb",
      sidebar: "#3d2615",
      sidebarText: "#f5ebe0",
      accent: "#c49a3c",
      accentSoft: "#f3e4cc",
      text: "#2b1f16",
      muted: "#6f5441",
      border: "rgba(61, 34, 19, 0.12)",
      bannerFrom: "#3d2615",
      bannerTo: "#5b371d",
      themeColor: "#3d2615",
    },
    service: {
      bg: "#f5f3f8",
      surface: "#fefeff",
      sidebar: "#2d1f4a",
      sidebarText: "#ede8f5",
      accent: "#7c3aed",
      accentSoft: "#ede9fe",
      text: "#1f1633",
      muted: "#5b4a6f",
      border: "rgba(45, 31, 74, 0.12)",
      bannerFrom: "#2d1f4a",
      bannerTo: "#5b21b6",
      themeColor: "#2d1f4a",
    },
    transport: {
      bg: "#f8f2f2",
      surface: "#fffefe",
      sidebar: "#3d1515",
      sidebarText: "#f5e8e8",
      accent: "#b91c1c",
      accentSoft: "#fecaca",
      text: "#2e1616",
      muted: "#6f4141",
      border: "rgba(61, 21, 21, 0.12)",
      bannerFrom: "#3d1515",
      bannerTo: "#7f1d1d",
      themeColor: "#3d1515",
    },
    admin: {
      bg: "#f2f2f3",
      surface: "#fafafa",
      sidebar: "#1f2937",
      sidebarText: "#e5e7eb",
      accent: "#6b7280",
      accentSoft: "#e5e7eb",
      text: "#111827",
      muted: "#4b5563",
      border: "rgba(31, 41, 55, 0.12)",
      bannerFrom: "#1f2937",
      bannerTo: "#374151",
      themeColor: "#1f2937",
    },
  };

  function apply(role, rootEl) {
    var themeKey = String(role || "customer").toLowerCase();
    var t = THEMES[themeKey] || THEMES.customer;
    var root = rootEl && rootEl.nodeType === 1 ? rootEl : document.documentElement;
    root.style.setProperty("--pf-bg", t.bg);
    root.style.setProperty("--pf-surface", t.surface);
    root.style.setProperty("--pf-sidebar", t.sidebar);
    root.style.setProperty("--pf-sidebar-text", t.sidebarText);
    root.style.setProperty("--pf-accent", t.accent);
    root.style.setProperty("--pf-accent-soft", t.accentSoft);
    root.style.setProperty("--pf-text", t.text);
    root.style.setProperty("--pf-muted", t.muted);
    root.style.setProperty("--pf-border", t.border);
    root.style.setProperty("--pf-banner-from", t.bannerFrom);
    root.style.setProperty("--pf-banner-to", t.bannerTo);
    if (document.body) {
      document.body.setAttribute("data-pf-role", themeKey);
      document.body.classList.add("pf-page");
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && t.themeColor) meta.setAttribute("content", t.themeColor);
    return t;
  }

  function get(role) {
    return THEMES[String(role || "customer").toLowerCase()] || THEMES.customer;
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.ThemeEngine = { apply: apply, get: get, themes: THEMES };
})(typeof window !== "undefined" ? window : global);
