const {
  isTransportServiceType,
  isServiceOnlyType,
  classifyUserRoleBucket,
  matchesProviderSegment,
} = require("../../shared/utils/adminRoleTaxonomy");

describe("adminRoleTaxonomy", () => {
  test("classifies transport vs home/gas service users", () => {
    expect(classifyUserRoleBucket({ role: "service", service_type: "pickup_truck" })).toBe("transport");
    expect(classifyUserRoleBucket({ role: "service", service_type: "gas_cylinder_swap" })).toBe("service");
    expect(classifyUserRoleBucket({ role: "service", service_type: "electrician" })).toBe("service");
  });

  test("provider segment filters", () => {
    const transportUser = { role: "service", service_type: "car_transport" };
    const serviceUser = { role: "service", service_type: "plumber" };
    expect(matchesProviderSegment(transportUser, "transport")).toBe(true);
    expect(matchesProviderSegment(transportUser, "service")).toBe(false);
    expect(matchesProviderSegment(serviceUser, "service")).toBe(true);
    expect(isTransportServiceType("pickup_truck")).toBe(true);
    expect(isServiceOnlyType("ac_technician")).toBe(true);
  });
});
