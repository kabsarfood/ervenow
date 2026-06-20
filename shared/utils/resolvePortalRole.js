/**
 * ERVENOW — Role Routing Engine
 * resolvePortalRole(user) → customer | merchant | driver | service | transport | admin
 * البوابات التشغيلية (Portal Framework): merchant · driver · service · transport فقط
 */

const { OPERATIONAL_PORTAL_ROLES, isOperationalPortal } = require("./portalLaunch");

const UNIFIED_PORTAL_ROLES = new Set(["customer", "merchant", "driver", "service", "transport", "admin"]);
const OPERATIONAL_PORTALS = new Set(OPERATIONAL_PORTAL_ROLES);

const MERCHANT_DB_ROLES = new Set(["store", "merchant", "restaurant"]);

const DRIVER_PORTAL_TYPES = new Set(["internal_delivery"]);

const SERVICE_PORTAL_TYPES = new Set([
  "electrician",
  "plumber",
  "ac_technician",
  "laundry_estates",
  "agricultural_engineer",
  "gas_cylinder_swap",
  "gas_central_refill",
  "gas_delivery",
]);

const TRANSPORT_PORTAL_TYPES = new Set([
  "pickup_truck",
  "car_transport",
  "vehicle_transfer",
  "furniture_move",
]);

const {
  portalPathForRole,
  portalPreviewPathForRole,
  isPortalLive,
  PORTAL_PREVIEW_PATHS,
} = require("./portalLaunch");

const PORTAL_LABELS_AR = {
  customer: "المنصة الرئيسية",
  merchant: "ERVENOW Merchant",
  driver: "ERVENOW Driver",
  service: "ERVENOW Service",
  transport: "ERVENOW Transport",
  admin: "ERVENOW Admin Console",
};

const KNOWN_DB_ROLES = new Set([
  "customer",
  "user",
  "driver",
  "store",
  "merchant",
  "restaurant",
  "service",
  "admin",
  "blocked",
]);

function normServiceType(serviceType) {
  const t = String(serviceType || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  if (t === "cleaning" || t === "cleaning_villa" || t === "cleaning_building") return "laundry_estates";
  if (t === "nursery") return "agricultural_engineer";
  return t;
}

function isDriverPortalType(serviceType) {
  const t = normServiceType(serviceType);
  return !!t && DRIVER_PORTAL_TYPES.has(t);
}

function isTransportPortalType(serviceType) {
  const t = normServiceType(serviceType);
  return !!t && TRANSPORT_PORTAL_TYPES.has(t);
}

function isServicePortalType(serviceType) {
  const t = normServiceType(serviceType);
  return !!t && SERVICE_PORTAL_TYPES.has(t);
}

/**
 * @param {{ role?: string, service_type?: string|null, status?: string|null }|null|undefined} user
 * @returns {{ portalRole: string, unknownRole: boolean, unknownServiceType: boolean, rawRole: string, serviceType: string }}
 */
function resolvePortalRole(user) {
  const rawRole = String(user?.role || "customer")
    .trim()
    .toLowerCase();
  const serviceType = normServiceType(user?.service_type);
  let unknownRole = false;
  let unknownServiceType = false;

  if (rawRole === "admin") {
    return { portalRole: "admin", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
  }

  if (rawRole === "blocked") {
    return { portalRole: "customer", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
  }

  if (rawRole === "driver") {
    if (isTransportPortalType(serviceType)) {
      return { portalRole: "transport", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
    }
    return { portalRole: "driver", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
  }

  if (MERCHANT_DB_ROLES.has(rawRole)) {
    return { portalRole: "merchant", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
  }

  if (rawRole === "service") {
    if (isDriverPortalType(serviceType)) {
      return { portalRole: "driver", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
    }
    if (isTransportPortalType(serviceType)) {
      return { portalRole: "transport", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
    }
    if (isServicePortalType(serviceType)) {
      return { portalRole: "service", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
    }
    if (!serviceType) {
      return { portalRole: "service", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
    }
    unknownServiceType = true;
    return { portalRole: "customer", unknownRole: false, unknownServiceType: true, rawRole, serviceType };
  }

  if (rawRole === "customer" || rawRole === "user" || !rawRole) {
    return { portalRole: "customer", unknownRole: false, unknownServiceType: false, rawRole, serviceType };
  }

  if (!KNOWN_DB_ROLES.has(rawRole)) {
    unknownRole = true;
  }
  return { portalRole: "customer", unknownRole, unknownServiceType: false, rawRole, serviceType };
}

function portalPathForRoleReexport(portalRole) {
  return portalPathForRole(portalRole);
}

function portalLabelAr(portalRole) {
  const r = String(portalRole || "customer").toLowerCase();
  return PORTAL_LABELS_AR[r] || PORTAL_LABELS_AR.customer;
}

function resolvePostLoginPath(user) {
  if (String(user?.role || "").toLowerCase() === "blocked") {
    return "/blocked-complaints";
  }
  const resolved = resolvePortalRole(user);
  return portalPathForRole(resolved.portalRole);
}

/**
 * بوابة مزوّد الخدمة/النقل — نفس منطق apps/services/routes.js
 * @param {{ role?: string }|null|undefined} appUser
 * @param {{ role?: string, service_type?: string|null }|null|undefined} profile
 */
function portalRoleForProvider(appUser, profile) {
  return resolvePortalRole({
    role: (profile && profile.role) || (appUser && appUser.role) || "service",
    service_type: profile && profile.service_type,
  }).portalRole;
}

module.exports = {
  UNIFIED_PORTAL_ROLES,
  OPERATIONAL_PORTAL_ROLES,
  OPERATIONAL_PORTALS,
  isOperationalPortal,
  MERCHANT_DB_ROLES,
  DRIVER_PORTAL_TYPES,
  SERVICE_PORTAL_TYPES,
  TRANSPORT_PORTAL_TYPES,
  isDriverPortalType,
  PORTAL_PREVIEW_PATHS,
  PORTAL_LABELS_AR,
  normServiceType,
  isTransportPortalType,
  isServicePortalType,
  resolvePortalRole,
  portalRoleForProvider,
  portalPathForRole: portalPathForRoleReexport,
  portalPreviewPathForRole,
  isPortalLive,
  portalLabelAr,
  resolvePostLoginPath,
};
