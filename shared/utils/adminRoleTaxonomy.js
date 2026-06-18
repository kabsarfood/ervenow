/**

 * تصنيف الأدوار والبوابات — لوحة جاهزية الإدارة (Role Separation Monitor)

 * البوابات التشغيلية الرسمية: merchant · driver · service · transport

 */



const {

  resolvePortalRole,

  portalPathForRole,

  isTransportPortalType,

  isServicePortalType,

  TRANSPORT_PORTAL_TYPES,

  SERVICE_PORTAL_TYPES,

  OPERATIONAL_PORTAL_ROLES,

} = require("./resolvePortalRole");

const { OPERATIONAL_PORTAL_PATHS, CUSTOMER_PLATFORM_HOME } = require("./portalLaunch");



const PORTAL_DEFINITIONS = {

  merchant: {

    label: "ERVENOW Merchant",

    labelAr: "ERVENOW Merchant",

    paths: ["/store-dashboard", "/merchant-preview"],

  },

  driver: {

    label: "ERVENOW Driver",

    labelAr: "ERVENOW Driver",

    paths: ["/driver", "/driver-app", "/driver-preview"],

  },

  service: {

    label: "ERVENOW Service",

    labelAr: "ERVENOW Service",

    paths: ["/services-provider", "/service-preview"],

  },

  transport: {

    label: "ERVENOW Transport",

    labelAr: "ERVENOW Transport",

    paths: ["/transport-preview"],

  },

};



const PREVIEW_PORTAL_KEYS = Object.assign({}, OPERATIONAL_PORTAL_PATHS);



const PLATFORM_CUSTOMER_PATHS = [

  "/",

  "/start-now",

  "/dashboard",

  "/my-orders",

  "/wallet",

  "/notifications",

  "/restaurants",

  "/stores",

  "/services",

];



const LEGACY_ACCESS_KEYS = {

  "store-dashboard": { path: "/store-dashboard", labelAr: "لوحة المتجر (قديم)" },

  "driver-app": { path: "/driver-app", labelAr: "تطبيق المندوب (قديم)" },

  "order-board": { path: "/order-board", labelAr: "Order Board" },

  "services-provider": { path: "/services-provider", labelAr: "مزود الخدمة (كلاسيكي)" },

  "customer-preview": { path: "/customer-preview", labelAr: "معاينة عميل (ملغاة)" },

};



const REDIRECT_ERROR_TYPES = new Set(["unknown_role", "failed_redirect", "unauthorized_portal"]);



function normPath(pathname) {

  let p = String(pathname || "")

    .trim()

    .split("?")[0]

    .split("#")[0];

  if (!p.startsWith("/")) p = "/" + p;

  return p.replace(/\.html$/i, "");

}



function isTransportServiceType(serviceType) {

  return isTransportPortalType(serviceType);

}



function isServiceOnlyType(serviceType) {

  const t = String(serviceType || "")

    .trim()

    .toLowerCase();

  if (!t) return false;

  if (isTransportServiceType(t)) return false;

  if (SERVICE_PORTAL_TYPES.has(t)) return true;

  return true;

}



function classifyUserRoleBucket(user) {

  return resolvePortalRole(user).portalRole;

}



function defaultPortalForBucket(bucket) {

  const { portalPathForRole: pathFor } = require("./resolvePortalRole");

  return pathFor(bucket);

}



function pathToPortalKey(pathname) {

  const p = normPath(pathname);

  for (const [key, def] of Object.entries(PORTAL_DEFINITIONS)) {

    if (def.paths.some((base) => p === base || p.startsWith(base + "/"))) return key;

  }

  return null;

}



function pathToLegacyKey(pathname) {

  const p = normPath(pathname);

  for (const [key, def] of Object.entries(LEGACY_ACCESS_KEYS)) {

    if (p === def.path || p.startsWith(def.path + "/")) return key;

  }

  return null;

}



function isPreviewPath(pathname) {

  const p = normPath(pathname);

  return Object.values(PREVIEW_PORTAL_KEYS).some((base) => p === base);

}



function isPlatformCustomerPath(pathname) {

  const p = normPath(pathname);

  return PLATFORM_CUSTOMER_PATHS.some((base) => p === base || p.startsWith(base + "/"));

}



function matchesProviderSegment(user, segment) {

  const seg = String(segment || "all").toLowerCase();

  const role = String(user?.role || "").toLowerCase();

  if (seg === "all") return role === "service";

  if (role !== "service") return false;

  const st = user?.service_type;

  if (seg === "transport") return isTransportServiceType(st);

  if (seg === "service") return isServiceOnlyType(st);

  return true;

}



module.exports = {

  TRANSPORT_SERVICE_TYPES: TRANSPORT_PORTAL_TYPES,

  SERVICE_ONLY_TYPES: SERVICE_PORTAL_TYPES,

  OPERATIONAL_PORTAL_ROLES,

  PORTAL_DEFINITIONS,

  PREVIEW_PORTAL_KEYS,

  PLATFORM_CUSTOMER_PATHS,

  CUSTOMER_PLATFORM_HOME,

  LEGACY_ACCESS_KEYS,

  REDIRECT_ERROR_TYPES,

  normPath,

  isTransportServiceType,

  isServiceOnlyType,

  classifyUserRoleBucket,

  defaultPortalForBucket,

  pathToPortalKey,

  pathToLegacyKey,

  isPreviewPath,

  isPlatformCustomerPath,

  matchesProviderSegment,

};

