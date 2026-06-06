const { isValidDeliveryTransition } = require("./helpers");

/**
 * Explicit allowed map (documentation + defense in depth).
 * Aligns with helpers.isValidDeliveryTransition: draft → pending؛ new/pending → accepted → picked? → delivering → delivered.
 */
const ALLOWED_DELIVERY_TRANSITIONS = {
  draft: ["draft", "pending"],
  new: ["new", "pending", "accepted"],
  pending: ["pending", "accepted"],
  accepted: ["accepted", "preparing", "delivering", "delivered"],
  preparing: ["preparing", "ready"],
  ready: ["ready", "picked_up", "delivering"],
  picked_up: ["picked_up", "delivering", "delivered"],
  picked: ["picked", "delivering", "delivered"],
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
