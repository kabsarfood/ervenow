const { fail } = require("../utils/helpers");
const {
  isPublicOrderingEnabled,
  isInternalOrderingAllowed,
  SERVICE_NOT_LAUNCHED,
  SERVICE_NOT_LAUNCHED_AR,
} = require("../utils/publicOrdering");

function denyUnlessPublicOrdering(req, res, next) {
  if (isPublicOrderingEnabled()) return next();
  if (isInternalOrderingAllowed(req)) return next();
  return fail(res, SERVICE_NOT_LAUNCHED_AR, 403, {
    reason: SERVICE_NOT_LAUNCHED,
    public_ordering: false,
  });
}

module.exports = { denyUnlessPublicOrdering };
