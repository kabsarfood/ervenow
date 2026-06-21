const {
  deferServiceProviderDispatch,
  isPrepaidServiceType,
} = require("../../shared/utils/serviceOrderPaymentHold");

describe("serviceOrderPaymentHold", () => {
  const orig = process.env.ERVENOW_REQUIRE_ORDER_PAYMENT;

  afterEach(() => {
    if (orig === undefined) delete process.env.ERVENOW_REQUIRE_ORDER_PAYMENT;
    else process.env.ERVENOW_REQUIRE_ORDER_PAYMENT = orig;
  });

  test("car_polishing always deferred until paid", () => {
    expect(deferServiceProviderDispatch("car_polishing", "unpaid", {})).toBe(true);
    expect(deferServiceProviderDispatch("car_polishing", "pending", {})).toBe(true);
    expect(deferServiceProviderDispatch("car_polishing", "paid", {})).toBe(false);
  });

  test("plumber on_service publishes before paid", () => {
    expect(deferServiceProviderDispatch("plumber", "unpaid", { payment_mode: "on_service" })).toBe(false);
    expect(deferServiceProviderDispatch("plumber", "unpaid", { payment_mode: "after_diagnosis" })).toBe(false);
  });

  test("env gate defers unpaid generic service", () => {
    process.env.ERVENOW_REQUIRE_ORDER_PAYMENT = "1";
    expect(deferServiceProviderDispatch("plumber", "unpaid", { payment_mode: "cart" })).toBe(true);
  });

  test("isPrepaidServiceType", () => {
    expect(isPrepaidServiceType("car_polishing")).toBe(true);
    expect(isPrepaidServiceType("plumber")).toBe(false);
  });
});
