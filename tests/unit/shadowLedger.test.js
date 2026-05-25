const { shadowLedgerSettleDeliveredOrder } = require("../../shared/services/shadowLedger");

describe("shadowLedger", () => {
  test("calls service booking rpc when type is service", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const sb = {
      rpc: jest.fn((fn) => {
        if (fn === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({
          data: { ok: true, reason: "settled", commission: 7 },
          error: null,
        });
      }),
    };

    const row = await shadowLedgerSettleDeliveredOrder(sb, "booking-uuid-1", {
      type: "service",
      context: "service:completed",
    });
    expect(row.ok).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_settle_service_booking", {
      p_booking_id: "booking-uuid-1",
    });
    expect(logSpy).toHaveBeenCalledWith("[ledger] settlement done:", "booking-uuid-1");
    logSpy.mockRestore();
  });

  test("logs settlement done on ok rpc", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const sb = {
      rpc: jest.fn((fn) => {
        if (fn === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: { ok: true, reason: "settled" }, error: null });
      }),
    };

    const row = await shadowLedgerSettleDeliveredOrder(sb, "order-uuid-1", { context: "test" });
    expect(row.ok).toBe(true);
    expect(sb.rpc).toHaveBeenCalledWith("ervenow_ledger_settle_delivered_order", {
      p_order_id: "order-uuid-1",
    });
    expect(logSpy).toHaveBeenCalledWith("[ledger] settlement done:", "order-uuid-1");
    logSpy.mockRestore();
  });

  test("skips missing id without throwing", async () => {
    const row = await shadowLedgerSettleDeliveredOrder(null, "", {});
    expect(row.ok).toBe(false);
    expect(row.reason).toBe("missing_id");
  });

  test("logs skip reason when rpc returns not_delivered", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const sb = {
      rpc: jest.fn((fn) => {
        if (fn === "settlement_log_try_claim") {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: { ok: false, reason: "not_delivered" }, error: null });
      }),
    };

    const row = await shadowLedgerSettleDeliveredOrder(sb, "order-uuid-2", { context: "store:checkout" });
    expect(row.reason).toBe("not_delivered");
    expect(logSpy).toHaveBeenCalledWith(
      "[ledger] settlement skip:",
      "order-uuid-2",
      "not_delivered",
      "(store:checkout)"
    );
    logSpy.mockRestore();
  });
});
