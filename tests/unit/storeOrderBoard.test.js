const {
  normalizeBoardStatus,
  countOrdersByStatus,
  enrichOrderForBoard,
  financialStatusForOrder,
  itemCountFromOrder,
} = require("../../shared/utils/storeOrderBoard");

describe("storeOrderBoard", () => {
  test("normalizeBoardStatus maps aliases", () => {
    expect(normalizeBoardStatus("new")).toBe("pending");
    expect(normalizeBoardStatus("picked")).toBe("picked_up");
    expect(normalizeBoardStatus("delivering")).toBe("picked_up");
    expect(normalizeBoardStatus("cancelled")).toBeNull();
  });

  test("countOrdersByStatus tallies board buckets", () => {
    const orders = [
      { delivery_status: "pending" },
      { delivery_status: "pending" },
      { delivery_status: "accepted" },
      { delivery_status: "preparing" },
      { delivery_status: "ready" },
      { delivery_status: "picked" },
      { delivery_status: "delivered" },
    ];
    expect(countOrdersByStatus(orders)).toEqual({
      pending: 2,
      accepted: 1,
      preparing: 1,
      ready: 1,
      picked_up: 1,
      delivered: 1,
    });
  });

  test("enrichOrderForBoard computes financial fields", () => {
    const row = {
      id: "o1",
      order_total: 100,
      total_with_vat: 115,
      platform_fee: 15,
      payment_status: "paid",
      delivery_status: "preparing",
      breakdown: {
        customer_name: "محمد",
        items: [{ qty: 2 }, { quantity: 3 }],
      },
    };
    const e = enrichOrderForBoard(row);
    expect(e.customer_name).toBe("محمد");
    expect(e.item_count).toBe(5);
    expect(e.order_value).toBe(115);
    expect(e.commission).toBe(15);
    expect(e.store_net).toBe(100);
    expect(e.board_status).toBe("preparing");
    expect(e.financial_status_label).toBe("مستحق");
  });

  test("financialStatusForOrder labels", () => {
    expect(financialStatusForOrder({ payment_status: "pending" }).label).toBe("معلق");
    expect(financialStatusForOrder({ payment_status: "paid", delivery_status: "ready" }).label).toBe("مستحق");
    expect(financialStatusForOrder({ payment_status: "paid", delivery_status: "delivered" }).label).toBe("مدفوع");
  });

  test("itemCountFromOrder sums qty", () => {
    expect(itemCountFromOrder({ breakdown: { items: [{ qty: 2 }, { quantity: 1 }] } })).toBe(3);
  });
});
