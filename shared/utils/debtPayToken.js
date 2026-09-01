/**
 * روابط سداد الدين — HMAC حتى لا يكفي تخمين uuid.
 * الصفحة العامة /pay تعمل فقط بتوكن موقّع (أو جلسة المالك/الأدمن).
 */

const crypto = require("crypto");

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function tokenSecret() {
  return String(
    process.env.ERVENOW_DEBT_PAY_SECRET ||
      process.env.ERVENOW_JWT_SECRET ||
      process.env.ERWENOW_JWT_SECRET ||
      ""
  ).trim();
}

function signPayload(payload) {
  const secret = tokenSecret();
  if (!secret || secret.length < 16) return null;
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function createDebtPayToken(userId, ttlMs = TOKEN_TTL_MS) {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const exp = Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : TOKEN_TTL_MS);
  const payload = `${uid}.${exp}`;
  const mac = signPayload(payload);
  if (!mac) return null;
  return Buffer.from(`${payload}.${mac}`, "utf8").toString("base64url");
}

function verifyDebtPayToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  let decoded;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch (_e) {
    return { ok: false, reason: "malformed" };
  }
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot <= 0) return { ok: false, reason: "malformed" };
  const payload = decoded.slice(0, lastDot);
  const mac = decoded.slice(lastDot + 1);
  const expected = signPayload(payload);
  if (!expected || mac.length !== expected.length) return { ok: false, reason: "bad_sig" };
  if (!crypto.timingSafeEqual(Buffer.from(mac, "utf8"), Buffer.from(expected, "utf8"))) {
    return { ok: false, reason: "bad_sig" };
  }
  const parts = payload.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const uid = String(parts[0] || "").trim();
  const exp = Number(parts[1]);
  if (!uid || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (Date.now() > exp) return { ok: false, reason: "expired" };
  return { ok: true, userId: uid, exp };
}

module.exports = {
  TOKEN_TTL_MS,
  tokenSecret,
  createDebtPayToken,
  verifyDebtPayToken,
};
