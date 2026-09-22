/**
 * سياق تسجيل عام بعد OTP ناجح لرقم غير مسجّل.
 * ليس جلسة مستخدم — لا يمرّر requireAuth.
 */
const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("../middleware/auth");
const { extractBearer } = require("./helpers");

const REGISTER_PURPOSE = "ervenow_register";
const REGISTER_TTL = "30m";

function signRegistrationToken(phoneDigits) {
  const phone = String(phoneDigits || "").replace(/\D/g, "");
  if (!phone) throw new Error("registration phone required");
  return jwt.sign({ purpose: REGISTER_PURPOSE, phone, sub: "reg:" + phone }, getJwtSecret(), {
    expiresIn: REGISTER_TTL,
  });
}

function verifyRegistrationToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, error: "missing" };
  try {
    const payload = jwt.verify(raw, getJwtSecret());
    if (payload.purpose !== REGISTER_PURPOSE || !payload.phone) {
      return { ok: false, error: "invalid_purpose" };
    }
    return { ok: true, phone: String(payload.phone).replace(/\D/g, "") };
  } catch {
    return { ok: false, error: "invalid_or_expired" };
  }
}

function readRegistrationTokenRaw(req) {
  const body = req && req.body && typeof req.body === "object" ? req.body : {};
  const fromBody = String(body.registration_token || body.registrationToken || "").trim();
  if (fromBody) return fromBody;
  const q = req && req.query && typeof req.query === "object" ? req.query : {};
  const fromQuery = String(q.registration_token || q.registrationToken || "").trim();
  if (fromQuery) return fromQuery;
  const header = String((req && req.get && req.get("x-ervenow-register-token")) || "").trim();
  if (header) return header;
  const bearer = extractBearer(req);
  if (bearer) {
    const check = verifyRegistrationToken(bearer);
    if (check.ok) return bearer;
  }
  return "";
}

function requireVerifiedRegistration(req, res) {
  const { fail } = require("./helpers");
  const raw = readRegistrationTokenRaw(req);
  const got = verifyRegistrationToken(raw);
  if (!got.ok) {
    fail(res, "وثّق رقم الجوال من بوابة الدخول أولاً.", 403, {
      registration_required: true,
      code: "REGISTRATION_CONTEXT_REQUIRED",
    });
    return null;
  }
  return { phone: got.phone, token: raw };
}

module.exports = {
  REGISTER_PURPOSE,
  signRegistrationToken,
  verifyRegistrationToken,
  readRegistrationTokenRaw,
  requireVerifiedRegistration,
};
