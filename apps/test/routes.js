/**
 * مسارات اختبار داخلية — عمولة COD
 * GET /api/test/commission/:id
 * يتطلب ERVENOW_ALLOW_COMMISSION_TEST=1 أو NODE_ENV !== production
 */
const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const {
  applyDriverCommissionOnDelivered,
  resolveOrderPaymentMethod,
  resolveOrderBillableAmount,
  isCodOrder,
} = require("../../shared/services/driverCommissionLedger");

const router = express.Router();

function isCommissionTestAllowed() {
  if (String(process.env.ERVENOW_ALLOW_COMMISSION_TEST || "").trim() === "1") return true;
  return process.env.NODE_ENV !== "production";
}

router.get("/commission/:id", async (req, res) => {
  if (!isCommissionTestAllowed()) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  try {
    const orderId = String(req.params.id || "").trim();
    if (!orderId) return fail(res, "order id required", 400);

    const sb = createServiceClient();
    if (!sb) return fail(res, "SUPABASE_SERVICE_ROLE_KEY required", 503);

    const { data: order, error: oErr } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (oErr) return fail(res, oErr.message, 400);
    if (!order) return fail(res, "order_not_found", 404);

    const preview = {
      order_id: order.id,
      delivery_status: order.delivery_status || order.status,
      driver_id: order.driver_id,
      payment_method_resolved: resolveOrderPaymentMethod(order),
      billable_resolved: resolveOrderBillableAmount(order),
      is_cod: isCodOrder(order),
      column_payment_method: order.payment_method || null,
      data_payment_method:
        order.data && typeof order.data === "object"
          ? order.data.paymentMethod || order.data.payment_method || null
          : null,
      total_amount: order.total_amount ?? null,
      data_total:
        order.data && typeof order.data === "object" ? order.data.total ?? order.data.total_amount : null,
    };

    const result = await applyDriverCommissionOnDelivered(sb, orderId, order);

    return ok(res, {
      preview,
      rpc: "driver_ledger_apply_commission_on_delivered",
      result,
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
