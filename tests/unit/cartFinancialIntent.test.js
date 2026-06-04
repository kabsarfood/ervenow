/**
 * Phase E — financial intent aligns with platform commission (7%) and VAT (15%).
 */
const { computePlatformCommission, roundMoney } = require("../../shared/utils/platformCommission");

const VAT_RATE = 0.15;
const DELIVERY_PER_KM = 2.3;

function cartGoodsSubtotal(cart) {
  return roundMoney(
    (cart || []).reduce((s, it) => {
      const d = it && it.data;
      if (d && d.store_id && d.product_id != null) return s + (Number(it.price) || 0);
      return s;
    }, 0)
  );
}

function buildFinancialIntentLikeCart(cart, deliveryFee) {
  const sub = roundMoney((cart || []).reduce((s, it) => s + (Number(it.price) || 0), 0));
  const delKnown = Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) >= 0;
  const del = delKnown ? roundMoney(Number(deliveryFee)) : 0;
  const goods = cartGoodsSubtotal(cart);
  const platformOnGoods = computePlatformCommission(goods);
  const platformOnDelivery = delKnown ? computePlatformCommission(del) : 0;
  const platform_fee = roundMoney(platformOnGoods + platformOnDelivery);
  const vat = roundMoney((sub + del) * VAT_RATE);
  return {
    subtotal: sub,
    delivery_fee: delKnown ? del : null,
    vat,
    platform_fee,
    merchant_net: roundMoney(goods - platformOnGoods),
    driver_net: roundMoney(del - platformOnDelivery),
    grand_total: roundMoney(sub + del + vat),
    payment_method: "mada",
  };
}

describe("cart financial intent (Phase E)", () => {
  test("store line: merchant_net = goods - 7%, driver_net = delivery - 7% delivery commission", () => {
    const cart = [
      {
        type: "store",
        price: 100,
        data: { store_id: "s1", product_id: "p1", qty: 1 },
      },
    ];
    const delivery = roundMoney(5 * DELIVERY_PER_KM);
    const intent = buildFinancialIntentLikeCart(cart, delivery);
    expect(intent.subtotal).toBe(100);
    expect(intent.platform_fee).toBe(roundMoney(7 + computePlatformCommission(delivery)));
    expect(intent.merchant_net).toBe(93);
    expect(intent.driver_net).toBe(roundMoney(delivery - computePlatformCommission(delivery)));
    expect(intent.vat).toBe(roundMoney((100 + delivery) * VAT_RATE));
  });
});
