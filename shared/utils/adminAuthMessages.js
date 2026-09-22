const ADMIN_LOGIN_PATH = "/admin-login";
const ADMIN_DASHBOARD_PATH = "/admin-dashboard";
const ADMIN_LOGIN_REQUIRED_CODE = "ADMIN_LOGIN_REQUIRED";
const ADMIN_LOGIN_REQUIRED_AR = "هذا حساب إداري. يرجى استخدام بوابة الإدارة.";
const ADMIN_NOT_AUTHORIZED_AR = "هذا الرقم غير مصرح له بالدخول إلى لوحة الإدارة.";

function adminLoginRequiredExtra() {
  return {
    code: ADMIN_LOGIN_REQUIRED_CODE,
    admin_login_required: true,
    admin_login_path: ADMIN_LOGIN_PATH,
  };
}

function isAdminDbRole(role) {
  return String(role || "").trim().toLowerCase() === "admin";
}

module.exports = {
  ADMIN_LOGIN_PATH,
  ADMIN_DASHBOARD_PATH,
  ADMIN_LOGIN_REQUIRED_CODE,
  ADMIN_LOGIN_REQUIRED_AR,
  ADMIN_NOT_AUTHORIZED_AR,
  adminLoginRequiredExtra,
  isAdminDbRole,
};
