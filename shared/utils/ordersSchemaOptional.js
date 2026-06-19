/**
 * أعمدة orders الاختيارية — توحيد الترحيل والقراءة المرنة عبر البوابات.
 */

const { parseMissingOrdersColumnFromError } = require("./idempotency");

/** من shared/migration_orders_schema_cache_columns.sql */
const SCHEMA_CACHE_COLUMNS = Object.freeze([
  "payment_status",
  "payment_method",
  "idempotency_key",
  "store_id",
  "store_name",
  "store_address",
  "breakdown",
  "data",
  "merchant_id",
  "service_provider_id",
  "delivery_order_id",
  "country_code",
  "city",
  "currency_code",
]);

/** أعمدة إضافية يتوقعها كود البوابات (ترحيلات منفصلة) */
const EXTENDED_OPTIONAL_COLUMNS = Object.freeze([
  ...SCHEMA_CACHE_COLUMNS,
  "portal_type",
  "order_type",
  "service_type",
  "provider_id",
  "service_provider_id",
  "district",
  "service_location",
  "service_name",
  "platform_commission",
  "scheduled_at",
  "delivered_at",
  "rating",
  "review",
  "rated_at",
]);

const DRIVER_COMPLETED_ORDER_COLUMNS = Object.freeze([
  "id",
  "order_number",
  "delivery_status",
  "status",
  "created_at",
  "updated_at",
  "store_name",
  "drop_address",
  "data",
  "breakdown",
]);

const MERCHANT_ORDER_BOARD_COLUMNS = Object.freeze([
  "id",
  "order_number",
  "order_total",
  "total_with_vat",
  "total_amount",
  "delivery_fee",
  "platform_fee",
  "status",
  "delivery_status",
  "created_at",
  "breakdown",
  "data",
  "customer_phone",
  "drop_address",
  "drop_lat",
  "drop_lng",
  "pickup_address",
  "pickup_lat",
  "pickup_lng",
  "store_id",
  "store_name",
  "payment_status",
  "payment_method",
  "driver_id",
]);

const MERCHANT_DASHBOARD_ORDER_COLUMNS = Object.freeze([
  "id",
  "order_number",
  "order_total",
  "total_with_vat",
  "delivery_fee",
  "platform_fee",
  "status",
  "delivery_status",
  "created_at",
  "breakdown",
  "data",
  "customer_phone",
  "drop_address",
  "store_id",
  "payment_status",
  "payment_method",
]);

function isOrdersColumnError(error, column) {
  const missing = parseMissingOrdersColumnFromError(error);
  if (missing) {
    return column ? missing === column : true;
  }
  if (!column) return false;
  return new RegExp(`orders\\.${column}|column[^a-z]*${column}`, "i").test(
    String((error && error.message) || "")
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string[]} columns
 * @param {(q: import("@supabase/supabase-js").PostgrestFilterBuilder) => import("@supabase/supabase-js").PostgrestFilterBuilder} applyFilters
 */
async function selectOrdersResilient(sb, columns, applyFilters) {
  let cols = [...new Set((columns || []).filter(Boolean))];
  const maxRounds = cols.length + 2;

  for (let i = 0; i < maxRounds; i += 1) {
    if (!cols.length) {
      return { data: null, error: new Error("orders select: no columns left"), columnsUsed: [] };
    }
    let q = sb.from("orders").select(cols.join(","));
    if (typeof applyFilters === "function") {
      q = applyFilters(q);
    }
    const result = await q;
    if (!result.error) {
      return { data: result.data, error: null, columnsUsed: cols };
    }
    const missing = parseMissingOrdersColumnFromError(result.error);
    if (!missing || !cols.includes(missing)) {
      return { data: result.data, error: result.error, columnsUsed: cols };
    }
    cols = cols.filter((c) => c !== missing);
  }

  return { data: null, error: new Error("orders select: exceeded resilient retries"), columnsUsed: cols };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} orderId
 * @param {string[]} columns
 */
async function fetchOrderByIdResilient(sb, orderId, columns) {
  const id = String(orderId || "").trim();
  if (!id) return { data: null, error: new Error("missing order id") };
  return selectOrdersResilient(sb, columns, (q) => q.eq("id", id).maybeSingle());
}

module.exports = {
  SCHEMA_CACHE_COLUMNS,
  EXTENDED_OPTIONAL_COLUMNS,
  DRIVER_COMPLETED_ORDER_COLUMNS,
  MERCHANT_ORDER_BOARD_COLUMNS,
  MERCHANT_DASHBOARD_ORDER_COLUMNS,
  isOrdersColumnError,
  selectOrdersResilient,
  fetchOrderByIdResilient,
  parseMissingOrdersColumnFromError,
};
