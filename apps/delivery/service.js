const { isValidDeliveryTransition } = require("../../shared/utils/helpers");
const { onDeliveryDelivered } = require("../finance/hooks");

async function listOrders(sb, appUser) {
  if (appUser.role === "admin") {
    return sb.from("delivery_orders").select("*").order("created_at", { ascending: false });
  }
  if (appUser.role === "driver") {
    return sb
      .from("delivery_orders")
      .select("*")
      .or(`driver_id.eq.${appUser.id},status.eq.new`)
      .order("created_at", { ascending: false });
  }
  return sb
    .from("delivery_orders")
    .select("*")
    .eq("customer_id", appUser.id)
    .order("created_at", { ascending: false });
}

async function acceptOrder(sb, orderId, driverId) {
  const { data: order, error: gErr } = await sb
    .from("delivery_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  if (order.status !== "new") return { data: null, error: new Error("Order not available") };

  const { data, error } = await sb
    .from("delivery_orders")
    .update({
      status: "accepted",
      driver_id: driverId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("status", "new")
    .select()
    .single();

  return { data, error };
}

async function setStatus(sb, orderId, nextStatus, appUser) {
  const { data: order, error: gErr } = await sb
    .from("delivery_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };

  if (appUser.role === "driver" && order.driver_id !== appUser.id) {
    return { data: null, error: new Error("Not your order") };
  }

  if (!isValidDeliveryTransition(order.status, nextStatus)) {
    return { data: null, error: new Error(`Invalid transition ${order.status} → ${nextStatus}`) };
  }

  const { data, error } = await sb
    .from("delivery_orders")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select()
    .single();

  if (!error && data && nextStatus === "delivered") {
    onDeliveryDelivered(sb, data).catch((err) => console.error("[ERWENOW] finance hook:", err.message || err));
  }

  return { data, error };
}

async function saveLocation(sb, orderId, appUser, lat, lng) {
  const { data: order, error: gErr } = await sb
    .from("delivery_orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (gErr || !order) return { data: null, error: gErr || new Error("Not found") };
  if (appUser.role !== "driver" || order.driver_id !== appUser.id) {
    return { data: null, error: new Error("Forbidden") };
  }

  const { data, error } = await sb
    .from("delivery_orders")
    .update({
      driver_lat: lat,
      driver_lng: lng,
      last_location_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  return { data, error };
}

module.exports = { listOrders, acceptOrder, setStatus, saveLocation };
