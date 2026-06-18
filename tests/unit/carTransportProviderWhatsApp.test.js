const {
  buildCarTransportProviderMessage,
  buildCarTransportProviderPanelUrl,
  buildCarTransportReserveDetailsMessage,
} = require("../../shared/services/carTransportNotify");

describe("car transport provider WhatsApp", () => {
  const booking = {
    id: "94f64bdf-e915-47a1-8a78-b9b7c712939b",
    order_number: "ED-14-001",
    service_type: "car_transport",
    payment_status: "paid",
    total_amount: 199,
    district: "الرياض",
    data: {
      plate_number: "ksa-10214",
      car: { vehicle_category: "suv", vehicle_condition: "damaged", transfer_mode: "internal" },
      from_location: { lat: 24.64, lng: 46.51, address: "الرياض — موقع الاستلام", district: "الرياض" },
      to_location: { lat: 24.7, lng: 46.65, address: "موقع التسليم" },
      pickup_maps_url: "https://maps.example/pickup",
      drop_maps_url: "https://maps.example/drop",
      sender_phone: "0530792754",
      recipient_phone: "0505745650",
    },
  };

  test("initial notify has reserve deep link without full transport details", () => {
    const url = buildCarTransportProviderPanelUrl(booking);
    expect(url).toContain("/services-provider.html?order=");
    expect(url).toContain("action=reserve");
    expect(url).toContain(encodeURIComponent("94f64bdf-e915-47a1-8a78-b9b7c712939b"));

    const msg = buildCarTransportProviderMessage(booking);
    expect(msg).toContain("ED-14-001");
    expect(msg).toContain(url);
    expect(msg).toContain("حجز الطلب");
    expect(msg).not.toContain("ksa-10214");
    expect(msg).not.toContain("maps.example/pickup");
  });

  test("reserve details message includes transport maps and phones", () => {
    const msg = buildCarTransportReserveDetailsMessage(booking, "فيصل");
    expect(msg).toContain("تم حجز طلب السطحة");
    expect(msg).toContain("ksa-10214");
    expect(msg).toContain("maps.example/pickup");
    expect(msg).toContain("0530792754");
    expect(msg).toContain("0505745650");
  });
});
