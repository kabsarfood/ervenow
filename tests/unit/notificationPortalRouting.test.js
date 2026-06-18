const {
  notificationBelongsToPortal,
  filterNotificationsForPortal,
  enrichRoutedNotificationInput,
} = require("../../shared/utils/notificationPortalRouting");

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
});
