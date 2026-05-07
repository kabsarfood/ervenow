const MAX_LEN = 256;

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
};
