const { projectUnifiedOrderReadModel } = require("../../shared/domain/orders/unifiedReadModel");
const { orderToBookingView } = require("../../shared/utils/serviceOrderQuery");

function contract(row) {
  const out = projectUnifiedOrderReadModel(row);
  return {
    workflow: out.workflow,
    status_unified: out.status_unified,
    current_actor_type: out.current_actor_type,
  };
}

function simulateApis(row) {
  const customer = projectUnifiedOrderReadModel({ ...row });
  const merchant = projectUnifiedOrderReadModel({ ...row, board_status: row.delivery_status });
  const driver = projectUnifiedOrderReadModel({ ...row });
  const service = projectUnifiedOrderReadModel(orderToBookingView({ ...row }));
  const admin = projectUnifiedOrderReadModel({ ...row });
  return { customer, merchant, driver, service, admin };
}

function expectSameContract(row) {
  const views = simulateApis(row);
  const expected = contract(row);
  Object.keys(views).forEach((api) => {
    expect({
      api,
      workflow: views[api].workflow,
      status_unified: views[api].status_unified,
      current_actor_type: views[api].current_actor_type,
    }).toEqual({
      api,
      ...expected,
    });
    expect(views[api].delivery_status).toBe(row.delivery_status);
  });
}

describe("unifiedOrderReadModel cross-API identity", () => {
  const storeBase = {
    id: "es-21-101",
    order_number: "ES-21-101",
    order_type: "store",
    store_id: "s1",
    merchant_id: "m1",
    customer_id: "c1",
  };

  test("store lifecycle matches across APIs", () => {
    const stages = [
      { delivery_status: "pending", expect: { status_unified: "created", current_actor_type: "merchant" } },
      { delivery_status: "accepted", expect: { status_unified: "accepted", current_actor_type: "merchant" } },
      { delivery_status: "preparing", expect: { status_unified: "preparing", current_actor_type: "merchant" } },
      { delivery_status: "ready", expect: { status_unified: "ready", current_actor_type: "merchant" } },
      {
        delivery_status: "ready",
        driver_id: "d1",
        expect: { status_unified: "assigned", current_actor_type: "driver" },
      },
      {
        delivery_status: "picked_up",
        driver_id: "d1",
        expect: { status_unified: "picked_up", current_actor_type: "driver" },
      },
      {
        delivery_status: "delivering",
        driver_id: "d1",
        expect: { status_unified: "in_transit", current_actor_type: "driver" },
      },
      {
        delivery_status: "delivered",
        driver_id: "d1",
        expect: { status_unified: "completed", current_actor_type: null },
      },
    ];
    stages.forEach((stage) => {
      const row = { ...storeBase, delivery_status: stage.delivery_status, driver_id: stage.driver_id };
      expectSameContract(row);
      const c = contract(row);
      expect(c.workflow).toBe("store");
      expect(c.status_unified).toBe(stage.expect.status_unified);
      expect(c.current_actor_type).toBe(stage.expect.current_actor_type);
    });
  });

  test("service lifecycle matches across APIs", () => {
    const base = {
      id: "sv-1",
      order_number: "SV-21-220",
      order_type: "service",
      service_type: "plumber",
      customer_id: "c1",
    };
    const stages = [
      { delivery_status: "new", expect: { status_unified: "created", current_actor_type: null } },
      {
        delivery_status: "accepted",
        provider_id: "p1",
        expect: { status_unified: "assigned", current_actor_type: "service_provider" },
      },
      {
        delivery_status: "accepted",
        provider_id: "p1",
        data: { sp_status: "scheduled", schedule_mode: "scheduled", scheduled_at: "2026-09-22T10:00:00.000Z" },
        expect: { status_unified: "scheduled", current_actor_type: "service_provider" },
      },
      {
        delivery_status: "delivering",
        provider_id: "p1",
        data: { sp_status: "on_the_way" },
        expect: { status_unified: "in_transit", current_actor_type: "service_provider" },
      },
      {
        delivery_status: "delivering",
        provider_id: "p1",
        data: { sp_status: "in_progress" },
        expect: { status_unified: "in_progress", current_actor_type: "service_provider" },
      },
      {
        delivery_status: "delivered",
        provider_id: "p1",
        expect: { status_unified: "completed", current_actor_type: null },
      },
    ];
    stages.forEach((stage) => {
      const row = {
        ...base,
        delivery_status: stage.delivery_status,
        provider_id: stage.provider_id,
        data: stage.data,
      };
      expectSameContract(row);
      const c = contract(row);
      expect(c.workflow).toBe("service");
      expect(c.status_unified).toBe(stage.expect.status_unified);
      expect(c.current_actor_type).toBe(stage.expect.current_actor_type);
    });
  });

  test("transport lifecycle matches across APIs", () => {
    const base = {
      id: "tr-1",
      order_number: "SV-21-330",
      order_type: "service",
      service_type: "car_transport",
      customer_id: "c1",
    };
    const stages = [
      { delivery_status: "pending", expect: { status_unified: "created", current_actor_type: null } },
      {
        delivery_status: "accepted",
        provider_id: "t1",
        expect: { status_unified: "assigned", current_actor_type: "transport_provider" },
      },
      {
        delivery_status: "delivering",
        provider_id: "t1",
        expect: { status_unified: "in_transit", current_actor_type: "transport_provider" },
      },
      {
        delivery_status: "delivered",
        provider_id: "t1",
        expect: { status_unified: "completed", current_actor_type: null },
      },
    ];
    stages.forEach((stage) => {
      const row = { ...base, delivery_status: stage.delivery_status, provider_id: stage.provider_id };
      expectSameContract(row);
      const c = contract(row);
      expect(c.workflow).toBe("transport");
      expect(c.status_unified).toBe(stage.expect.status_unified);
      expect(c.current_actor_type).toBe(stage.expect.current_actor_type);
    });
  });

  test("driver completed column set still matches store contract", () => {
    const row = {
      id: "es-21-101",
      order_number: "ES-21-101",
      delivery_status: "delivered",
      status: "delivered",
      store_name: "متجر",
      drop_address: "الرياض",
      data: {},
      breakdown: {},
      order_type: "restaurant",
      service_type: null,
      store_id: "s1",
      driver_id: "d1",
      merchant_id: "m1",
      provider_id: null,
    };
    expectSameContract(row);
    expect(contract(row)).toEqual({
      workflow: "store",
      status_unified: "completed",
      current_actor_type: null,
    });
  });

  test("internal_delivery is driver workflow, never transport", () => {
    const row = {
      order_type: "service",
      service_type: "internal_delivery",
      delivery_status: "accepted",
      driver_id: "d9",
    };
    expectSameContract(row);
    const c = contract(row);
    expect(c.workflow).toBe("internal_delivery");
    expect(c.workflow).not.toBe("transport");
    expect(c.current_actor_type).toBe("driver");
    expect(c.status_unified).toBe("assigned");
  });
});
