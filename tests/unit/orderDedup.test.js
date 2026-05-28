const { isIdempotencyKeyUniqueViolation } = require("../../shared/utils/orderDedup");

describe("orderDedup", () => {
  test("isIdempotencyKeyUniqueViolation detects idempotency unique index", () => {
    expect(
      isIdempotencyKeyUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_orders_customer_idempotency"',
      })
    ).toBe(true);
    expect(isIdempotencyKeyUniqueViolation({ code: "23505", message: "order_number_key" })).toBe(false);
  });
});
