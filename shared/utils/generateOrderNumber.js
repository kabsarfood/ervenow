function generateOrderNumber(prefix = "ED") {
  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");

  const random = Math.floor(100 + Math.random() * 900);

  return `${prefix}-${day}-${random}`;
}

const MAX_ALLOC_ATTEMPTS = 50;

async function allocateUniqueOrderNumber(sb, prefix = "ED") {
  for (let attempt = 0; attempt < MAX_ALLOC_ATTEMPTS; attempt += 1) {
    const order_number = generateOrderNumber(prefix);
    const { data } = await sb.from("orders").select("id").eq("order_number", order_number).maybeSingle();
    if (!data) return order_number;
  }
  throw new Error("allocateUniqueOrderNumber: exhausted retries");
}

async function allocateUniqueServiceOrderNumber(sb, prefix = "SV") {
  for (let attempt = 0; attempt < MAX_ALLOC_ATTEMPTS; attempt += 1) {
    const service_order_number = generateOrderNumber(prefix);
    const { data } = await sb
      .from("service_bookings")
      .select("id")
      .eq("service_order_number", service_order_number)
      .maybeSingle();
    if (!data) return service_order_number;
  }
  throw new Error("allocateUniqueServiceOrderNumber: exhausted retries");
}

module.exports = { generateOrderNumber, allocateUniqueOrderNumber, allocateUniqueServiceOrderNumber };
