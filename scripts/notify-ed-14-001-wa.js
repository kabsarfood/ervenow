require("dotenv").config();
const { createServiceClient } = require("../shared/config/supabase");
const { notifyCarTransportProviders, getCarTransportProviderPhones } = require("../shared/services/carTransportNotify");

(async () => {
  const sb = createServiceClient();
  if (!sb) {
    console.error("no service client");
    process.exit(1);
  }
  const { data: order, error } = await sb.from("orders").select("*").eq("order_number", "ED-14-001").single();
  if (error) {
    console.error("order err", error.message);
    process.exit(1);
  }
  const phones = await getCarTransportProviderPhones(sb, order);
  console.log("phones", phones);
  if (phones.length) {
    await notifyCarTransportProviders(sb, order);
    console.log("sent");
  }
})().catch((e) => console.error(e));
