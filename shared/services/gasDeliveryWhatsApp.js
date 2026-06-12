const { notifyGasDeliveryProviders } = require("./gasDeliveryNotify");

async function sendGasProviderWhatsApp(sb, booking) {
  if (!booking) return;
  await notifyGasDeliveryProviders(sb, booking);
}

module.exports = { sendGasProviderWhatsApp };
