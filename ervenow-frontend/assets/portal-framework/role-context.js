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
    store: { id: "store", icon: "🏪", label: "المتجر", en: "Store" },
    employees: { id: "employees", icon: "👤", label: "الموظفون", en: "Employees" },
    orders: { id: "orders", icon: "📦", label: "الطلبات", en: "Orders" },
    products: { id: "products", icon: "🛍", label: "المنتجات", en: "Products" },
    categories: { id: "categories", icon: "📂", label: "الفئات", en: "Categories" },
    offers: { id: "offers", icon: "🏷", label: "العروض", en: "Offers" },
    wallet: { id: "wallet", icon: "💳", label: "المحفظة", en: "Wallet" },
    withdrawals: { id: "withdrawals", icon: "🏧", label: "السحوبات", en: "Withdrawals" },
    pos: { id: "pos", icon: "🧾", label: "الكاشير", en: "POS" },
    "store-admin": { id: "store-admin", icon: "🏪", label: "إدارة المتجر", en: "Store admin" },
    reports: { id: "reports", icon: "📈", label: "التقارير", en: "Reports" },
    expenses: { id: "expenses", icon: "💸", label: "المصروفات", en: "Expenses" },
    notifications: {
      id: "notifications",
      icon: "🔔",
      label: "الإشعارات",
      en: "Notifications",
    },
    reviews: { id: "reviews", icon: "⭐", label: "التقييمات", en: "Reviews" },
    "visitor-preview": { id: "visitor-preview", icon: "👁", label: "معاينة المتجر", en: "Visitor Preview" },
    settings: { id: "settings", icon: "⚙️", label: "الإعدادات", en: "Settings" },
    addresses: { id: "addresses", icon: "📍", label: "العناوين", en: "Addresses" },
    account: { id: "account", icon: "👤", label: "الحساب", en: "Account" },
    ready: { id: "ready", icon: "🟢", label: "الطلبات الجاهزة", en: "Ready Queue" },
    active: { id: "active", icon: "🚚", label: "الطلبات النشطة", en: "Active Orders" },
    "live-track": { id: "live-track", icon: "📍", label: "التتبع الحي", en: "Live track" },
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
      sidebarLocation: true,
      loginUrl: "/login?role=store",
      defaultSection: "home",
      items: [
        "home",
        "orders",
        "store",
        "products",
        "pos",
        "wallet",
        "employees",
        "reports",
        "settings",
      ],
      extraSections: ["reviews", "notifications"],
      sidebarFoot: [],
    },
    driver: {
      portal: "driver",
      brand: "ERVENOW Driver",
      roleLabel: "مندوب",
      theme: "driver",
      sidebarLocation: true,
      loginUrl: "/login?role=driver",
      defaultSection: "dashboard",
      items: ["dashboard", "ready", "active", "live-track", "completed", "earnings", "wallet", "rating", "notifications", "settings"],
      sidebarFoot: [{ href: "/driver-preview#live-track", label: "التتبع الحي" }],
    },
    service: {
      portal: "service",
      brand: "ERVENOW Service",
      roleLabel: "مزوّد خدمة",
      theme: "service",
      sidebarLocation: true,
      loginUrl: "/login?role=service",
      defaultSection: "dashboard",
      items: ["dashboard", "requests", "schedule", "wallet", "rating", "notifications", "settings"],
      sidebarFoot: [],
    },
    transport: {
      portal: "transport",
      brand: "ERVENOW Transport",
      roleLabel: "نقل",
      theme: "transport",
      sidebarLocation: true,
      loginUrl: "/login?role=service",
      defaultSection: "dashboard",
      items: ["dashboard", "transport-orders", "wallet", "notifications", "fleet", "pricing", "settings"],
      sidebarFoot: [],
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

  var MERCHANT_HASH_ALIASES = {
    dashboard: "home",
    home: "home",
    walletAnchor: "wallet",
    withdrawals: "wallet",
    "store-admin": "store",
    "visitor-preview": "store",
    categories: "products",
    offers: "products",
    cashiers: "employees",
    employees: "employees",
    complete: "settings",
    expenses: "reports",
  };

  function normalizeSection(role, sectionId) {
    var raw = String(sectionId || "").replace(/^#/, "").trim();
    if (!raw) return "";
    if (String(role || "").toLowerCase() !== "merchant") return raw;
    if (Object.prototype.hasOwnProperty.call(MERCHANT_HASH_ALIASES, raw)) {
      return MERCHANT_HASH_ALIASES[raw];
    }
    return raw;
  }

  function isValidSection(role, sectionId) {
    var cfg = getConfig(role);
    if (!cfg) return false;
    var raw = String(sectionId || "").replace(/^#/, "").trim();
    if (!raw) return false;
    var canonical = normalizeSection(role, raw);
    if ((cfg.items || []).indexOf(canonical) >= 0) return true;
    if ((cfg.extraSections || []).indexOf(raw) >= 0) return true;
    if ((cfg.extraSections || []).indexOf(canonical) >= 0) return true;
    return false;
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
    normalizeSection: normalizeSection,
    MERCHANT_HASH_ALIASES: MERCHANT_HASH_ALIASES,
    loadFromUrl: loadFromUrl,
    registry: NAV_REGISTRY,
    esc: esc,
  };
})(typeof window !== "undefined" ? window : global);
