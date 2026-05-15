const { completeServiceBooking } = require("./completeServiceBooking");

/** @deprecated استخدم completeServiceBooking — يُبقى للتوافق */
async function completeGasServiceBooking(sb, bookingId, providerId) {
  return completeServiceBooking(sb, bookingId, providerId);
}

module.exports = { completeGasServiceBooking, completeServiceBooking };
