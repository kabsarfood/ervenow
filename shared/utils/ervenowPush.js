async function pushToErvenow(order) {
  const base = String(process.env.ERVENOW_BASE || "").replace(/\/$/, "");
  const url =
    process.env.ERVENOW_DELIVERY_ORDERS_URL ||
    (base ? `${base}/api/delivery/orders` : "");

  if (!url) {
    console.error("ERVENOW PUSH SKIPPED: missing ERVENOW_BASE or ERVENOW_DELIVERY_ORDERS_URL");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Source": "kabsar-web",
  };
  const token = String(process.env.ERVENOW_PUSH_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer_phone: order.customerPhone || "",
        pickup_address: process.env.ERVENOW_PICKUP_ADDRESS || "مطعم كبسار",
        drop_address: order.address || "",
        notes: order.itemsText || "",
        order_total: Number(order.total) || 0,
        delivery_fee: 0,
        external_order_id: String(order.orderNumber || ""),
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("ERVENOW PUSH FAIL:", j);
    } else {
      console.log("ERVENOW PUSH OK:", j && j.order && j.order.id);
    }
  } catch (e) {
    console.error("ERVENOW PUSH ERROR:", e.message || e);
  }
}

module.exports = { pushToErvenow };
