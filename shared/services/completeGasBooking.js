const { recordCommissionDebtOnDelivered } = require("./providerCommissionDebts");

/**
 * إتمام طلب غاز (service_bookings) — status completed/delivered + commission_due
 */
async function completeGasServiceBooking(sb, bookingId, providerId) {
  const id = String(bookingId || "").trim();
  if (!id) return { data: null, error: new Error("id required") };

  const patch = {
    status: "delivered",
    updated_at: new Date().toISOString(),
    commission_settled: false,
  };
  if (providerId) patch.provider_id = providerId;

  let q = sb.from("service_bookings").update(patch).eq("id", id);
  if (providerId) {
    /* allow any service provider for gas type when provider_id set on accept */
  }

  const { data, error } = await q.select("*").single();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not found") };
  if (String(data.service_type || "").toLowerCase() !== "gas_delivery") {
    return { data: null, error: new Error("not a gas booking") };
  }

  const pid = providerId || data.provider_id;
  if (pid) {
    try {
      await recordCommissionDebtOnDelivered(sb, data, pid);
    } catch (debtErr) {
      console.error("[completeGasBooking] debt:", debtErr && (debtErr.message || debtErr));
    }
  }

  try {
    await sb
      .from("service_bookings")
      .update({ commission_due: true, updated_at: new Date().toISOString() })
      .eq("id", id);
  } catch (_) {
    /* optional column */
  }

  return {
    data: {
      ...data,
      status: "completed",
      delivery_status: "delivered",
      commission_due: true,
    },
    error: null,
  };
}

module.exports = { completeGasServiceBooking };
