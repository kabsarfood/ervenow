/**
 * فحص المفتاح الداخلي بين كبسار و ERVENOW
 * الطلبات من كبسار تُرسل X-Internal-Key: نفس قيمة INTERNAL_API_KEY هنا
 */

function requireErvenowInternalKey(req, res, next) {
  const key = (req.headers["x-internal-key"] || "").trim();
  if (key !== String(process.env.INTERNAL_API_KEY || "").trim()) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

/**
 * نسخة لاستعمالها داخل مسار دون middleware:
 *
 *   const key = (req.headers["x-internal-key"] || "").trim();
 *   if (key !== String(process.env.INTERNAL_API_KEY || "").trim()) {
 *     return res.status(401).json({ ok: false, error: "unauthorized" });
 *   }
 */

module.exports = { requireErvenowInternalKey };
