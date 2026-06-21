const {
  computeCarPolishingFinancials,
  computeCarPolishingBreakdown,
} = require("../../shared/utils/carPolishingPricing");

describe("carPolishingPricing financials", () => {
  test("sedan base: 7% commission + 15% VAT", () => {
    const fin = computeCarPolishingFinancials({ vehicle_type: "sedan" });
    expect(fin.subtotal_ex_vat).toBe(280);
    expect(fin.platform_commission).toBe(19.6);
    expect(fin.provider_net).toBe(260.4);
    expect(fin.vat_amount).toBe(42);
    expect(fin.total_with_vat).toBe(322);
  });

  test("full addons breakdown stays consistent", () => {
    const input = {
      vehicle_type: "sedan",
      addon_engine_wash: true,
      addon_wheels: true,
      addon_exterior: true,
    };
    const base = computeCarPolishingBreakdown(input);
    const fin = computeCarPolishingFinancials(input);
    expect(base.total).toBe(470);
    expect(fin.platform_commission).toBe(32.9);
    expect(fin.vat_amount).toBe(70.5);
    expect(fin.total_with_vat).toBe(540.5);
  });
});
