/**
 * سياسة صلاحيات ERVENOW
 * — الأدمن: صلاحية مطلقة
 * — زائر المنصة (customer/user): كل خدمات المنصة؛ لا لوحة إدارة؛ لا طابور مندوبين
 * — المندوب: تصفح فقط + طلبات المنصة والرصيد والسحب في صفحات المندوب
 */

const ROLES = {
  ADMIN: "admin",
  VISITOR: "customer",
  DRIVER: "driver",
};

function normalizeRole(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  if (r === "user") return ROLES.VISITOR;
  if (r === "provider") return "service";
  return r || ROLES.VISITOR;
}

function isAdmin(role) {
  return normalizeRole(role) === ROLES.ADMIN;
}

function isPlatformVisitor(role) {
  const r = normalizeRole(role);
  return r === ROLES.VISITOR || r === "customer";
}

function isDriver(role) {
  return normalizeRole(role) === ROLES.DRIVER;
}

/** إنشاء طلبات / سلة / حجز خدمة */
function canPlaceOrders(role) {
  const r = normalizeRole(role);
  if (isAdmin(r)) return true;
  if (isDriver(r)) return false;
  return true;
}

function canAccessAdminPanel(role) {
  return isAdmin(role);
}

/** قائمة طلبات المندوبين (شاشة /orders) */
function canAccessDriverDispatchQueue(role) {
  const r = normalizeRole(role);
  return r === ROLES.DRIVER || r === ROLES.ADMIN;
}

/** تصفح الأقسام العامة */
function canBrowsePlatform(role) {
  return true;
}

function driverOrderPlacementError() {
  return "حساب المندوب للتصفح واستلام الطلبات فقط — لا يمكن إنشاء طلبات من المنصة.";
}

function customerDriverQueueError() {
  return "طابور طلبات المندوبين غير متاح لزائر المنصة.";
}

function nonAdminPanelError() {
  return "لوحة الإدارة للمدير فقط.";
}

function accessFlagsForRole(role) {
  const r = normalizeRole(role);
  return {
    role: r,
    is_admin: isAdmin(r),
    is_platform_visitor: isPlatformVisitor(r),
    is_driver: isDriver(r),
    can_place_orders: canPlaceOrders(r),
    can_access_admin: canAccessAdminPanel(r),
    can_access_driver_dispatch: canAccessDriverDispatchQueue(r),
    can_browse_platform: canBrowsePlatform(r),
  };
}

module.exports = {
  ROLES,
  normalizeRole,
  isAdmin,
  isPlatformVisitor,
  isDriver,
  canPlaceOrders,
  canAccessAdminPanel,
  canAccessDriverDispatchQueue,
  canBrowsePlatform,
  driverOrderPlacementError,
  customerDriverQueueError,
  nonAdminPanelError,
  accessFlagsForRole,
};
