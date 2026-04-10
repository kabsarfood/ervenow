const { fail } = require("../utils/helpers");

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

module.exports = { requireRole };
