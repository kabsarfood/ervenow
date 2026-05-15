const { PLATFORM_COMMISSION_RATE } = require("../utils/platformCommission");

async function recordCommissionDebtOnDelivered(sb, booking, providerId) {
  if (!sb || !booking || !providerId) return null;
  const commission = Number(booking.platform_commission) || 0;
  if (commission <= 0) return null;

  const { data: existing } = await sb
    .from("provider_commission_debts")
    .select("id")
    .eq("booking_id", booking.id)
    .maybeSingle();

  if (existing && existing.id) return existing;

  const rate = PLATFORM_COMMISSION_RATE;
  const row = {
    booking_id: booking.id,
    provider_id: providerId,
    service_order_number: booking.service_order_number || null,
    service_type: booking.service_type || null,
    service_name: booking.service_name || null,
    customer_phone: booking.customer_phone || null,
    total_amount: Number(booking.total_amount) || 0,
    commission_amount: commission,
    commission_rate: rate,
    status: "pending",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from("provider_commission_debts").insert(row).select("*").single();
  if (error) {
    if (/does not exist|schema cache|relation/i.test(String(error.message || ""))) {
      console.warn("[providerCommissionDebts] table missing — run migration_gas_service_and_debts.sql");
      return null;
    }
    throw error;
  }

  try {
    await sb
      .from("service_bookings")
      .update({ commission_settled: false, updated_at: new Date().toISOString() })
      .eq("id", booking.id);
  } catch (_) {
    /* optional column */
  }

  return data;
}

module.exports = { recordCommissionDebtOnDelivered };
