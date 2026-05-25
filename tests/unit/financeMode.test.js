const {
  isLedgerOnlyMode,
  financeMode,
  assertLedgerOnlyFinance,
  LEDGER_ONLY,
} = require("../../shared/utils/financeMode");

describe("financeMode", () => {
  const prev = process.env.FINANCE_MODE;

  afterEach(() => {
    if (prev === undefined) delete process.env.FINANCE_MODE;
    else process.env.FINANCE_MODE = prev;
  });

  test("defaults to ledger_only when unset", () => {
    delete process.env.FINANCE_MODE;
    expect(financeMode()).toBe(LEDGER_ONLY);
    expect(isLedgerOnlyMode()).toBe(true);
  });

  test("legacy mode disables ledger-only guard throw target", () => {
    process.env.FINANCE_MODE = "legacy";
    expect(isLedgerOnlyMode()).toBe(false);
    expect(() => assertLedgerOnlyFinance("test")).not.toThrow();
  });

  test("assertLedgerOnlyFinance throws in ledger_only", () => {
    process.env.FINANCE_MODE = "ledger_only";
    expect(() => assertLedgerOnlyFinance("wallets")).toThrow(/ledger_only/);
  });
});
