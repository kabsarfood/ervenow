/**
 * FINANCE_MODE=ledger_only — مصدر مالي وحيد: ervenow_ledger_* فقط.
 * FINANCE_MODE=legacy — يسمح بالمسارات القديمة (تطوير/ترحيل فقط).
 */

const LEDGER_ONLY = "ledger_only";

function financeMode() {
  return String(process.env.FINANCE_MODE || LEDGER_ONLY).trim().toLowerCase();
}

function isLedgerOnlyMode() {
  return financeMode() === LEDGER_ONLY;
}

function legacyFinanceDisabledMessage() {
  return "Legacy finance disabled — FINANCE_MODE=ledger_only (use ervenow_ledger_* only)";
}

function assertLedgerOnlyFinance(operation) {
  if (isLedgerOnlyMode()) {
    const err = new Error(`${legacyFinanceDisabledMessage()}${operation ? ` (${operation})` : ""}`);
    err.code = "E_LEDGER_ONLY";
    throw err;
  }
}

module.exports = {
  LEDGER_ONLY,
  financeMode,
  isLedgerOnlyMode,
  legacyFinanceDisabledMessage,
  assertLedgerOnlyFinance,
};
