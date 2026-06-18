const {
  NOTIFICATION_EVENT_CATALOG,
  catalogEntry,
  getNotificationAuditReport,
  isCancelledStatus,
  destinationFieldsChanged,
  scheduleFieldChanged,
  resolveWalletPortal,
} = require("../../shared/services/notificationEvents");

describe("notificationEvents", () => {
  test("catalog has required sprint events", () => {
    const required = [
      "merchant.order.new",
      "merchant.order.cancelled",
      "merchant.withdraw.approved",
      "merchant.withdraw.rejected",
      "driver.order.ready",
      "driver.task.assigned",
      "driver.task.cancelled",
      "driver.withdraw.approved",
      "driver.withdraw.rejected",
      "service.request.new",
      "service.schedule.updated",
      "service.order.cancelled",
      "service.withdraw.approved",
      "service.withdraw.rejected",
      "transport.request.new",
      "transport.destination.updated",
      "transport.task.cancelled",
      "transport.withdraw.approved",
      "transport.withdraw.rejected",
      "customer.order.received",
      "customer.order.accepted",
      "customer.order.in_progress",
      "customer.driver.en_route",
      "customer.order.delivered",
      "customer.order.cancelled",
      "customer.schedule.updated",
      "customer.destination.updated",
    ];
    for (const key of required) {
      expect(NOTIFICATION_EVENT_CATALOG[key]).toBeDefined();
      expect(NOTIFICATION_EVENT_CATALOG[key].target_portal).toBeTruthy();
    }
  });

  test("catalogEntry returns route metadata", () => {
    const row = catalogEntry("merchant.order.new");
    expect(row.event).toBe("merchant.order.new");
    expect(row.target_portal).toBe("merchant");
    expect(row.route).toContain("checkout");
  });

  test("getNotificationAuditReport returns table rows", () => {
    const rows = getNotificationAuditReport();
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(rows[0]).toHaveProperty("Event");
    expect(rows[0]).toHaveProperty("Portal");
    expect(rows[0]).toHaveProperty("Recipient");
    expect(rows[0]).toHaveProperty("Route");
  });

  test("isCancelledStatus recognizes cancel variants", () => {
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("canceled_by_customer")).toBe(true);
    expect(isCancelledStatus("delivered")).toBe(false);
  });

  test("field change detectors", () => {
    const before = { scheduled_at: "2026-01-01T10:00:00Z", drop_address: "A", drop_lat: 1, drop_lng: 2 };
    const afterSchedule = Object.assign({}, before, { scheduled_at: "2026-01-02T10:00:00Z" });
    const afterDest = Object.assign({}, before, { drop_address: "B" });
    expect(scheduleFieldChanged(before, afterSchedule)).toBe(true);
    expect(scheduleFieldChanged(before, before)).toBe(false);
    expect(destinationFieldsChanged(before, afterDest)).toBe(true);
    expect(destinationFieldsChanged(before, before)).toBe(false);
  });

  test("resolveWalletPortal maps roles", () => {
    expect(resolveWalletPortal({ role: "driver" })).toBe("driver");
    expect(resolveWalletPortal({ role: "store" })).toBe("merchant");
    expect(resolveWalletPortal({ role: "customer" })).toBe("customer");
  });
});
