/**
 * ERVENOW Portal Framework v2 — Operational shell config
 */
(function (global) {
  "use strict";

  var PORTAL_TITLES = {
    driver: "ERVENOW Driver",
    service: "ERVENOW Service",
    transport: "ERVENOW Transport",
    merchant: "ERVENOW Merchant",
  };

  var TRANSPORT_SERVICE_TYPES = {
    pickup_truck: 1,
    car_transport: 1,
    vehicle_transfer: 1,
    internal_delivery: 1,
    furniture_move: 1,
  };

  var SERVICE_ONLY_TYPES = {
    electrician: 1,
    plumber: 1,
    ac_technician: 1,
    laundry_estates: 1,
    agricultural_engineer: 1,
    gas_cylinder_swap: 1,
    gas_central_refill: 1,
    gas_delivery: 1,
    car_polishing: 1,
  };

  var TRANSPORT_TYPE_LABELS = {
    pickup_truck: "سطحة / نقل مركبات",
    car_transport: "نقل مركبات",
    vehicle_transfer: "نقل مركبات",
    internal_delivery: "توصيل داخلي",
    furniture_move: "نقل أثاث",
  };

  var SERVICE_TYPE_LABELS = {
    gas_cylinder_swap: "تبديل أسطوانة غاز",
    gas_central_refill: "تعبئة غاز مركزي",
    gas_delivery: "توصيل غاز",
    car_polishing: "تلميع المركبات",
  };

  function portalTitle(role) {
    return PORTAL_TITLES[String(role || "").toLowerCase()] || "بوابة ERVENOW";
  }

  function isTransportType(serviceType) {
    return !!TRANSPORT_SERVICE_TYPES[String(serviceType || "").toLowerCase()];
  }

  function isServiceOnlyType(serviceType) {
    var t = String(serviceType || "").toLowerCase();
    if (!t) return true;
    if (isTransportType(t)) return false;
    return !!SERVICE_ONLY_TYPES[t] || true;
  }

  function bottomNavForRole(role) {
    var r = String(role || "").toLowerCase();
    if (r === "merchant") {
      return [
        { id: "orders", icon: "📦", label: "الطلبات", section: "orders" },
        { id: "products", icon: "🏷️", label: "المنتجات", section: "products" },
        { id: "notifications", icon: "🔔", label: "الإشعارات", action: "notifications" },
        { id: "settings", icon: "⚙️", label: "الحساب", section: "settings" },
      ];
    }
    var ordersSection = r === "driver" ? "ready" : r === "transport" ? "transport-orders" : "requests";
    return [
      { id: "orders", icon: "📋", label: "الطلبات", section: ordersSection },
      { id: "wallet", icon: "💳", label: "المحفظة", section: "wallet" },
      { id: "notifications", icon: "🔔", label: "الإشعارات", action: "notifications" },
      { id: "account", icon: "👤", label: "الحساب", section: "settings" },
    ];
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.Operational = {
    PORTAL_TITLES: PORTAL_TITLES,
    TRANSPORT_SERVICE_TYPES: TRANSPORT_SERVICE_TYPES,
    SERVICE_ONLY_TYPES: SERVICE_ONLY_TYPES,
    TRANSPORT_TYPE_LABELS: TRANSPORT_TYPE_LABELS,
    SERVICE_TYPE_LABELS: SERVICE_TYPE_LABELS,
    portalTitle: portalTitle,
    isTransportType: isTransportType,
    isServiceOnlyType: isServiceOnlyType,
    bottomNavForRole: bottomNavForRole,
  };
})(typeof window !== "undefined" ? window : globalThis);
