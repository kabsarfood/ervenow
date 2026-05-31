/**
 * حالة اعتماد حسابات users (زائر / مزود / تاجر عبر OTP).
 * pending = غير معتمد · active = معتمد · rejected = مرفوض · blocked = محظور
 */

const APPROVED_STATUSES = new Set(["active"]);
const PENDING_STATUSES = new Set(["pending"]);
const REJECTED_STATUSES = new Set(["rejected"]);

/** مسارات API مسموحة لحساب pending (بدون جلسة كاملة) */
const PENDING_AUTH_ALLOWED_PATHS = new Set([
  "/api/core/me",
  "/api/core/public-config",
  "/api/core/platform-branding",
  "/api/core/platform-offers",
  "/api/core/wallet-pay-settings",
  "/api/core/checkout-payment-methods",
  "/api/core/settings",
]);

function rawStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function normalizeAccountStatus(status, role) {
  const st = rawStatus(status);
  if (st) return st;
  const r = String(role || "").trim().toLowerCase();
  if (r === "blocked") return "blocked";
  if (r === "admin") return "active";
  /* حسابات قديمة بدون عمود status — تُعتبر معتمدة حتى يُحدَّث صريحاً */
  return "active";
}

function isUserAccountApproved(status, role) {
  const st = rawStatus(status);
  const r = String(role || "").trim().toLowerCase();
  if (r === "blocked" || st === "blocked" || st === "rejected" || st === "pending") return false;
  if (st === "active") return true;
  if (r === "admin") return true;
  return true;
}

function isUserAccountPending(status) {
  return rawStatus(status) === "pending";
}

function isUserAccountRejected(status) {
  return rawStatus(status) === "rejected";
}

function accountApprovedFlag(status, role) {
  return isUserAccountApproved(status, role);
}

function isPendingAuthAllowedPath(req) {
  const fullPath = String((req.baseUrl || "") + (req.path || "")).toLowerCase();
  return PENDING_AUTH_ALLOWED_PATHS.has(fullPath);
}

function pendingApprovalErrorPayload() {
  return {
    ok: false,
    error: "يتم تفعيل الحساب بعد المراجعة واعتماده من إدارة ERVENOW.",
    pending_approval: true,
    approved: false,
  };
}

function roleLabelAr(role, serviceType) {
  const r = String(role || "").toLowerCase();
  if (r === "customer" || r === "user") return "متسوق";
  if (r === "merchant" || r === "restaurant") return "متجر";
  if (r === "service") {
    const st = String(serviceType || "").trim();
    return st ? `مزود خدمة (${st})` : "مزود خدمة";
  }
  if (r === "driver") return "مندوب";
  if (r === "admin") return "إدارة";
  return r || "—";
}

module.exports = {
  APPROVED_STATUSES,
  PENDING_STATUSES,
  PENDING_AUTH_ALLOWED_PATHS,
  normalizeAccountStatus,
  isUserAccountApproved,
  isUserAccountPending,
  isUserAccountRejected,
  accountApprovedFlag,
  isPendingAuthAllowedPath,
  pendingApprovalErrorPayload,
  roleLabelAr,
};
