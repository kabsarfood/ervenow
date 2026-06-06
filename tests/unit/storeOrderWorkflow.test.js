const { isValidDeliveryTransition } = require("../../shared/utils/helpers");
const { isAllowedDeliveryStatusTransition } = require("../../shared/utils/deliveryStateMachine");
const { isServiceOrderRow } = require("../../shared/services/completeServiceOrder");

describe("store order workflow transitions", () => {
  test("pending → accepted → preparing → ready", () => {
    expect(isValidDeliveryTransition("pending", "accepted")).toBe(true);
    expect(isValidDeliveryTransition("accepted", "preparing")).toBe(true);
    expect(isValidDeliveryTransition("preparing", "ready")).toBe(true);
  });

  test("ready → picked_up → delivering → delivered", () => {
    expect(isValidDeliveryTransition("ready", "picked_up")).toBe(true);
    expect(isValidDeliveryTransition("picked_up", "delivering")).toBe(true);
    expect(isValidDeliveryTransition("delivering", "delivered")).toBe(true);
  });

  test("state machine allows merchant chain", () => {
    expect(isAllowedDeliveryStatusTransition("pending", "accepted")).toBe(true);
    expect(isAllowedDeliveryStatusTransition("accepted", "preparing")).toBe(true);
    expect(isAllowedDeliveryStatusTransition("preparing", "ready")).toBe(true);
  });

  test("cannot skip preparing", () => {
    expect(isValidDeliveryTransition("accepted", "ready")).toBe(false);
  });
});

describe("completeServiceOrder gas_delivery", () => {
  test("isServiceOrderRow accepts gas_delivery", () => {
    expect(isServiceOrderRow({ order_type: "gas_delivery" })).toBe(true);
    expect(isServiceOrderRow({ order_type: "service" })).toBe(true);
    expect(isServiceOrderRow({ order_type: "store" })).toBe(false);
  });
});
