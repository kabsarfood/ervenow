/**
 * إيداع صافي التاجر عند تسليم طلب متجر — مرجع ledger واحد (HOTFIX-001).
 */

const { logger } = require("../utils/logger");
const { ledgerDepositForUser } = require("../utils/ledgerWallet");
const {
  storeMerchantNetFromOrder,
  storeMerchantLedgerRef,
  legacyCheckoutMerchantRef,
} = require("../utils/storeMerchantNet");

function isEwPayOrder(order) {
  return String(order?.payment_method || "")
    .trim()
    .toLowerCase() === "ew_pay";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} storeId
 */
async function resolveMerchantUserForStore(sb, storeId) {
  const sid = String(storeId || "").trim();
  if (!sid || !sb) return null;

  const { data: storeRow } = await sb.from("stores").select("phone").eq("id", sid).maybeSingle();
  const digits = String(storeRow?.phone || "").replace(/\D/g, "");
  if (digits.length < 9) return null;

  const { data: merchantUser } = await sb
    .from("users")
    .select("id, role")
    .eq("phone", digits)
    .maybeSingle();

  return merchantUser?.id ? merchantUser : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string[]} refs
 */
async function merchantDepositRefExists(sb, refs) {
  const list = (refs || []).map((r) => String(r || "").trim()).filter(Boolean);
  if (!list.length || !sb) return false;

  try {
    const { data, error } = await sb
      .from("ervenow_ledger_transactions")
      .select("id")
      .in("reference_id", list)
      .eq("status", "completed")
      .limit(1);
    if (error) {
      if (/ervenow_ledger_transactions|does not exist|schema cache/i.test(String(error.message || ""))) {
        return false;
      }
      throw error;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    logger.warn({ err: e.message || String(e) }, "[storeMerchantLedgerCredit] ref lookup");
    return false;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {object} order
 * @param {object} [settlementRow]
 */
async function creditStoreMerchantOnDelivered(sb, order, settlementRow = {}) {
  const orderId = order?.id != null ? String(order.id).trim() : "";
  if (!sb || !orderId || !order?.store_id) {
    return { ok: true, skipped: true, reason: "not_store_order" };
  }

  if (settlementRow.ew_pay === true || isEwPayOrder(order)) {
    return { ok: true, skipped: true, reason: "ew_pay" };
  }

  const net = storeMerchantNetFromOrder(order);
  if (!(net > 0)) {
    return { ok: true, skipped: true, reason: "zero_net" };
  }

  const ref = storeMerchantLedgerRef(orderId);
  const legacyRef = legacyCheckoutMerchantRef(orderId);
  const already = await merchantDepositRefExists(sb, [ref, legacyRef, `order:${orderId}:merchant`]);
  if (already) {
    return { ok: true, skipped: true, reason: "duplicate" };
  }

  const merchantUser = order.merchant_id
    ? { id: order.merchant_id, role: "merchant" }
    : await resolveMerchantUserForStore(sb, order.store_id);

  if (!merchantUser?.id) {
    logger.warn({ orderId, store_id: order.store_id }, "[storeMerchantLedgerCredit] no merchant user");
    return { ok: true, skipped: true, reason: "no_merchant_user" };
  }

  try {
    const row = await ledgerDepositForUser(
      sb,
      merchantUser.id,
      merchantUser.role || "merchant",
      net,
      ref,
      `صافي متجر — طلب ${order.order_number || orderId}`
    );
    return { ok: true, amount: net, reference_id: ref, ledger: row };
  } catch (e) {
    const msg = e && (e.message || String(e));
    logger.error({ orderId, err: msg }, "[storeMerchantLedgerCredit] deposit failed");
    return { ok: false, reason: "deposit_failed", detail: msg };
  }
}

module.exports = {
  creditStoreMerchantOnDelivered,
  resolveMerchantUserForStore,
  merchantDepositRefExists,
};
