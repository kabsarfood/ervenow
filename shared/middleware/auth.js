const jwt = require("jsonwebtoken");
const { createServiceClient } = require("../config/supabase");
const { extractBearer } = require("../utils/helpers");

const ROLES = ["driver", "customer", "admin", "restaurant", "merchant", "service", "user"];

/**
 * يدعم الاسم الصحيح ERVENOW_JWT_SECRET والاسم القديم ERWENOW_JWT_SECRET للتوافق.
 */
function getJwtSecret() {
  const JWT_SECRET = String(
    process.env.ERVENOW_JWT_SECRET || process.env.ERWENOW_JWT_SECRET || ""
  ).trim();
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  return JWT_SECRET;
}

function requireServiceSupabase(res) {
  const sb = createServiceClient();
  if (!sb) {
    res.status(503).json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY مطلوب للمصادقة عبر المنصة",
    });
    return null;
  }
  return sb;
}

function isBlockedAllowedPath(req) {
  const fullPath = String((req.baseUrl || "") + (req.path || "")).toLowerCase();
  if (fullPath === "/api/core/me") return true;
  if (fullPath === "/api/delivery/complaints") return true;
  if (fullPath === "/api/delivery/complaints/mine") return true;
  return false;
}

function isMissingStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

function isMissingNameColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.name|column .*name.* does not exist|Could not find the .*name/i.test(msg);
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }

    const secret = getJwtSecret();

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid or expired session" });
    }

    const sub = payload.sub;
    const phone = payload.phone || null;
    const role = payload.role || "customer";

    if (!sub) {
      return res.status(401).json({ ok: false, error: "Invalid token payload" });
    }

    const sb = requireServiceSupabase(res);
    if (!sb) return;

    let effectiveRole = role;
    let effectiveStatus = "active";
    let displayName = null;
    try {
      let dbUser = null;
      let withStatus = await sb
        .from("users")
        .select("id, role, status, phone, name")
        .eq("id", sub)
        .maybeSingle();
      if (withStatus.error && isMissingNameColumnError(withStatus.error)) {
        withStatus = await sb
          .from("users")
          .select("id, role, status, phone")
          .eq("id", sub)
          .maybeSingle();
      }
      if (withStatus.error && isMissingStatusColumnError(withStatus.error)) {
        let fallback = await sb
          .from("users")
          .select("id, role, phone, name")
          .eq("id", sub)
          .maybeSingle();
        if (fallback.error && isMissingNameColumnError(fallback.error)) {
          fallback = await sb.from("users").select("id, role, phone").eq("id", sub).maybeSingle();
        }
        if (!fallback.error) dbUser = fallback.data || null;
      } else if (!withStatus.error) {
        dbUser = withStatus.data || null;
      }
      if (dbUser) {
        if (dbUser.role) effectiveRole = dbUser.role;
        if (dbUser.status) effectiveStatus = dbUser.status;
        if (dbUser.phone) req.authUser = { id: sub, phone: dbUser.phone };
        if (dbUser.name != null && String(dbUser.name).trim()) displayName = String(dbUser.name).trim();
      }
    } catch (_e) {}

    if (String(effectiveStatus || "").toLowerCase() === "blocked" && !isBlockedAllowedPath(req)) {
      return res.status(403).json({ ok: false, error: "الحساب محظور من الإدارة" });
    }

    // backward compatibility for transitional roles
    if (String(effectiveRole || "").toLowerCase() === "user") {
      effectiveRole = "customer";
    }

    req.supabase = sb;
    req.authUser = req.authUser || { id: sub, phone };
    req.appUser = {
      id: sub,
      phone: req.authUser.phone,
      role: effectiveRole,
      status: effectiveStatus,
      ...(displayName ? { name: displayName } : {}),
    };
    next();
  } catch (e) {
    console.error("[requireAuth]", e);
    if (
      e &&
      (e.message === "JWT_SECRET is not set" ||
        String(e.message || "").includes("JWT_SECRET"))
    ) {
      return res.status(503).json({
        ok: false,
        error: "ERVENOW_JWT_SECRET غير مضبوط في بيئة الخادم",
      });
    }
    if (process.env.NODE_ENV === "production") {
      return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    }
    return res.status(500).json({ ok: false, error: e.message || "Auth error" });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) return next();

    let secret;
    try {
      secret = getJwtSecret();
    } catch (e) {
      return next(e);
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return next();
    }

    const sb = createServiceClient();
    if (!sb) return next();

    req.supabase = sb;
    req.authUser = { id: payload.sub, phone: payload.phone || null };
    req.appUser = {
      id: payload.sub,
      phone: payload.phone || null,
      role: payload.role || "customer",
    };
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { requireAuth, optionalAuth, ROLES, getJwtSecret };

