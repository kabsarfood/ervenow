/**
 * @deprecated provider_commission_debts — ledger only (ervenow_ledger_settle_service_booking).
 */
async function recordCommissionDebtOnDelivered(_sb, _booking, _providerId) {
  return null;
}

module.exports = { recordCommissionDebtOnDelivered };
