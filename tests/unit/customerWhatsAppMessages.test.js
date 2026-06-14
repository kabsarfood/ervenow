const {
  buildCustomerMessageOrderPaid,
  buildCustomerMessageOrderAccepted,
  buildCustomerMessageOrderPickedUp,
  buildCustomerMessageDriverArrived,
  buildPublicTrackUrl,
  orderNumber,
} = require("../../shared/messages/deliveryCustomerWhatsApp");

describe("unified customer WhatsApp messages", () => {
  beforeAll(() => {
    process.env.ERVENOW_PUBLIC_URL = "http://localhost:4000";
  });

  const carOrder = {
    id: "uuid-1",
    order_number: "ED-13-001",
    customer_phone: "966501234567",
    payment_status: "paid",
    service_type: "car_transport",
    delivery_fee: 199,
    total_with_vat: 228.85,
    pickup_address: "حي النخيل",
    drop_address: "حي الورود",
    distance_km: 22.6,
    data: {
      car: {
        vehicle_category: "sedan",
        vehicle_condition: "working",
        transfer_mode: "internal",
      },
      pickup_district_label: "النخيل",
      drop_district_label: "الورود",
    },
  };

  test("paid message includes welcome, order no, details, phone, track link with order number", () => {
    const msg = buildCustomerMessageOrderPaid(carOrder);
    expect(msg).toContain("ERVENOW - ترحب بكم");
    expect(msg).toContain("الطلب رقم ED-13-001");
    expect(msg).toContain("نقل مركبات");
    expect(msg).toContain("الجوال: 0501234567");
    expect(msg).toContain("track?id=ED-13-001");
    expect(msg).toContain("تحميل الطلب");
  });

  test("accepted message uses unified accept wording", () => {
    const msg = buildCustomerMessageOrderAccepted(carOrder, "966509876543");
    expect(msg).toContain("عزيزنا صاحب الطلب رقم (ED-13-001)");
    expect(msg).toContain("تم استلام الطلب");
    expect(msg).toContain("0509876543");
  });

  test("picked up message mentions on the way", () => {
    const msg = buildCustomerMessageOrderPickedUp(carOrder);
    expect(msg).toContain("عزيزنا صاحب الطلب رقم (ED-13-001)");
    expect(msg).toContain("في الطريق");
  });

  test("arrived message uses destination wording", () => {
    const msg = buildCustomerMessageDriverArrived(carOrder);
    expect(msg).toContain("عزيزنا صاحب الطلب رقم (ED-13-001)");
    expect(msg).toContain("وصل المندوب إلى وجهتك");
  });

  test("track url prefers order number", () => {
    expect(buildPublicTrackUrl(carOrder)).toBe("http://localhost:4000/track?id=ED-13-001");
    expect(orderNumber(carOrder)).toBe("ED-13-001");
  });
});
