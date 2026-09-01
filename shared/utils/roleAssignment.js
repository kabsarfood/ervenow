/**
 * P0 — تعيين الأدوار من الخادم فقط.
 * لا يُوثق بأي role قادم من الواجهة لترقية الحساب.
 */

const SENSITIVE_ROLES = Object.freeze(["admin"]);

/** أدوار يُسمح بطلبها عند التسجيل الذاتي (تبقى pending حتى اعتماد الإدارة ما عدا customer حسب سياسة الحساب) */
const SELF_SERVICE_SIGNUP_ROLES = Object.freeze([
  "customer",
  "driver",
  "store",
  "restaurant",
  "merchant",
  "service",
]);

const ROLE_ALIASES = Object.freeze({
  user: "customer",
  provider: "service",
  transport: "service",
});

function normalizeRequestedRole(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "customer";
  if (Object.prototype.hasOwnProperty.call(ROLE_ALIASES, s)) return ROLE_ALIASES[s];
  return s;
}

function isSensitiveRole(role) {
  return SENSITIVE_ROLES.includes(normalizeRequestedRole(role));
}

function isSelfServiceSignupRole(role) {
  return SELF_SERVICE_SIGNUP_ROLES.includes(normalizeRequestedRole(role));
}

/**
 * تسجيل ذاتي: يرفض admin وأي دور غير معروف يُحوَّل إلى customer.
 * @returns {{ ok: true, role: string, coerced?: boolean } | { ok: false, status: number, message: string, role: null }}
 */
function resolveSelfServiceSignupRole(requested) {
  const role = normalizeRequestedRole(requested);
  if (isSensitiveRole(role)) {
    return {
      ok: false,
      status: 403,
      role: null,
      message: "لا يمكن إنشاء أو ترقية حساب إداري من الطلب الذاتي",
    };
  }
  if (!isSelfServiceSignupRole(role)) {
    return { ok: true, role: "customer", coerced: true };
  }
  return { ok: true, role };
}

/** أي جسم يحتوي role من العميل يُرفض — المزامنة لا تكتب الدور أبداً */
function denyClientRolePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!Object.prototype.hasOwnProperty.call(body, "role")) return null;
  return {
    status: 403,
    message: "لا يمكن تعيين الدور من العميل",
  };
}

function existingUserSessionRole(existingRole) {
  const r = normalizeRequestedRole(existingRole || "customer");
  return r || "customer";
}

/** دخول أدمن: رقم في قائمة البيئة + صف users.role=admin مسبقاً */
function canAdminOtpLogin(existingUser, phoneOnAllowlist) {
  if (!phoneOnAllowlist) return false;
  if (!existingUser || !existingUser.id) return false;
  return existingUserSessionRole(existingUser.role) === "admin";
}

module.exports = {
  SENSITIVE_ROLES,
  SELF_SERVICE_SIGNUP_ROLES,
  ROLE_ALIASES,
  normalizeRequestedRole,
  isSensitiveRole,
  isSelfServiceSignupRole,
  resolveSelfServiceSignupRole,
  denyClientRolePayload,
  existingUserSessionRole,
  canAdminOtpLogin,
};
