const fs = require("fs");
const os = require("os");
const path = require("path");
const { isPosEnabled, setPosEnabled, setPosMode, posMode, platformOrderIntakeOpen } = require("../../shared/utils/merchantPosSettings");
const { preparePosTicket, unitPrice } = require("../../shared/services/merchantPosOrder");

describe("merchant POS setting", () => {
  test("POS is on unless the store turns it off, and platform intake stays open", () => {
    const file = path.join(os.tmpdir(), "ervenow-pos-flags-" + Date.now() + ".json");
    const storeId = "store-1";
    expect(isPosEnabled(storeId, file)).toBe(true);
    expect(setPosEnabled(storeId, false, file)).toBe(false);
    expect(isPosEnabled(storeId, file)).toBe(false);
    expect(platformOrderIntakeOpen()).toBe(true);
    setPosEnabled(storeId, true, file);
    expect(isPosEnabled(storeId, file)).toBe(true);
    fs.unlinkSync(file);
  });

  test("pos mode stays A or B and does not enable C", () => {
    const file = path.join(os.tmpdir(), "ervenow-pos-mode-" + Date.now() + ".json");
    const storeId = "store-1";
    expect(posMode(storeId, file)).toBe("A");
    expect(setPosMode(storeId, "B", file)).toBe("B");
    setPosEnabled(storeId, false, file);
    expect(isPosEnabled(storeId, file)).toBe(false);
    expect(posMode(storeId, file)).toBe("B");
    expect(function () { setPosMode(storeId, "C", file); }).toThrow(/C/);
    expect(posMode(storeId, file)).toBe("B");
    fs.unlinkSync(file);
  });
});

describe("merchant POS ticket uses the store catalog", () => {
  const products = [
    { id: "a", name: "شاورما عربي", price: 16, offer_price: 14, active: true },
    { id: "b", name: "بطاطس", price: 8, active: true },
    { id: "c", name: "مخفي", price: 5, active: false },
  ];

  test("offer price and 15% VAT come from catalog rows", () => {
    expect(unitPrice(products[0])).toBe(14);
    const ticket = preparePosTicket({
      products: products,
      fulfillment: "local",
      payment: "cash",
      lines: [
        { product_id: "a", qty: 2 },
        { product_id: "b", qty: 1 },
      ],
    });
    expect(ticket.ok).toBe(true);
    expect(ticket.subtotal).toBe(36);
    expect(ticket.vat).toBe(5.4);
    expect(ticket.total).toBe(41.4);
    expect(ticket.payment_method).toBe("cash");
    expect(ticket.items[0].name).toBe("شاورما عربي");
  });

  test("unknown, hidden, or empty lines are rejected", () => {
    expect(
      preparePosTicket({
        products: products,
        fulfillment: "pickup",
        payment: "network",
        lines: [{ product_id: "missing", qty: 1 }],
      }).ok
    ).toBe(false);
    expect(
      preparePosTicket({
        products: products,
        fulfillment: "delivery",
        payment: "electronic",
        lines: [{ product_id: "c", qty: 1 }],
      }).ok
    ).toBe(false);
    expect(preparePosTicket({ products: products, fulfillment: "local", payment: "cash", lines: [] }).ok).toBe(false);
  });
});
