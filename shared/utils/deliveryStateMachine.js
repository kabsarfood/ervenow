const { isValidDeliveryTransition } = require("./helpers");

/**
 * Explicit allowed map (documentation + defense in depth).
 * Aligns with deliveryLifecycleIndex: new/pending → accepted → delivering → delivered.
 */
const ALLOWED_DELIVERY_TRANSITIONS = {
  new: ["new", "pending", "accepted"],
  pending: ["pending", "accepted"],
  accepted: ["accepted", "delivering"],
  delivering: ["delivering", "delivered"],
  delivered: ["delivered"],
};

function normalizeStatus(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} from
 * @param {string} to
 */
function isAllowedDeliveryStatusTransition(from, to) {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  if (!t) return false;
  return isValidDeliveryTransition(f, t);
}

module.exports = {
  ALLOWED_DELIVERY_TRANSITIONS,
  isAllowedDeliveryStatusTransition,
};
