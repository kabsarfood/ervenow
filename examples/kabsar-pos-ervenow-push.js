/**
 * Kabsar POS → ERVENOW (انسخ إلى مشروع كبسار)
 * idempotency: يعيد ERVENOW { duplicated: true, order } إن تكرر external_order_id
 */
async function pushToErvenow(order, { baseUrl, token }) {
  const r = await fetch(`${String(baseUrl).replace(/\/$/, "")}/api/delivery/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      "X-Source": "kabsar-pos",
    },
    body: JSON.stringify({
      customer_phone: order.customerPhone,
      pickup_address: "مطعم كبسار",
      drop_address: order.address,
      notes: order.itemsText,
      order_total: order.total,
      delivery_fee: 0,
      external_order_id: order.orderNumber,
      series_source: "kabsar-pos",
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || String(r.status));
  }
  return r.json();
}

module.exports = { pushToErvenow };
