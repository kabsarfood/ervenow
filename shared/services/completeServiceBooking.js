const { recordCommissionDebtOnDelivered } = require("./providerCommissionDebts");
const { isHomeServiceType } = require("../utils/homeServicePricing");

/**
 * إتمام حجز خدمة (service_bookings) — delivered + عمولة المنصة
 */
async function completeServiceBooking(sb, bookingId, providerId) {
  const id = String(bookingId || "").trim();
  if (!id) return { data: null, error: new Error("id required") };

  const { data: existing, error: gErr } = await sb.from("service_bookings").select("*").eq("id", id).maybeSingle();
  if (gErr) return { data: null, error: gErr };
  if (!existing) return { data: null, error: new Error("Not found") };

  const serviceType = String(existing.service_type || "").toLowerCase();
  if (!isHomeServiceType(serviceType) && serviceType !== "gas_delivery") {
    return { data: null, error: new Error("not a service booking") };
  }

  const patch = {
    status: "delivered",
    updated_at: new Date().toISOString(),
    commission_settled: false,
  };
  if (providerId) patch.provider_id = providerId;

  const { data, error } = await sb.from("service_bookings").update(patch).eq("id", id).select("*").single();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not found") };

  const pid = providerId || data.provider_id;
  if (pid) {
    try {
      await recordCommissionDebtOnDelivered(sb, data, pid);
    } catch (debtErr) {
      console.error("[completeServiceBooking] debt:", debtErr && (debtErr.message || debtErr));
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

module.exports = { completeServiceBooking };
