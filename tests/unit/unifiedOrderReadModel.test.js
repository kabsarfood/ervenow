const {
  WORKFLOW,
  UNIFIED_STATUS,
  FULFILLER_TYPE,
  resolveCustomerOrderWorkflow,
  resolveUnifiedOrderStatus,
  resolveCurrentActorType,
  resolveFulfillerType,
  customerStatusLabel,
  workflowTypeLabel,
  statusLabelForRole,
  projectCustomerOrderReadModel,
} = require("../../shared/domain/orders/unifiedReadModel");

function originalKeysOf(row) {
  return Object.keys(row).filter(
    (k) =>
      k !== "workflow" &&
      k !== "status_unified" &&
      k !== "fulfiller_type" &&
      k !== "current_actor_type" &&
      k !== "available_actions"
  );
}

describe("unifiedOrderReadModel", () => {
  test("store order new/pending → created, merchant fulfiller, originals kept", () => {
    const row = {
      id: "o-store-new",
      order_number: "ES-21-101",
      order_type: "store",
      store_id: "s1",
      store_name: "كبسار",
      delivery_status: "pending",
      status: "new",
      customer_id: "c1",
      order_total: 40,
    };
    const out = projectCustomerOrderReadModel(row);
    expect(out.workflow).toBe(WORKFLOW.STORE);
    expect(out.status_unified).toBe(UNIFIED_STATUS.CREATED);
    expect(out.current_actor_type).toBe(FULFILLER_TYPE.MERCHANT);
    expect(out.fulfiller_type).toBe(out.current_actor_type);
    expect(out.delivery_status).toBe("pending");
    expect(out.status).toBe("new");
    expect(out.store_id).toBe("s1");
    expect(originalKeysOf(row).every((k) => out[k] === row[k])).toBe(true);
    expect(customerStatusLabel(out.workflow, out.status_unified)).toBe("تم استلام طلبك");
  });

  test("store order accepted → accepted, still merchant", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      merchant_id: "m1",
      delivery_status: "accepted",
    });
    expect(out.workflow).toBe("store");
    expect(out.status_unified).toBe("accepted");
    expect(out.current_actor_type).toBe("merchant");
    expect(out.fulfiller_type).toBe("merchant");
    expect(out.delivery_status).toBe("accepted");
    expect(customerStatusLabel("store", "accepted")).toBe("تم قبول طلبك");
  });

  test("store order ready → ready, merchant until pickup", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "restaurant",
      store_id: "s1",
      delivery_status: "ready",
    });
    expect(out.workflow).toBe("store");
    expect(out.status_unified).toBe("ready");
    expect(out.current_actor_type).toBe("merchant");
    expect(workflowTypeLabel(out, out.workflow)).toBe("طلب مطعم");
    expect(customerStatusLabel("store", "ready")).toBe("طلبك جاهز للاستلام");
  });

  test("store preparing → preparing / in_progress label", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      delivery_status: "preparing",
    });
    expect(out.status_unified).toBe("preparing");
    expect(customerStatusLabel("store", "in_progress")).toBe("جاري تجهيز طلبك");
    expect(customerStatusLabel("store", "preparing")).toBe("جاري تجهيز طلبك");
  });

  test("driver assigned on delivery-only order → assigned", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "delivery",
      delivery_status: "accepted",
      driver_id: "d1",
      pickup_lat: 17.8,
      pickup_lng: 42.2,
      drop_lat: 17.9,
      drop_lng: 42.3,
    });
    expect(out.workflow).toBe("delivery");
    expect(out.status_unified).toBe("assigned");
    expect(out.current_actor_type).toBe("driver");
    expect(out.driver_id).toBe("d1");
    expect(out.delivery_status).toBe("accepted");
  });

  test("picked up store order → driver fulfiller", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      driver_id: "d1",
      delivery_status: "picked_up",
    });
    expect(out.workflow).toBe("store");
    expect(out.status_unified).toBe("picked_up");
    expect(out.current_actor_type).toBe("driver");
    expect(out.delivery_status).toBe("picked_up");
  });

  test("picked alias normalizes to picked_up unified, original kept", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "delivery",
      driver_id: "d1",
      delivery_status: "picked",
    });
    expect(out.status_unified).toBe("picked_up");
    expect(out.delivery_status).toBe("picked");
  });

  test("delivered/completed store order", () => {
    const delivered = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      driver_id: "d1",
      delivery_status: "delivered",
    });
    expect(delivered.status_unified).toBe("completed");
    expect(delivered.delivery_status).toBe("delivered");
    expect(delivered.current_actor_type).toBeNull();

    const alias = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      delivery_status: "completed",
    });
    expect(alias.status_unified).toBe("completed");
    expect(alias.delivery_status).toBe("completed");
  });

  test("service order accepted with provider → assigned", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "electrician",
      provider_id: "p1",
      delivery_status: "accepted",
    });
    expect(out.workflow).toBe("service");
    expect(out.status_unified).toBe("assigned");
    expect(out.current_actor_type).toBe("service_provider");
    expect(out.delivery_status).toBe("accepted");
    expect(customerStatusLabel("service", "assigned")).toBe("تم تعيين مزود الخدمة");
  });

  test("service in progress via sp_status", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "plumber",
      provider_id: "p1",
      delivery_status: "delivering",
      data: { sp_status: "in_progress" },
    });
    expect(out.workflow).toBe("service");
    expect(out.status_unified).toBe("in_progress");
    expect(out.current_actor_type).toBe("service_provider");
    expect(out.delivery_status).toBe("delivering");
    expect(out.data.sp_status).toBe("in_progress");
    expect(customerStatusLabel("service", "in_progress")).toBe("جاري تنفيذ الخدمة");
  });

  test("service completed via delivered", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "plumber",
      provider_id: "p1",
      delivery_status: "delivered",
    });
    expect(out.status_unified).toBe("completed");
    expect(out.delivery_status).toBe("delivered");
    expect(out.current_actor_type).toBeNull();
    expect(customerStatusLabel("service", "completed")).toBe("اكتملت الخدمة");
  });

  test("transport order in transit", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "car_transport",
      provider_id: "t1",
      delivery_status: "delivering",
    });
    expect(out.workflow).toBe("transport");
    expect(out.status_unified).toBe("in_transit");
    expect(out.current_actor_type).toBe("transport_provider");
    expect(out.delivery_status).toBe("delivering");
    expect(customerStatusLabel("transport", "in_transit")).toBe("مزود النقل في الطريق");
  });

  test("internal_delivery stays driver workflow, not transport", () => {
    const unassigned = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "internal_delivery",
      delivery_status: "pending",
    });
    expect(unassigned.workflow).toBe("internal_delivery");
    expect(unassigned.status_unified).toBe("created");
    expect(unassigned.current_actor_type).toBeNull();

    const assigned = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "internal_delivery",
      driver_id: "d9",
      delivery_status: "accepted",
    });
    expect(assigned.workflow).toBe("internal_delivery");
    expect(assigned.status_unified).toBe("assigned");
    expect(assigned.current_actor_type).toBe("driver");
    expect(assigned.delivery_status).toBe("accepted");
  });

  test("internal_delivery in transit uses driver label", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "internal_delivery",
      driver_id: "d9",
      delivery_status: "delivering",
    });
    expect(out.status_unified).toBe("in_transit");
    expect(customerStatusLabel("internal_delivery", "in_transit")).toBe("طلبك في الطريق إليك");
  });

  test("cancelled keeps original cancelled_by_customer", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      delivery_status: "cancelled_by_customer",
    });
    expect(out.status_unified).toBe("cancelled");
    expect(out.delivery_status).toBe("cancelled_by_customer");
    expect(out.current_actor_type).toBeNull();
  });

  test("cancelled delivery_status on service", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "electrician",
      delivery_status: "cancelled",
    });
    expect(out.status_unified).toBe("cancelled");
    expect(out.delivery_status).toBe("cancelled");
    expect(out.current_actor_type).toBeNull();
  });

  test("unknown original status stays original and maps to unknown", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      delivery_status: "waiting_for_parts",
    });
    expect(out.status_unified).toBe("unknown");
    expect(out.delivery_status).toBe("waiting_for_parts");
    expect(out.workflow).toBe("store");
  });

  test("unassigned service has null fulfiller_type", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "plumber",
      delivery_status: "new",
    });
    expect(out.current_actor_type).toBeNull();
    expect(out.status_unified).toBe("created");
  });

  test("car polishing cp_status on_the_way → in_transit", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "service",
      service_type: "car_polishing",
      provider_id: "p2",
      delivery_status: "delivering",
      data: { cp_status: "on_the_way" },
    });
    expect(out.workflow).toBe("service");
    expect(out.status_unified).toBe("in_transit");
    expect(out.data.cp_status).toBe("on_the_way");
    expect(out.delivery_status).toBe("delivering");
  });

  test("resolve helpers match projection", () => {
    const row = { order_type: "store", store_id: "s1", delivery_status: "ready" };
    expect(resolveCustomerOrderWorkflow(row)).toBe("store");
    expect(resolveUnifiedOrderStatus(row)).toBe("ready");
    expect(resolveCurrentActorType(row)).toBe("merchant");
  });

  test("store ready with driver_id → assigned / driver actor", () => {
    const out = projectCustomerOrderReadModel({
      order_type: "store",
      store_id: "s1",
      driver_id: "d1",
      delivery_status: "ready",
    });
    expect(out.status_unified).toBe("assigned");
    expect(out.current_actor_type).toBe("driver");
    expect(out.delivery_status).toBe("ready");
  });

  test("role labels are presentation only", () => {
    expect(statusLabelForRole("customer", "store", "preparing")).toBe("جاري تجهيز طلبك");
    expect(statusLabelForRole("merchant", "store", "preparing")).toBe("جاري التجهيز");
    expect(statusLabelForRole("service", "service", "in_progress")).toBe("قيد التنفيذ");
    expect(statusLabelForRole("transport", "transport", "in_transit")).toBe("في الطريق");
  });
});
