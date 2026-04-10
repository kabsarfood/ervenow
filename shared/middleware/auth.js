const jwt = require("jsonwebtoken");
const { createServiceClient } = require("../config/supabase");
const { extractBearer } = require("../utils/helpers");

const ROLES = ["driver", "customer", "admin", "restaurant", "merchant", "service"];

function getJwtSecret() {
  return process.env.ERWENOW_JWT_SECRET || "";
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

async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }

    const secret = getJwtSecret();
    if (!secret) {
      return res.status(503).json({ ok: false, error: "ERWENOW_JWT_SECRET غير مضبوط" });
    }

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

    req.supabase = sb;
    req.authUser = { id: sub, phone };
    req.appUser = { id: sub, phone, role };
    next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Auth error" });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) return next();

    const secret = getJwtSecret();
    if (!secret) return next();

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
  } catch {
    next();
  }
}

module.exports = { requireAuth, optionalAuth, ROLES, getJwtSecret };
