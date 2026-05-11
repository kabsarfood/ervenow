const { logger } = require("./logger");

const MAX_LEN = 256;

/** أعمدة لا يُزالُها الإدراج المرن — بدونها لا يُقبل السجل أو يتعطّل منطق أساسي */
const ORDERS_INSERT_NEVER_STRIP = new Set([
  "id",
  "customer_id",
  "pickup_address",
  "drop_address",
  "order_number",
  "delivery_status",
  "status",
  "pickup_lat",
  "pickup_lng",
  "drop_lat",
  "drop_lng",
  "customer_phone",
  "created_at",
  "updated_at",
]);

/**
 * يستخرج اسم عمود مفقود من رسالة PostgREST أو Postgres (مثل schema cache).
 * @returns {string|null}
 */
function parseMissingOrdersColumnFromError(err) {
  const msg = String((err && (err.message || err.details || err.hint)) || err || "");
  let m = /Could not find the '([^']+)' column of 'orders'/i.exec(msg);
  if (m) return m[1];
  m = /column "([^"]+)" of relation "orders" does not exist/i.exec(msg);
  if (m) return m[1];
  m = /column (\w+) of relation orders does not exist/i.exec(msg);
  if (m) return m[1];
  if (String(err && err.code) === "42703") {
    const m2 = /column "([^"]+)" does not exist/i.exec(msg);
    if (m2) return m2[1];
  }
  return null;
}

/**
 * إدراج في orders مع إعادة المحاولة عند غياب أعمدة اختيارية (قاعدة قديمة / schema cache).
 * لا يُعيد المحاولة عند تعارض فريد (23505) — يُرجع الخطأ للمتصل.
 */
async function insertOrdersResilient(sb, row) {
  let current = { ...row };
  const maxRounds = 40;
  for (let i = 0; i < maxRounds; i += 1) {
    const { data, error } = await sb.from("orders").insert(current).select().single();
    if (!error) return { data, error: null };

    const code = String(error.code || "");
    const em = String(error.message || error.details || "");
    if (code === "23505" || /duplicate key|unique constraint/i.test(em)) {
      return { data, error };
    }

    if (isOrdersIdempotencyColumnMissingError(error) && current.idempotency_key != null) {
      const { idempotency_key: _d, ...rest } = current;
      current = rest;
      logger.warn(
        { err: em },
        "[orders] insert: idempotency_key column missing — retrying without key; run migration_orders_idempotency_key.sql"
      );
      continue;
    }

    const missing = parseMissingOrdersColumnFromError(error);
    if (missing && !ORDERS_INSERT_NEVER_STRIP.has(missing) && Object.prototype.hasOwnProperty.call(current, missing)) {
      const { [missing]: _drop, ...rest } = current;
      current = rest;
      logger.warn(
        { missing, err: em },
        "[orders] insert: optional column missing in DB — retrying without it; run shared/migration_orders_schema_cache_columns.sql"
      );
      continue;
    }

    return { data, error };
  }
  return { data: null, error: new Error("orders insert: exceeded resilient retries") };
}

/**
 * PostgREST / Postgres: جدول orders بدون عمود idempotency_key (لم تُنفَّذ الهجرة بعد).
 */
function isOrdersIdempotencyColumnMissingError(err) {
  const msg = String((err && (err.message || err.details)) || err || "");
  const code = err && err.code != null ? String(err.code) : "";
  if (code === "42703") return true;
  return /idempotency_key/i.test(msg) && /does not exist|undefined_column|42703|schema cache/i.test(msg);
}

/** أعمدة متجر على orders غير موجودة في قاعدة قديمة */
function isOrdersStoreColumnMissingError(err) {
  const msg = String((err && (err.message || err.details)) || err || "");
  const code = err && err.code != null ? String(err.code) : "";
  if (code === "42703" && /store_/i.test(msg)) return true;
  return /store_id|store_name|store_address/i.test(msg) && /does not exist|undefined_column|42703|schema cache/i.test(msg);
}

/**
 * Reads Idempotency-Key header (case-insensitive via Express).
 * @returns {string|null}
 */
function normalizeIdempotencyKey(req) {
  const raw = req.headers["idempotency-key"];
  if (raw == null) return null;
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!s) return null;
  return s.slice(0, MAX_LEN);
}

module.exports = {
  normalizeIdempotencyKey,
  MAX_LEN,
  isOrdersIdempotencyColumnMissingError,
  isOrdersStoreColumnMissingError,
  parseMissingOrdersColumnFromError,
  insertOrdersResilient,
};
