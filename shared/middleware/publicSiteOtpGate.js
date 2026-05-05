/**
 * بوابة OTP للواجهة العامة (صفحات HTML فقط — مسارات /api/* لا تُعرقل هنا).
 *
 * أ) نطاق إنتاج محدد:
 *    PUBLIC_SITE_OTP_GATE=1
 *    PUBLIC_SITE_OTP_GATE_HOSTS=… (أو يُستنتج من ERVENOW_PUBLIC_URL)
 *    محلياً: PUBLIC_SITE_OTP_GATE_LOCAL=1
 *
 * ب) وضع خاص مؤقت — الموقع كامل على أي مضيف:
 *    ERVENOW_PRIVATE_OTP_GATE=1
 *    أو للتجربة السريعة بدون .env: عيّن FORCE_PRIVATE_OTP_GATE أدناه إلى true (لا تُشحن للإنتاج بهذا الشكل).
 */

const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./auth");

const COOKIE_NAME = "ervenow_site";
/** كوكي اختياري يُعرّفه العميل بعد verify-otp — يُقبل مع ervenow_site في البوابة */
const ALT_COOKIE_NAME = "auth_token";

/** ⚠️ للتطوير المحلي فقط — للإنتاج استخدم ERVENOW_PRIVATE_OTP_GATE=1 */
const FORCE_PRIVATE_OTP_GATE = false;

function isPrivateOtpGate() {
  if (FORCE_PRIVATE_OTP_GATE) return true;
  return String(process.env.ERVENOW_PRIVATE_OTP_GATE || "").trim() === "1";
}

function isGateEnabled() {
  return String(process.env.PUBLIC_SITE_OTP_GATE || "").trim() === "1";
}

function allowLocalhostGate() {
  return String(process.env.PUBLIC_SITE_OTP_GATE_LOCAL || "").trim() === "1";
}

function getGateHostnames() {
  const raw = String(process.env.PUBLIC_SITE_OTP_GATE_HOSTS || "").trim().toLowerCase();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().split(":")[0])
      .filter(Boolean);
  }
  try {
    const u = new URL(String(process.env.ERVENOW_PUBLIC_URL || "").trim());
    const h = u.hostname.toLowerCase();
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      const apex = h.startsWith("www.") ? h.slice(4) : h;
      const www = h.startsWith("www.") ? h : `www.${h}`;
      return [...new Set([h, apex, www].filter(Boolean))];
    }
  } catch (_) {
    /* ignore */
  }
  return ["ervenow.com", "www.ervenow.com"];
}

function isGateHostname(hostname) {
  const h = String(hostname || "").trim().toLowerCase().split(":")[0];
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1") return allowLocalhostGate();
  const list = getGateHostnames();
  return list.some((x) => x === h);
}

/** البوابة نشطة لهذا الطلب (وضع خاص أو إعداد النطاق الإنتاجي) */
function gateActiveForRequest(req) {
  if (isPrivateOtpGate()) return true;
  return isGateEnabled() && isGateHostname(req.hostname);
}

function shouldAttachSiteCookie(req) {
  if (isPrivateOtpGate()) return true;
  return isGateEnabled() && isGateHostname(req.hostname);
}

function getCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  const parts = String(h).split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return null;
}

function getSiteGateSessionToken(req) {
  return getCookie(req, COOKIE_NAME) || getCookie(req, ALT_COOKIE_NAME);
}

function appendClearCookie(res, name, httpOnly) {
  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  let s = `${name}=; Path=/; SameSite=Lax; Max-Age=0`;
  if (httpOnly) s += "; HttpOnly";
  if (secure) s += "; Secure";
  res.append("Set-Cookie", s);
}

function attachSiteSessionCookie(req, res, token) {
  if (!shouldAttachSiteCookie(req) || !token) return;
  const maxAgeSec = 7 * 24 * 60 * 60;
  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const val = encodeURIComponent(String(token));
  const parts = [`${COOKIE_NAME}=${val}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearSiteSessionCookie(req, res) {
  if (!shouldAttachSiteCookie(req)) return;
  appendClearCookie(res, COOKIE_NAME, true);
  appendClearCookie(res, ALT_COOKIE_NAME, false);
}

const STATIC_EXT = /\.(css|js|mjs|map|ico|png|jpe?g|gif|webp|svg|woff2?|ttf|eot|otf|json|txt|xml)$/i;

function isBypassPath(p) {
  const path = String(p || "").split("?")[0] || "/";
  if (path.startsWith("/assets/")) return true;
  if (path.startsWith("/socket.io/")) return true;
  if (path.startsWith("/delivery/")) return true;
  if (STATIC_EXT.test(path)) return true;
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/manifest.json" || path === "/site.webmanifest") {
    return true;
  }
  const lower = path.toLowerCase();
  if (lower === "/login" || lower === "/driver-login" || lower === "/admin-login") return true;
  return false;
}

function verifySiteCookieToken(token) {
  if (!token) return false;
  try {
    jwt.verify(String(token), getJwtSecret());
    return true;
  } catch {
    return false;
  }
}

/**
 * يُركّب بعد مسارات /api/* وقبل الواجهة الثابتة.
 * @param {boolean} servePublicUi — عند false لا تُطبَّق البوابة (وضع API فقط).
 */
function createPublicSiteOtpGate(servePublicUi) {
  return function publicSiteOtpGate(req, res, next) {
    if (!servePublicUi) return next();
    if (!gateActiveForRequest(req)) return next();
    try {
      getJwtSecret();
    } catch {
      console.warn("[publicSiteOtpGate] ERVENOW_JWT_SECRET غير مضبوط — تُعطّل البوابة");
      return next();
    }
    const m = req.method;
    if (m === "OPTIONS") return next();
    if (m !== "GET" && m !== "HEAD") return next();
    const p = String(req.path || "/").split("?")[0] || "/";
    if (p.startsWith("/api/")) return next();
    if (isBypassPath(p)) return next();
    const tok = getSiteGateSessionToken(req);
    if (verifySiteCookieToken(tok)) return next();
    const nextUrl = String(req.originalUrl || req.url || "/");
    const safe = nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : "/";
    return res.redirect(302, "/login?next=" + encodeURIComponent(safe));
  };
}

module.exports = {
  COOKIE_NAME,
  ALT_COOKIE_NAME,
  isGateEnabled,
  isGateHostname,
  isPrivateOtpGate,
  gateActiveForRequest,
  shouldAttachSiteCookie,
  attachSiteSessionCookie,
  clearSiteSessionCookie,
  createPublicSiteOtpGate,
};
