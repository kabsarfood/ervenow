const {
  buildDebtPaymentLink,
  buildDebtWarningMessage,
  buildDebtBlockMessage,
  buildDebtNotifyMessage,
} = require("../../shared/utils/debtPaymentLink");

describe("debtPaymentLink", () => {
  const orig = process.env.ERVENOW_PUBLIC_URL;
  beforeAll(() => {
    process.env.ERVENOW_PUBLIC_URL = "https://ervenow.com";
  });
  afterAll(() => {
    if (orig === undefined) delete process.env.ERVENOW_PUBLIC_URL;
    else process.env.ERVENOW_PUBLIC_URL = orig;
  });

  test("buildDebtPaymentLink matches spec", () => {
    const link = buildDebtPaymentLink("user-abc", 150.5);
    expect(link).toContain("https://ervenow.com/pay?");
    expect(link).toContain("uid=user-abc");
    expect(link).toContain("amount=150.50");
    expect(link).toContain("type=debt");
  });

  test("warning message includes amount and link", () => {
    const link = "https://ervenow.com/pay?uid=x&amount=50.00&type=debt";
    const msg = buildDebtWarningMessage(50, link);
    expect(msg).toContain("50.00 ريال");
    expect(msg).toContain(link);
    expect(msg).toContain("ارفينو");
  });

  test("block message mentions freeze", () => {
    const link = "https://ervenow.com/pay?uid=x&amount=100.00&type=debt";
    const msg = buildDebtBlockMessage(100, link);
    expect(msg).toContain("إيقاف");
    expect(msg).toContain(link);
  });

  test("buildDebtNotifyMessage picks kind", () => {
    const link = "https://ervenow.com/pay?uid=u&amount=10.00&type=debt";
    expect(buildDebtNotifyMessage("warn", 10, link)).toContain("تجنباً");
    expect(buildDebtNotifyMessage("block", 10, link)).toContain("إيقاف");
  });
});
