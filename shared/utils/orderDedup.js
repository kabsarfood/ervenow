/**
 * منع تكرار طلبات الزائر — idempotency_key + كشف طلب مشابه حديثاً.
 */

const DEFAULT_DEDUP_WINDOW_MS = 2 * 60 * 1000;

function roundCoord(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 1e5) / 1e5;
}

function isIdempotencyKeyUniqueViolation(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err.details || "");
  if (code === "23505" && /idempotency/i.test(msg)) return true;
  return /idx_orders_customer_idempotency|customer_idempotency/i.test(msg);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} customerId
 * @param {string} idempotencyKey
 */
async function fetchOrderByCustomerIdempotencyKey(sb, customerId, idempotencyKey) {
  const cid = String(customerId || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!sb || !cid || !key) return null;

  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("customer_id", cid)
    .eq("idempotency_key", key)
    .maybeSingle();

  if (error) {
    if (/idempotency_key|does not exist|schema cache/i.test(String(error.message || ""))) return null;
    throw error;
  }
  return data || null;
}

/**
 * طلب توصيل مماثل للزائر خلال نافذة زمنية (نفس النقاط تقريباً).
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} customerId
 * @param {object} row — صف الإدراج المقترح
 * @param {number} [windowMs]
 */
async function findRecentSimilarDeliveryOrder(sb, customerId, row, windowMs = DEFAULT_DEDUP_WINDOW_MS) {
  const cid = String(customerId || "").trim();
  if (!sb || !cid || !row) return null;

  const plat = roundCoord(row.pickup_lat);
  const plng = roundCoord(row.pickup_lng);
  const dlat = roundCoord(row.drop_lat);
  const dlng = roundCoord(row.drop_lng);
  if (plat == null || plng == null || dlat == null || dlng == null) return null;

  const since = new Date(Date.now() - Math.max(30_000, Number(windowMs) || DEFAULT_DEDUP_WINDOW_MS)).toISOString();

  let q = sb
    .from("orders")
    .select("*")
    .eq("customer_id", cid)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);

  const storeId = row.store_id != null ? String(row.store_id).trim() : "";
  if (storeId) {
    q = q.eq("store_id", storeId);
  }

  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache/i.test(String(error.message || ""))) return null;
    throw error;
  }

  for (const o of data || []) {
    if (roundCoord(o.pickup_lat) !== plat || roundCoord(o.pickup_lng) !== plng) continue;
    if (roundCoord(o.drop_lat) !== dlat || roundCoord(o.drop_lng) !== dlng) continue;
    const st = String(o.delivery_status || o.status || "").toLowerCase();
    if (st === "cancelled" || st === "cancelled_by_customer") continue;
    return o;
  }
  return null;
}

module.exports = {
  DEFAULT_DEDUP_WINDOW_MS,
  isIdempotencyKeyUniqueViolation,
  fetchOrderByCustomerIdempotencyKey,
  findRecentSimilarDeliveryOrder,
};
