const { dispatchUnifiedOrderAction } = require("../../shared/domain/orders/unifiedActionDispatcher");
const { ACTION } = require("../../shared/domain/orders/availableActions");
const { projectUnifiedOrderReadModel } = require("../../shared/domain/orders/unifiedReadModel");

const merchant = { id: "m1", role: "store", phone: "966500000001" };
const otherMerchant = { id: "m2", role: "merchant", phone: "966500000002" };
const customer = { id: "c1", role: "customer", phone: "966559010021" };
const driver = { id: "d1", role: "driver", phone: "966500000009" };

function storeAccepted() {
  return {
    id: "es-21-101",
    order_number: "ES-21-101",
    order_type: "store",
    store_id: "s1",
    merchant_id: "m1",
    customer_id: "c1",
    delivery_status: "accepted",
  };
}

function fakeSb(order) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: order, error: null });
        },
      };
    },
  };
}

function dispatch(order, appUser, action, extra) {
  const patchCalls = [];
  const patchUnifiedOrderStatus = async (_sb, id, nextStatus, user) => {
    patchCalls.push({ id, nextStatus, userId: user && user.id });
    if (extra && extra.patchError) return { data: null, error: extra.patchError };
    return {
      data: { ...order, delivery_status: nextStatus },
      error: null,
    };
  };
  const merchantOwnsOrder = extra && extra.owns != null ? async () => extra.owns : undefined;
  return dispatchUnifiedOrderAction(fakeSb(order), order && order.id, action, appUser, {
    patchUnifiedOrderStatus,
    merchantOwnsOrder,
  }).then((out) => ({ out, patchCalls }));
}

