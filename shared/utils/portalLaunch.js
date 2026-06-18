/**

 * حالة إطلاق البوابات التشغيلية — ERVENOW

 * البوابات الرسمية: merchant · driver · service · transport

 * العميل → المنصة الرئيسية · الإدارة → Admin Console (خارج Portal Framework)

 */



/** @type {readonly string[]} */

const OPERATIONAL_PORTAL_ROLES = ["merchant", "driver", "service", "transport"];



const CUSTOMER_PLATFORM_HOME = "/start-now.html";

const ADMIN_CONSOLE_PATH = "/admin-dashboard";



const OPERATIONAL_PORTAL_PATHS = {

  merchant: "/merchant-preview",

  driver: "/driver-preview",

  service: "/service-preview",

  transport: "/transport-preview",

};



/** مسارات المعاينة/الإنتاج للبوابات التشغيلية فقط (توافق خلفي) */

const PORTAL_PREVIEW_PATHS = Object.assign({}, OPERATIONAL_PORTAL_PATHS);



/** @type {Record<string, boolean>} */

const PORTAL_LIVE = {

  service: true,

  transport: true,

  driver: true,

  merchant: true,

};



const PORTAL_LEGACY_PATHS = {

  driver: "/driver",

  merchant: "/store-dashboard",

};



/** مسار قديم — يُعاد توجيهه إلى المنصة الرئيسية */

const DEPRECATED_CUSTOMER_PORTAL_PATH = "/customer-preview";



function isOperationalPortal(portalRole) {

  return OPERATIONAL_PORTAL_ROLES.includes(String(portalRole || "").toLowerCase());

}



function portalPreviewPathForRole(portalRole) {

  const r = String(portalRole || "customer").toLowerCase();

  if (r === "customer") return CUSTOMER_PLATFORM_HOME;

  if (r === "admin") return ADMIN_CONSOLE_PATH;

  return OPERATIONAL_PORTAL_PATHS[r] || CUSTOMER_PLATFORM_HOME;

}



/** مسار ما بعد تسجيل الدخول — بوابة تشغيلية أو منصة أو أدمن */

function portalPathForRole(portalRole) {

  const r = String(portalRole || "customer").toLowerCase();

  if (r === "customer") return CUSTOMER_PLATFORM_HOME;

  if (r === "admin") return ADMIN_CONSOLE_PATH;

  if (PORTAL_LIVE[r] !== false) {

    return portalPreviewPathForRole(r);

  }

  return PORTAL_LEGACY_PATHS[r] || portalPreviewPathForRole(r);

}



function isPortalLive(portalRole) {

  const r = String(portalRole || "").toLowerCase();

  if (!isOperationalPortal(r)) return false;

  return PORTAL_LIVE[r] !== false;

}



module.exports = {

  OPERATIONAL_PORTAL_ROLES,

  CUSTOMER_PLATFORM_HOME,

  ADMIN_CONSOLE_PATH,

  DEPRECATED_CUSTOMER_PORTAL_PATH,

  OPERATIONAL_PORTAL_PATHS,

  PORTAL_PREVIEW_PATHS,

  PORTAL_LIVE,

  PORTAL_LEGACY_PATHS,

  isOperationalPortal,

  portalPreviewPathForRole,

  portalPathForRole,

  isPortalLive,

};

