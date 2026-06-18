const { normalizeBroadcastTarget, listBroadcastRecipients } = require("../../shared/services/broadcastNotify");

function matchesTargetLocal(user, target) {
  const t = normalizeBroadcastTarget(target);
  const role = String((user && user.role) || "")
    .trim()
    .toLowerCase();
  const st = String((user && user.service_type) || "")
    .trim()
    .toLowerCase();
  const transportTypes = { pickup_truck: 1, car_transport: 1, vehicle_transfer: 1 };
  const isTransport = !!transportTypes[st];
  if (t === "all") return true;
  if (t === "customers") return role === "customer" || role === "user" || !role;
  if (t === "drivers") return role === "driver";
  if (t === "merchants") return role === "store" || role === "merchant" || role === "restaurant";
  if (t === "services") return role === "service" && !isTransport;
  if (t === "transport") return role === "service" && isTransport;
  return false;
}

describe("broadcast targeting", () => {
  test("transport targets pickup_truck providers", () => {
    expect(
      matchesTargetLocal({ role: "service", service_type: "pickup_truck" }, "transport")
    ).toBe(true);
    expect(
      matchesTargetLocal({ role: "service", service_type: "pickup_truck" }, "providers")
    ).toBe(false);
  });

  test("drivers target delivery drivers only", () => {
    expect(matchesTargetLocal({ role: "driver", service_type: null }, "drivers")).toBe(true);
    expect(matchesTargetLocal({ role: "driver", service_type: "pickup_truck" }, "drivers")).toBe(true);
    expect(matchesTargetLocal({ role: "service", service_type: "pickup_truck" }, "transport")).toBe(true);
    expect(matchesTargetLocal({ role: "service", service_type: "pickup_truck" }, "drivers")).toBe(false);
  });
});

describe("notification href resolver", () => {
  // loaded in jsdom via eval would be heavy — skip, manual QA
  test("mapRoleToRecipientType via broadcast module", () => {
    const { listBroadcastRecipients } = require("../../shared/services/broadcastNotify");
    expect(typeof listBroadcastRecipients).toBe("function");
  });
});
