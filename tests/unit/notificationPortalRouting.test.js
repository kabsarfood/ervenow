const {
  notificationBelongsToPortal,
  filterNotificationsForPortal,
  enrichRoutedNotificationInput,
  eventPortalFromNotification,
} = require("../../shared/utils/notificationPortalRouting");
const { portalRoleForProvider } = require("../../shared/utils/resolvePortalRole");

describe("notificationPortalRouting", () => {
  test("enrichRoutedNotificationInput adds target_portal", () => {
    const input = enrichRoutedNotificationInput({
      recipient_type: "store",
      recipient_id: "u1",
      title: "t",
      message: "m",
      target_portal: "merchant",
    });
    expect(input.payload.target_portal).toBe("merchant");
    expect(input.payload.portal_type).toBe("merchant");
  });

  test("filters notifications by portal context", () => {
    const items = [
      { id: "1", payload: { target_portal: "service" } },
      { id: "2", payload: { target_portal: "transport" } },
      { id: "3", payload: {} },
    ];
    const serviceOnly = filterNotificationsForPortal(items, { portalRole: "service" });
    expect(serviceOnly.map((n) => n.id)).toEqual(["1", "3"]);
    expect(notificationBelongsToPortal(items[1], { portalRole: "service" })).toBe(false);
  });

  test("splits service vs transport by event prefix when target_portal missing", () => {
    const transportEvent = { id: "t1", type: "transport.request.new", payload: {} };
    const serviceEvent = { id: "s1", type: "service.request.new", payload: {} };
    expect(notificationBelongsToPortal(transportEvent, { portalRole: "transport" })).toBe(true);
    expect(notificationBelongsToPortal(transportEvent, { portalRole: "service" })).toBe(false);
    expect(notificationBelongsToPortal(serviceEvent, { portalRole: "service" })).toBe(true);
    expect(notificationBelongsToPortal(serviceEvent, { portalRole: "transport" })).toBe(false);
    expect(eventPortalFromNotification(transportEvent)).toBe("transport");
  });

  test("portalRoleForProvider matches services routes", () => {
    expect(
      portalRoleForProvider({ role: "service" }, { role: "service", service_type: "electrician" })
    ).toBe("service");
    expect(
      portalRoleForProvider({ role: "service" }, { role: "service", service_type: "pickup_truck" })
    ).toBe("transport");
  });
});
