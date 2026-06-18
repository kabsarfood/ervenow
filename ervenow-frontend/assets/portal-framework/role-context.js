/**
 * ERVENOW Portal Framework v1 — RoleContext
 * Nav registry + per-role configuration (embedded; mirrors configs/*.json).
 * البوابات التشغيلية الرسمية: merchant · driver · service · transport
 */
(function (global) {
  "use strict";

  var NAV_REGISTRY = {
    home: { id: "home", icon: "🏠", label: "الرئيسية", en: "Home" },
    dashboard: { id: "dashboard", icon: "📊", label: "لوحة التحكم", en: "Dashboard" },
    orders: { id: "orders", icon: "📦", label: "الطلبات", en: "Orders" },
    products: { id: "products", icon: "🛍", label: "المنتجات", en: "Products" },
    categories: { id: "categories", icon: "📂", label: "الفئات", en: "Categories" },
    offers: { id: "offers", icon: "🏷", label: "العروض", en: "Offers" },
    wallet: { id: "wallet", icon: "💳", label: "المحفظة", en: "Wallet" },
    withdrawals: { id: "withdrawals", icon: "🏧", label: "السحوبات", en: "Withdrawals" },
    pos: { id: "pos", icon: "🧾", label: "الكاشير", en: "POS" },
    reports: { id: "reports", icon: "📈", label: "التقارير", en: "Reports" },
    notifications: {
      id: "notifications",
      icon: "🔔",
      label: "الإشعارات",
      en: "Notifications",
    },
    settings: { id: "settings", icon: "⚙️", label: "الإعدادات", en: "Settings" },
    addresses: { id: "addresses", icon: "📍", label: "العناوين", en: "Addresses" },
    account: { id: "account", icon: "👤", label: "الحساب", en: "Account" },
    ready: { id: "ready", icon: "🟢", label: "الطلبات الجاهزة", en: "Ready Queue" },
    active: { id: "active", icon: "🚚", label: "الطلبات النشطة", en: "Active Orders" },
    completed: { id: "completed", icon: "✅", label: "المكتملة", en: "Completed Orders" },
    earnings: { id: "earnings", icon: "💰", label: "الأرباح", en: "Earnings" },
    rating: { id: "rating", icon: "⭐", label: "التقييم", en: "Rating" },
    requests: { id: "requests", icon: "📋", label: "الطلبات", en: "Requests" },
    schedule: { id: "schedule", icon: "📅", label: "الجدولة", en: "Schedule" },
    "transport-orders": {
      id: "transport-orders",
      icon: "🚚",
      label: "طلبات النقل",
      en: "Transport Orders",
    },
    fleet: { id: "fleet", icon: "🚛", label: "الأسطول", en: "Fleet" },
    pricing: { id: "pricing", icon: "💲", label: "التسعير", en: "Pricing" },
  };

  var ROLE_CONFIGS = {
    merchant: {
      portal: "merchant",
      brand: "ERVENOW Merchant",
      roleLabel: "تاجر",
      theme: "merchant",
      defaultSection: "dashboard",
      items: [
        "dashboard",
        "orders",
        "products",
        "categories",
        "offers",
        "wallet",
        "withdrawals",
        "reports",
        "notifications",
        "settings",
        "pos",
      ],
      sidebarFoot: [
        { href: "/store-dashboard", label: "لوحة المتجر" },
        { href: "/order-board", label: "Order Board" },
      ],
    },
    driver: {
      portal: "driver",
      brand: "ERVENOW Driver",
      roleLabel: "مندوب",
      theme: "driver",
      defaultSection: "dashboard",
      items: ["dashboard", "ready", "active", "completed", "earnings", "wallet", "rating", "notifications", "settings"],
      sidebarFoot: [
        { href: "/driver", label: "لوحة المندوب" },
        { href: "/driver-app", label: "التتبع الحي" },
      ],
    },
    service: {
      portal: "service",
      brand: "ERVENOW Service",
      roleLabel: "مزوّد خدمة",
      theme: "service",
      defaultSection: "dashboard",
      items: ["dashboard", "requests", "schedule", "wallet", "rating", "notifications", "settings"],
      sidebarFoot: [{ href: "/services-provider.html", label: "البوابة الكلاسيكية" }],
    },
    transport: {
      portal: "transport",
      brand: "ERVENOW Transport",
      roleLabel: "نقل",
      theme: "transport",
      defaultSection: "dashboard",
      items: ["dashboard", "transport-orders", "wallet", "notifications", "fleet", "pricing", "settings"],
      sidebarFoot: [{ href: "/services-provider.html", label: "بوابة النقل الكلاسيكية" }],
    },
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function resolveNavItem(key) {
    var item = NAV_REGISTRY[String(key || "").trim()];
    if (!item) return null;
    return Object.assign({}, item);
  }

  function getConfig(role) {
    var key = String(role || "").toLowerCase();
    var cfg = ROLE_CONFIGS[key];
    if (!cfg) return null;
    var overrides = cfg.itemOverrides || {};
    return Object.assign({}, cfg, {
      nav: (cfg.items || [])
        .map(function (id) {
          var item = resolveNavItem(id);
          if (!item) return null;
          if (overrides[id]) return Object.assign({}, item, overrides[id]);
          return item;
        })
        .filter(Boolean),
    });
  }

  function getNavItems(role) {
    var cfg = getConfig(role);
    return cfg ? cfg.nav : [];
  }

  function isValidSection(role, sectionId) {
    var cfg = getConfig(role);
    if (!cfg) return false;
    return (cfg.items || []).indexOf(sectionId) >= 0;
  }

  async function loadFromUrl(role) {
    var cfg = getConfig(role);
    if (!cfg) return null;
    try {
      var res = await fetch("/assets/portal-framework/configs/" + encodeURIComponent(role) + ".json");
      if (!res.ok) return cfg;
      var json = await res.json();
      return Object.assign({}, cfg, json, {
        nav: (json.items || cfg.items || []).map(resolveNavItem).filter(Boolean),
      });
    } catch (_) {
      return cfg;
    }
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.RoleContext = {
    getConfig: getConfig,
    getNavItems: getNavItems,
    resolveNavItem: resolveNavItem,
    isValidSection: isValidSection,
    loadFromUrl: loadFromUrl,
    registry: NAV_REGISTRY,
    esc: esc,
  };
})(typeof window !== "undefined" ? window : global);
