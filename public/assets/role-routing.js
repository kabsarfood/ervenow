/**
 * ERVENOW Role Routing Engine — browser
 * Mirrors shared/utils/resolvePortalRole.js + portalLaunch.js
 * Single source of post-login / account / wallet destinations.
 */
(function (global) {
  "use strict";

  var OPERATIONAL_PORTAL_ROLES = ["merchant", "driver", "service", "transport"];
  var CUSTOMER_PLATFORM_HOME = "/";
  var ADMIN_CONSOLE_PATH = "/admin-dashboard";
  var CUSTOMER_WALLET_PATH = "/wallet.html";

  var MERCHANT_DB_ROLES = { store: 1, merchant: 1, restaurant: 1 };

  var DRIVER_PORTAL_TYPES = {
    internal_delivery: 1,
  };

  var SERVICE_PORTAL_TYPES = {
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

  var TRANSPORT_PORTAL_TYPES = {
    pickup_truck: 1,
    car_transport: 1,
    vehicle_transfer: 1,
    furniture_move: 1,
  };

  var OPERATIONAL_PORTAL_PATHS = {
    merchant: "/merchant-preview",
    driver: "/driver-preview",
    service: "/service-preview",
    transport: "/transport-preview",
  };

  var PORTAL_PREVIEW_PATHS = Object.assign({}, OPERATIONAL_PORTAL_PATHS);

  var PORTAL_LIVE = {
    service: true,
    transport: true,
    driver: true,
    merchant: true,
  };

  var PORTAL_LEGACY_PATHS = {
    driver: "/driver",
    merchant: "/store-dashboard",
  };

  var PORTAL_LABELS_AR = {
    customer: "المنصة الرئيسية",
    merchant: "ERVENOW Merchant",
    driver: "ERVENOW Driver",
    service: "ERVENOW Service",
    transport: "ERVENOW Transport",
    admin: "لوحة التحكم",
  };

  var KNOWN_DB_ROLES = {
    customer: 1,
    user: 1,
    driver: 1,
    store: 1,
    merchant: 1,
    restaurant: 1,
    service: 1,
    admin: 1,
    blocked: 1,
  };

  function isOperationalPortal(portalRole) {
    return OPERATIONAL_PORTAL_ROLES.indexOf(String(portalRole || "").toLowerCase()) >= 0;
  }

  function normServiceType(serviceType) {
    var t = String(serviceType || "")
      .trim()
      .toLowerCase();
    if (!t) return "";
    if (t === "cleaning" || t === "cleaning_villa" || t === "cleaning_building") return "laundry_estates";
    if (t === "nursery") return "agricultural_engineer";
    return t;
  }

  function isDriverPortalType(serviceType) {
    var t = normServiceType(serviceType);
    return !!t && !!DRIVER_PORTAL_TYPES[t];
  }

  function isTransportPortalType(serviceType) {
    var t = normServiceType(serviceType);
    return !!t && !!TRANSPORT_PORTAL_TYPES[t];
  }

  function isServicePortalType(serviceType) {
    var t = normServiceType(serviceType);
    return !!t && !!SERVICE_PORTAL_TYPES[t];
  }

  function resolvePortalRole(user) {
    var rawRole = String((user && user.role) || "customer")
      .trim()
      .toLowerCase();
    var serviceType = normServiceType(user && user.service_type);
    var unknownRole = false;
    var unknownServiceType = false;

    if (rawRole === "admin") {
      return { portalRole: "admin", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
    }
    if (rawRole === "blocked") {
      return { portalRole: "customer", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
    }
    if (rawRole === "driver") {
      if (isTransportPortalType(serviceType)) {
        return { portalRole: "transport", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
      }
      return { portalRole: "driver", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
    }
    if (MERCHANT_DB_ROLES[rawRole]) {
      return { portalRole: "merchant", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
    }
    if (rawRole === "service") {
      if (isDriverPortalType(serviceType)) {
        return { portalRole: "driver", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
      }
      if (isTransportPortalType(serviceType)) {
        return { portalRole: "transport", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
      }
      if (isServicePortalType(serviceType)) {
        return { portalRole: "service", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
      }
      if (!serviceType) {
        return { portalRole: "service", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
      }
      unknownServiceType = true;
      return { portalRole: "customer", unknownRole: false, unknownServiceType: true, rawRole: rawRole, serviceType: serviceType };
    }
    if (rawRole === "customer" || rawRole === "user" || !rawRole) {
      return { portalRole: "customer", unknownRole: false, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
    }
    if (!KNOWN_DB_ROLES[rawRole]) unknownRole = true;
    return { portalRole: "customer", unknownRole: unknownRole, unknownServiceType: false, rawRole: rawRole, serviceType: serviceType };
  }

  function portalPreviewPathForRole(portalRole) {
    var r = String(portalRole || "customer").toLowerCase();
    if (r === "customer") return CUSTOMER_PLATFORM_HOME;
    if (r === "admin") return ADMIN_CONSOLE_PATH;
    return OPERATIONAL_PORTAL_PATHS[r] || CUSTOMER_PLATFORM_HOME;
  }

  function portalPathForRole(portalRole) {
    var r = String(portalRole || "customer").toLowerCase();
    if (r === "customer") return CUSTOMER_PLATFORM_HOME;
    if (r === "admin") return ADMIN_CONSOLE_PATH;
    if (PORTAL_LIVE[r] !== false) {
      return portalPreviewPathForRole(r);
    }
    return PORTAL_LEGACY_PATHS[r] || portalPreviewPathForRole(r);
  }

  function isPortalLive(portalRole) {
    var r = String(portalRole || "").toLowerCase();
    if (!isOperationalPortal(r)) return false;
    return PORTAL_LIVE[r] !== false;
  }

  function portalLabelAr(portalRole) {
    var r = String(portalRole || "customer").toLowerCase();
    return PORTAL_LABELS_AR[r] || PORTAL_LABELS_AR.customer;
  }

  function resolvePostLoginPath(user) {
    if (String((user && user.role) || "").toLowerCase() === "blocked") {
      return "/blocked-complaints";
    }
    return portalPathForRole(resolvePortalRole(user).portalRole);
  }

  function walletPathForUser(user) {
    if (String((user && user.role) || "").toLowerCase() === "blocked") {
      return "/blocked-complaints";
    }
    var portal = resolvePortalRole(user).portalRole;
    if (portal === "customer") return CUSTOMER_WALLET_PATH;
    if (portal === "admin") return ADMIN_CONSOLE_PATH;
    return portalPathForRole(portal) + "#wallet";
  }

  function userFromRoleArg(arg) {
    if (arg && typeof arg === "object") return arg;
    return { role: String(arg || "customer").toLowerCase() };
  }

  global.ErvenowRoleRouting = {
    resolvePortalRole: resolvePortalRole,
    portalPathForRole: portalPathForRole,
    portalPreviewPathForRole: portalPreviewPathForRole,
    isPortalLive: isPortalLive,
    isOperationalPortal: isOperationalPortal,
    isDriverPortalType: isDriverPortalType,
    isTransportPortalType: isTransportPortalType,
    isServicePortalType: isServicePortalType,
    portalLabelAr: portalLabelAr,
    resolvePostLoginPath: resolvePostLoginPath,
    walletPathForUser: walletPathForUser,
    OPERATIONAL_PORTAL_ROLES: OPERATIONAL_PORTAL_ROLES,
    OPERATIONAL_PORTAL_PATHS: OPERATIONAL_PORTAL_PATHS,
    CUSTOMER_PLATFORM_HOME: CUSTOMER_PLATFORM_HOME,
    ADMIN_CONSOLE_PATH: ADMIN_CONSOLE_PATH,
    CUSTOMER_WALLET_PATH: CUSTOMER_WALLET_PATH,
    PORTAL_PREVIEW_PATHS: PORTAL_PREVIEW_PATHS,
    PORTAL_LIVE: PORTAL_LIVE,
    PORTAL_LEGACY_PATHS: PORTAL_LEGACY_PATHS,
    DRIVER_PORTAL_TYPES: DRIVER_PORTAL_TYPES,
    TRANSPORT_PORTAL_TYPES: TRANSPORT_PORTAL_TYPES,
    SERVICE_PORTAL_TYPES: SERVICE_PORTAL_TYPES,
    userFromRoleArg: userFromRoleArg,
  };
})(typeof window !== "undefined" ? window : globalThis);