describe("dispatchUnifiedOrderAction start_preparing", () => {
  test("accepted → preparing via current engine, then mark_ready", async () => {
    const row = storeAccepted();
    const { out, patchCalls } = await dispatch(row, merchant, ACTION.START_PREPARING);
    expect(out.ok).toBe(true);
    expect(patchCalls).toEqual([{ id: "es-21-101", nextStatus: "preparing", userId: "m1" }]);
    expect(out.action).toBe("start_preparing");
    expect(out.order_id).toBe("es-21-101");
    expect(out.workflow).toBe("store");
    expect(out.previous_status).toBe("accepted");
    expect(out.previous_status_unified).toBe("accepted");
    expect(out.status_unified).toBe("preparing");
    expect(out.current_actor_type).toBe("merchant");
    expect(out.available_actions).toEqual(["mark_ready"]);
    expect(out.order.delivery_status).toBe("preparing");

    const after = { ...row, delivery_status: "preparing" };
    const customerView = projectUnifiedOrderReadModel(after, { role: "customer", userId: "c1" });
    const merchantView = projectUnifiedOrderReadModel(after, {
      role: "merchant",
      userId: "m1",
      storeId: "s1",
    });
    const adminView = projectUnifiedOrderReadModel(after, { role: "admin", userId: "a1" });
    expect(customerView.status_unified).toBe("preparing");
    expect(merchantView.status_unified).toBe("preparing");
    expect(adminView.status_unified).toBe("preparing");
    expect(customerView.current_actor_type).toBe("merchant");
    expect(merchantView.current_actor_type).toBe("merchant");
    expect(adminView.current_actor_type).toBe("merchant");
    expect(merchantView.available_actions).toEqual(["mark_ready"]);
  });

  test("customer is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storeAccepted(), customer, ACTION.START_PREPARING, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("driver is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storeAccepted(), driver, ACTION.START_PREPARING, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("other merchant is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storeAccepted(), otherMerchant, ACTION.START_PREPARING, {
      owns: false,
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("non-store workflow is rejected", async () => {
    const row = {
      id: "sv-1",
      order_type: "service",
      service_type: "plumber",
      customer_id: "c1",
      merchant_id: "m1",
      delivery_status: "accepted",
    };
    const { out, patchCalls } = await dispatch(row, merchant, ACTION.START_PREPARING, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("not accepted is rejected", async () => {
    const { out, patchCalls } = await dispatch(
      { ...storeAccepted(), delivery_status: "pending" },
      merchant,
      ACTION.START_PREPARING
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("completed is rejected", async () => {
    const { out, patchCalls } = await dispatch(
      { ...storeAccepted(), delivery_status: "delivered" },
      merchant,
      ACTION.START_PREPARING
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("cancelled is rejected", async () => {
    const { out, patchCalls } = await dispatch(
      { ...storeAccepted(), delivery_status: "cancelled" },
      merchant,
      ACTION.START_PREPARING
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("unsupported action is rejected", async () => {
    const { out, patchCalls } = await dispatch(storeAccepted(), merchant, "accept_delivery");
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(out.error).toBe("unsupported action");
    expect(patchCalls).toEqual([]);
  });
});

function storePreparing() {
  return { ...storeAccepted(), id: "es-21-102", order_number: "ES-21-102", delivery_status: "preparing" };
}

describe("dispatchUnifiedOrderAction mark_ready", () => {
  test("preparing → ready via current engine", async () => {
    const row = storePreparing();
    const { out, patchCalls } = await dispatch(row, merchant, ACTION.MARK_READY);
    expect(out.ok).toBe(true);
    expect(patchCalls).toEqual([{ id: "es-21-102", nextStatus: "ready", userId: "m1" }]);
    expect(out.action).toBe("mark_ready");
    expect(out.order_id).toBe("es-21-102");
    expect(out.workflow).toBe("store");
    expect(out.previous_status).toBe("preparing");
    expect(out.previous_status_unified).toBe("preparing");
    expect(out.status_unified).toBe("ready");
    expect(out.current_actor_type).toBe("merchant");
    expect(out.available_actions).toEqual([]);
    expect(out.order.delivery_status).toBe("ready");

    const after = { ...row, delivery_status: "ready" };
    const customerView = projectUnifiedOrderReadModel(after, { role: "customer", userId: "c1" });
    const merchantView = projectUnifiedOrderReadModel(after, {
      role: "merchant",
      userId: "m1",
      storeId: "s1",
    });
    const adminView = projectUnifiedOrderReadModel(after, { role: "admin", userId: "a1" });
    expect(customerView.status_unified).toBe("ready");
    expect(merchantView.status_unified).toBe("ready");
    expect(adminView.status_unified).toBe("ready");
    expect(customerView.current_actor_type).toBe("merchant");
    expect(merchantView.current_actor_type).toBe("merchant");
    expect(adminView.current_actor_type).toBe("merchant");
    expect(merchantView.available_actions).toEqual([]);
  });

  test("customer is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storePreparing(), customer, ACTION.MARK_READY, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("driver is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storePreparing(), driver, ACTION.MARK_READY, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("other merchant is rejected with no write", async () => {
    const { out, patchCalls } = await dispatch(storePreparing(), otherMerchant, ACTION.MARK_READY, { owns: false });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(patchCalls).toEqual([]);
  });

  test("non-store workflow is rejected", async () => {
    const row = {
      id: "sv-2",
      order_type: "service",
      service_type: "plumber",
      customer_id: "c1",
      merchant_id: "m1",
      delivery_status: "preparing",
    };
    const { out, patchCalls } = await dispatch(row, merchant, ACTION.MARK_READY, { owns: true });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("not preparing is rejected", async () => {
    const { out, patchCalls } = await dispatch(storeAccepted(), merchant, ACTION.MARK_READY);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("completed is rejected", async () => {
    const { out, patchCalls } = await dispatch(
      { ...storePreparing(), delivery_status: "delivered" },
      merchant,
      ACTION.MARK_READY
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });

  test("cancelled is rejected", async () => {
    const { out, patchCalls } = await dispatch(
      { ...storePreparing(), delivery_status: "cancelled" },
      merchant,
      ACTION.MARK_READY
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(409);
    expect(patchCalls).toEqual([]);
  });
});

