const {
  canPlaceOrders,
  canAccessDriverDispatchQueue,
  driverOrderPlacementError,
  customerDriverQueueError,
} = require("../utils/platformAccessPolicy");
const { fail } = require("../utils/helpers");

function denyUnlessCanPlaceOrders(req, res, next) {
  const role = req.appUser && req.appUser.role;
  if (!canPlaceOrders(role)) {
    return fail(res, driverOrderPlacementError(), 403);
  }
  next();
}

function denyUnlessDriverDispatch(req, res, next) {
  const role = req.appUser && req.appUser.role;
  if (!canAccessDriverDispatchQueue(role)) {
    return fail(res, customerDriverQueueError(), 403);
  }
  next();
}

module.exports = {
  denyUnlessCanPlaceOrders,
  denyUnlessDriverDispatch,
};
