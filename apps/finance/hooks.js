/**
 * Legacy finance hooks — معطّلة عند FINANCE_MODE=ledger_only.
 * التسوية عبر shared/services/ledgerOnlySettlement.js فقط.
 */

const { isLedgerOnlyMode } = require("../../shared/utils/financeMode");

async function onDeliveryDelivered(_sb, _deliveryOrder) {
  if (isLedgerOnlyMode()) {
    return { linked: false, skipped: "ledger_only_mode" };
  }
  const { calculateCommission, fetchCommissionRates } = require("./accountingEngine");
  const { SETTLEMENT_KINDS, tryClaimSettlement } = require("../../shared/services/settlementGuard");

  const sb = _sb;
  const deliveryOrder = _deliveryOrder;
  try {
    const { data: byId, error: idErr } = await sb
      .from("orders")
      .select("*")
      .eq("id", deliveryOrder.id)
      .limit(1);

    if (idErr) throw idErr;

    let fo = byId && byId[0];
    if (!fo) {
      const { data: finOrders, error: qErr } = await sb
        .from("orders")
        .select("*")
        .eq("delivery_order_id", deliveryOrder.id)
        .limit(1);
      if (qErr) throw qErr;
      if (!finOrders || !finOrders.length) return { linked: false };
      fo = finOrders[0];
    }

    if (fo.settled_at) return { linked: true, skipped: "already_settled" };

    const shouldProceed = await tryClaimSettlement(sb, fo.id, "order", SETTLEMENT_KINDS.FINANCE_WALLETS_SETTLE, {
      path: "onDeliveryDelivered",
    });
    if (!shouldProceed) return { linked: true, skipped: "settlement_log_duplicate" };

    const rates = await fetchCommissionRates(sb, fo.country_code || "SA");
    const vat = Number(
      process.env.ERVENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
        process.env.ERWENOW_PLATFORM_VAT_ON_COMMISSION_RATE ||
        0
    );

    const calc = calculateCommission({
      orderTotal: Number(fo.total_amount),
      deliveryFee: Number(fo.delivery_fee),
      rateMerchant: rates.merchant,
      rateDelivery: rates.delivery,
      merchantId: fo.merchant_id,
      serviceProviderId: fo.service_provider_id,
      platformVatOnCommissionRate: vat,
    });

    const { error: uErr } = await sb
      .from("orders")
      .update({
        status: "delivered",
        breakdown: calc.breakdown,
        driver_id: deliveryOrder.driver_id || fo.driver_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fo.id);

    if (uErr) throw uErr;

    const { data: rpcData, error: rpcErr } = await sb.rpc("erwenow_finance_settle_order", {
      p_order_id: fo.id,
    });
    if (rpcErr) throw rpcErr;

    return { linked: true, settlement: rpcData };
  } catch (e) {
    console.error("[ERVENOW finance] onDeliveryDelivered:", e.message || e);
    return { linked: false, error: String(e.message || e) };
  }
}

module.exports = { onDeliveryDelivered };
