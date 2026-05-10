/**
 * Phase 2 — Step 1: عقد انتقالات delivery_status / دورة الحياة (بدون DB).
 * ملاحظة: `status` المالي قد يستخدم onroad — انظر docs/order-lifecycle.md.
 */
const { isValidDeliveryTransition, deliveryLifecycleIndex } = require("../../shared/utils/helpers");
const { isAllowedDeliveryStatusTransition, ALLOWED_DELIVERY_TRANSITIONS } = require("../../shared/utils/deliveryStateMachine");

describe("delivery lifecycle (helpers)", () => {
  test("pending → accepted", () => {
    expect(isValidDeliveryTransition("pending", "accepted")).toBe(true);
  });

  test("accepted → delivering (skip picked)", () => {
    expect(isValidDeliveryTransition("accepted", "delivering")).toBe(true);
  });

  test("delivering → delivered", () => {
    expect(isValidDeliveryTransition("delivering", "delivered")).toBe(true);
  });

  test("accepted → delivered (driver shortcut)", () => {
    expect(isValidDeliveryTransition("accepted", "delivered")).toBe(true);
  });

  test("pending → delivered (invalid)", () => {
    expect(isValidDeliveryTransition("pending", "delivered")).toBe(false);
  });

  test("draft → pending (payment publish)", () => {
    expect(isValidDeliveryTransition("draft", "pending")).toBe(true);
  });

  test("draft → accepted (invalid)", () => {
    expect(isValidDeliveryTransition("draft", "accepted")).toBe(false);
  });
});

describe("deliveryStateMachine guard (defense in depth)", () => {
  test("map includes expected keys", () => {
    expect(ALLOWED_DELIVERY_TRANSITIONS.pending).toContain("accepted");
    expect(ALLOWED_DELIVERY_TRANSITIONS.delivering).toContain("delivered");
  });

  test("isAllowed matches helpers for normal flow", () => {
    expect(isAllowedDeliveryStatusTransition("pending", "accepted")).toBe(isValidDeliveryTransition("pending", "accepted"));
    expect(isAllowedDeliveryStatusTransition("delivering", "delivered")).toBe(true);
  });
});

describe("deliveryLifecycleIndex", () => {
  test("ordering is monotonic for main path", () => {
    const seq = ["draft", "pending", "accepted", "picked", "delivering", "delivered"];
    let prev = -Infinity;
    for (const s of seq) {
      const i = deliveryLifecycleIndex(s);
      expect(i).toBeGreaterThan(prev);
      prev = i;
    }
  });
});
