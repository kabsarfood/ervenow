const MAX_LEN = 256;

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

module.exports = { normalizeIdempotencyKey, MAX_LEN };
