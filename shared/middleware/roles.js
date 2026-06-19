const { fail } = require("../utils/helpers");
const { isTransportPortalType, isServicePortalType } = require("../utils/resolvePortalRole");

function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.appUser?.role;
    if (!role) return fail(res, "Profile required", 403);
    if (!allowed.includes(role)) {
      return fail(res, "Insufficient role", 403, { need: allowed, have: role });
    }
    next();
  };
}

/** مزوّد خدمة/نقل — role=service أو driver مع service_type معرّف */
function requireServiceProviderRole() {
  return async (req, res, next) => {
    const role = String(req.appUser?.role || "").toLowerCase();
    if (role === "admin") return next();
    if (role === "service") return next();
    if (role === "driver") {
      const sb = req.supabase;
      if (!sb || !req.appUser?.id) return fail(res, "Profile required", 403);
      try {
        const { data, error } = await sb
          .from("users")
          .select("service_type")
          .eq("id", req.appUser.id)
          .maybeSingle();
        if (error) return fail(res, error.message, 400);
        const st = String(data?.service_type || "").toLowerCase();
        if (st && (isTransportPortalType(st) || isServicePortalType(st))) return next();
      } catch (e) {
        return fail(res, e.message || "خطأ", 500);
      }
    }
    return fail(res, "Insufficient role", 403, { need: ["service", "driver+provider"], have: role });
  };
}

function requireServiceProviderOrAdmin() {
  return (req, res, next) => {
    if (String(req.appUser?.role || "").toLowerCase() === "admin") return next();
    return requireServiceProviderRole()(req, res, next);
  };
}

module.exports = { requireRole, requireServiceProviderRole, requireServiceProviderOrAdmin };
