const { recordCommissionDebtOnDelivered } = require("./providerCommissionDebts");
const { isHomeServiceType } = require("../utils/homeServicePricing");
const { shadowLedgerSettleDeliveredOrder } = require("./shadowLedger");

function isMissingOptionalColumnError(err) {
  const msg = String((err && err.message) || err || "");
  return /column|does not exist|schema cache/i.test(msg);
}

/**
 * إتمام حجز خدمة — دعم تأكيد مزدوج (مزود + عميل) مع توافق للسلوك القديم
 * @param {object} options
 * @param {'provider'|'customer'|'both'|'legacy'} [options.actor]
 */
async function completeServiceBooking(sb, bookingId, providerId, options = {}) {
  const id = String(bookingId || "").trim();
  if (!id) return { data: null, error: new Error("id required") };

  const actor = String(options.actor || "legacy").toLowerCase();

  const { data: existing, error: gErr } = await sb.from("service_bookings").select("*").eq("id", id).maybeSingle();
  if (gErr) return { data: null, error: gErr };
  if (!existing) return { data: null, error: new Error("Not found") };

  const serviceType = String(existing.service_type || "").toLowerCase();
  if (!isHomeServiceType(serviceType) && serviceType !== "gas_delivery") {
    return { data: null, error: new Error("not a service booking") };
  }

  const statusNow = String(existing.status || "").toLowerCase();
  if (statusNow === "delivered" || statusNow === "cancelled" || statusNow === "completed") {
    return { data: existing, error: null, already_done: true };
  }

  const now = new Date().toISOString();
  let providerDone = !!existing.provider_completed_at || statusNow === "delivering" || statusNow === "delivered";
  let customerDone = !!existing.customer_confirmed_at || statusNow === "delivered";

  if (actor === "provider") providerDone = true;
  else if (actor === "customer") customerDone = true;
  else if (actor === "both" || actor === "legacy") {
    providerDone = true;
    customerDone = true;
  }

  if (actor === "customer" && !providerDone && actor !== "legacy" && actor !== "both") {
    return { data: null, error: new Error("يجب على مزود الخدمة تأكيد التنفيذ أولاً") };
  }

  const bothDone = providerDone && customerDone;
  const patch = { updated_at: now };
  if (providerDone) patch.provider_completed_at = now;
  if (customerDone) patch.customer_confirmed_at = now;

  if (bothDone || actor === "legacy") {
    patch.status = "delivered";
    patch.commission_settled = false;
  } else if (providerDone) {
    patch.status = "delivering";
  }

  if (providerId) patch.provider_id = providerId;

  let upd = await sb.from("service_bookings").update(patch).eq("id", id).select("*").single();
  if (upd.error && isMissingOptionalColumnError(upd.error)) {
    const fallback = { updated_at: now, status: patch.status };
    if (providerId) fallback.provider_id = providerId;
    if (bothDone || actor === "legacy") {
      fallback.status = "delivered";
      fallback.commission_settled = false;
    } else if (providerDone) {
      fallback.status = "delivering";
    }
    upd = await sb.from("service_bookings").update(fallback).eq("id", id).select("*").single();
  }
  if (upd.error) return { data: null, error: upd.error };
  if (!upd.data) return { data: null, error: new Error("Not found") };

  const data = upd.data;
  const finalized = String(data.status || "").toLowerCase() === "delivered";

  if (finalized) {
    const pid = providerId || data.provider_id;
    const total = Number(data.total_amount) || 0;

    if (pid) {
      try {
        await recordCommissionDebtOnDelivered(sb, data, pid);
      } catch (debtErr) {
        console.error("[completeServiceBooking] debt:", debtErr && (debtErr.message || debtErr));
      }
    }

    if (pid && total > 0) {
      try {
        const { data: commData, error: commErr } = await sb.rpc(
          "driver_ledger_apply_commission_on_delivered",
          { p_order_id: id }
        );
        if (commErr) throw commErr;
        const row = typeof commData === "object" && commData !== null ? commData : {};
        if (row.reason === "order_not_found") {
          console.log("[commission:service] provider debt recorded (booking)", {
            bookingId: id,
            providerId: pid,
            total,
          });
        } else if (row.ok === true) {
          console.log("[commission:service] success", id, row);
        } else {
          console.log("[commission:service] rpc result", id, row);
        }
      } catch (e) {
        console.error("Commission error:", e.message || String(e));
      }
    } else if (!pid) {
      console.log("[commission:service] skip — no provider_id", id);
    } else {
      console.log("[commission:service] skip — zero total", id);
    }

    try {
      await sb
        .from("service_bookings")
        .update({ commission_due: true, updated_at: new Date().toISOString() })
        .eq("id", id);
    } catch (_) {
      /* optional column */
    }

    void shadowLedgerSettleDeliveredOrder(sb, id, { type: "service", context: "service:completed" });
  }

  return {
    data: {
      ...data,
      status: finalized ? "completed" : data.status,
      delivery_status: finalized ? "delivered" : data.status,
      commission_due: finalized ? true : data.commission_due,
      provider_completed: providerDone,
      customer_confirmed: customerDone,
      awaiting_customer: providerDone && !customerDone,
      awaiting_provider: !providerDone && customerDone,
    },
    error: null,
    finalized,
    already_done: false,
  };
}

module.exports = { completeServiceBooking };
