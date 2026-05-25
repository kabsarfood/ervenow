const { gatewayMode, toHalalas } = require("../../shared/services/paymentGateway");

describe("paymentGateway", () => {
  const origGateway = process.env.PAYMENT_GATEWAY;
  const origKey = process.env.MOYASAR_SECRET_KEY;

  afterEach(() => {
    if (origGateway === undefined) delete process.env.PAYMENT_GATEWAY;
    else process.env.PAYMENT_GATEWAY = origGateway;
    if (origKey === undefined) delete process.env.MOYASAR_SECRET_KEY;
    else process.env.MOYASAR_SECRET_KEY = origKey;
  });

  test("toHalalas converts SAR to halalas", () => {
    expect(toHalalas(10.5)).toBe(1050);
    expect(toHalalas(0)).toBe(0);
  });

  test("gatewayMode mock when no moyasar key", () => {
    delete process.env.PAYMENT_GATEWAY;
    delete process.env.MOYASAR_SECRET_KEY;
    expect(gatewayMode()).toBe("mock");
  });

  test("gatewayMode moyasar when key set", () => {
    process.env.MOYASAR_SECRET_KEY = "sk_test_x";
    expect(gatewayMode()).toBe("moyasar");
  });
});
