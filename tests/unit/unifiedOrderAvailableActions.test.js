const {
  projectUnifiedOrderReadModel,
  resolveCurrentActorType,
} = require("../../shared/domain/orders/unifiedReadModel");
const {
  ACTION,
  availableActionsForRole,
  operationalActionsOf,
} = require("../../shared/domain/orders/availableActions");

const customer = { role: "customer", userId: "c1" };
const merchant = { role: "merchant", userId: "m1", storeId: "s1" };
const driver = { role: "driver", userId: "d1" };
const otherDriver = { role: "driver", userId: "d9" };
const admin = { role: "admin", userId: "a1" };
const service = { role: "service", userId: "p1" };
const transport = { role: "transport", userId: "t1" };

function storeRow(extra) {
  return {
    id: "es-21-101",
    order_number: "ES-21-101",
    order_type: "store",
    store_id: "s1",
    merchant_id: "m1",
    customer_id: "c1",
    ...extra,
  };
}

function actions(row, actor) {
  return availableActionsForRole(row, actor);
}

describe("availableActionsForRole store cycle", () => {
  test("created → merchant accept, customer cancel, driver none, admin cancel+assign", () => {
    const row = storeRow({ delivery_status: "pending" });
    expect(actions(row, merchant)).toEqual([ACTION.ACCEPT]);
    expect(actions(row, customer)).toEqual([ACTION.CANCEL]);
    expect(actions(row, driver)).toEqual([]);
    expect(actions(row, admin)).toEqual([ACTION.CANCEL, ACTION.ASSIGN_DRIVER]);
    expect(resolveCurrentActorType(row)).toBe("merchant");
  });

  test("accepted → merchant start_preparing, customer cancel, driver none", () => {
    const row = storeRow({ delivery_status: "accepted" });
    expect(actions(row, merchant)).toEqual([ACTION.START_PREPARING]);
    expect(actions(row, customer)).toEqual([ACTION.CANCEL]);
    expect(actions(row, driver)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBe("merchant");
  });

  test("preparing → merchant mark_ready, customer cannot cancel", () => {
    const row = storeRow({ delivery_status: "preparing" });
    expect(actions(row, merchant)).toEqual([ACTION.MARK_READY]);
    expect(actions(row, customer)).toEqual([]);
    expect(actions(row, driver)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBe("merchant");
  });

  test("ready unassigned → driver accept_delivery, merchant waits", () => {
    const row = storeRow({ delivery_status: "ready" });
    expect(actions(row, merchant)).toEqual([]);
    expect(actions(row, customer)).toEqual([]);
    expect(actions(row, otherDriver)).toEqual([ACTION.ACCEPT_DELIVERY]);
    expect(resolveCurrentActorType(row)).toBe("merchant");
  });

  test("assigned ready+driver → driver has no pickup shortcut; merchant waits", () => {
    const row = storeRow({ delivery_status: "ready", driver_id: "d1" });
    expect(actions(row, merchant)).toEqual([]);
    expect(actions(row, driver)).toEqual([]);
    expect(actions(row, otherDriver)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBe("driver");
  });

  test("picked_up → driver start_delivery", () => {
    const row = storeRow({ delivery_status: "picked_up", driver_id: "d1" });
    expect(actions(row, driver)).toEqual([ACTION.START_DELIVERY]);
    expect(actions(row, merchant)).toEqual([]);
    expect(actions(row, customer)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBe("driver");
  });

  test("in_transit → driver complete", () => {
    const row = storeRow({ delivery_status: "delivering", driver_id: "d1" });
    expect(actions(row, driver)).toEqual([ACTION.COMPLETE]);
    expect(actions(row, merchant)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBe("driver");
  });

  test("completed → null actor, review for customer only", () => {
    const row = storeRow({ delivery_status: "delivered", driver_id: "d1" });
    expect(resolveCurrentActorType(row)).toBeNull();
    expect(operationalActionsOf(actions(row, merchant))).toEqual([]);
    expect(operationalActionsOf(actions(row, driver))).toEqual([]);
    expect(operationalActionsOf(actions(row, admin))).toEqual([]);
    expect(actions(row, customer)).toEqual([ACTION.REVIEW]);
    const rated = storeRow({ delivery_status: "delivered", driver_id: "d1", rating: 5 });
    expect(actions(rated, customer)).toEqual([]);
  });

  test("cancelled → null actor, no operational actions", () => {
    const row = storeRow({ delivery_status: "cancelled_by_customer" });
    expect(resolveCurrentActorType(row)).toBeNull();
    expect(operationalActionsOf(actions(row, customer))).toEqual([]);
    expect(operationalActionsOf(actions(row, merchant))).toEqual([]);
    expect(operationalActionsOf(actions(row, driver))).toEqual([]);
  });
});

describe("availableActionsForRole service cycle", () => {
  const base = {
    id: "sv-1",
    order_type: "service",
    service_type: "plumber",
    customer_id: "c1",
  };

  test("created → provider accept, customer cancel", () => {
    const row = { ...base, delivery_status: "new" };
    expect(actions(row, service)).toEqual([ACTION.ACCEPT]);
    expect(actions(row, customer)).toEqual([ACTION.CANCEL]);
    expect(actions(row, driver)).toEqual([]);
    expect(actions(row, merchant)).toEqual([]);
    expect(resolveCurrentActorType(row)).toBeNull();
  });

  test("assigned → mark_en_route for phase service", () => {
    const row = {
      ...base,
      delivery_status: "accepted",
      provider_id: "p1",
      data: { sp_status: "accepted" },
    };
    expect(actions(row, service)).toEqual([ACTION.MARK_EN_ROUTE]);
    expect(actions(row, customer)).toEqual([ACTION.CANCEL]);
    expect(resolveCurrentActorType(row)).toBe("service_provider");
  });

  test("scheduled → mark_en_route", () => {
    const row = {
      ...base,
      delivery_status: "accepted",
      provider_id: "p1",
      data: { sp_status: "scheduled", schedule_mode: "scheduled", scheduled_at: "2026-09-22T10:00:00.000Z" },
    };
    expect(actions(row, service)).toEqual([ACTION.MARK_EN_ROUTE]);
    expect(resolveCurrentActorType(row)).toBe("service_provider");
  });

  test("in_transit → start_service + customer confirm", () => {
    const row = {
      ...base,
      delivery_status: "delivering",
      provider_id: "p1",
      data: { sp_status: "on_the_way" },
    };
    expect(actions(row, service)).toEqual([ACTION.START_SERVICE]);
    expect(actions(row, customer)).toEqual([ACTION.CONFIRM]);
    expect(resolveCurrentActorType(row)).toBe("service_provider");
  });

  test("in_progress → complete", () => {
    const row = {
      ...base,
      delivery_status: "delivering",
      provider_id: "p1",
      data: { sp_status: "in_progress" },
    };
    expect(actions(row, service)).toEqual([ACTION.COMPLETE]);
    expect(resolveCurrentActorType(row)).toBe("service_provider");
  });

  test("completed → null actor", () => {
    const row = { ...base, delivery_status: "delivered", provider_id: "p1" };
    expect(resolveCurrentActorType(row)).toBeNull();
    expect(operationalActionsOf(actions(row, service))).toEqual([]);
    expect(actions(row, customer)).toEqual([ACTION.REVIEW]);
  });

  test("other provider cannot act on assigned booking", () => {
    const row = { ...base, delivery_status: "accepted", provider_id: "p1" };
    expect(actions(row, { role: "service", userId: "p-other" })).toEqual([]);
  });
});

describe("availableActionsForRole transport cycle", () => {
  const base = {
    order_type: "service",
    service_type: "car_transport",
    customer_id: "c1",
  };

  test("created → accept", () => {
    const row = { ...base, delivery_status: "pending" };
    expect(actions(row, transport)).toEqual([ACTION.ACCEPT]);
    expect(actions(row, service)).toEqual([]);
    expect(actions(row, driver)).toEqual([]);
  });

  test("assigned → complete (UI skips en-route)", () => {
    const row = { ...base, delivery_status: "accepted", provider_id: "t1" };
    expect(actions(row, transport)).toEqual([ACTION.COMPLETE]);
    expect(resolveCurrentActorType(row)).toBe("transport_provider");
  });

  test("in_transit → provider waits, customer confirm", () => {
    const row = { ...base, delivery_status: "delivering", provider_id: "t1" };
    expect(actions(row, transport)).toEqual([]);
    expect(actions(row, customer)).toEqual([ACTION.CONFIRM]);
  });

  test("completed → null actor", () => {
    const row = { ...base, delivery_status: "delivered", provider_id: "t1" };
    expect(resolveCurrentActorType(row)).toBeNull();
    expect(operationalActionsOf(actions(row, transport))).toEqual([]);
  });
});

describe("availableActionsForRole internal_delivery", () => {
  test("uses driver permissions, never transport", () => {
    const created = {
      order_type: "service",
      service_type: "internal_delivery",
      customer_id: "c1",
      delivery_status: "pending",
    };
    expect(actions(created, driver)).toEqual([ACTION.ACCEPT_DELIVERY]);
    expect(actions(created, transport)).toEqual([]);
    expect(actions(created, service)).toEqual([]);

    const assigned = { ...created, delivery_status: "accepted", driver_id: "d1" };
    expect(actions(assigned, driver)).toEqual([ACTION.START_DELIVERY, ACTION.COMPLETE]);
    expect(resolveCurrentActorType(assigned)).toBe("driver");

    const done = { ...assigned, delivery_status: "delivered" };
    expect(resolveCurrentActorType(done)).toBeNull();
    expect(operationalActionsOf(actions(done, driver))).toEqual([]);
  });
});

describe("projectUnifiedOrderReadModel available_actions", () => {
  test("omits available_actions without actor", () => {
    const out = projectUnifiedOrderReadModel(storeRow({ delivery_status: "preparing" }));
    expect(out.available_actions).toBeUndefined();
  });

  test("includes role-specific available_actions", () => {
    const row = storeRow({ delivery_status: "preparing" });
    const merch = projectUnifiedOrderReadModel(row, merchant);
    const cust = projectUnifiedOrderReadModel(row, customer);
    expect(merch.available_actions).toEqual([ACTION.MARK_READY]);
    expect(cust.available_actions).toEqual([]);
    expect(merch.delivery_status).toBe("preparing");
  });
});
