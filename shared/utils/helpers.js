function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

function fail(res, message, status = 400, extra = {}) {
  if (process.env.NODE_ENV === "production" && status === 500) {
    return res.status(status).json({ ok: false, error: "Internal server error" });
  }
  return res.status(status).json({ ok: false, error: message, ...extra });
}

function extractBearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

/** طلب مفتوح (لم يُسند بعد) — new قديم، pending شائع؛ draft لا يُعرض للمناديب */
const OPEN_DELIVERY_STATUSES = new Set(["new", "pending"]);

function deliveryLifecycleIndex(s) {
  const x = String(s || "")
    .trim()
    .toLowerCase();
  if (x === "draft") return -2;
  if (x === "new" || x === "pending") return 0;
  if (x === "accepted") return 1;
  if (x === "picked") return 2;
  if (x === "delivering") return 3;
  if (x === "delivered") return 4;
  return -1;
}

const DELIVERY_STATUSES = ["draft", "pending", "accepted", "picked", "delivering", "delivered"];

function isValidDeliveryTransition(from, to) {
  const f = String(from || "")
    .trim()
    .toLowerCase();
  const t = String(to || "")
    .trim()
    .toLowerCase();
  if (!t) return false;
  // تأكيد الدفع: مسودة → جاهز للنشر للمناديب
  if (f === "draft" && t === "pending") return true;
  if (f === "draft") return t === "draft";

  const i = deliveryLifecycleIndex(f);
  const j = deliveryLifecycleIndex(t);
  if (i < 0 || j < 0) return false;
  if (j === i || j === i + 1) return true;
  // تخطّي picked: مقبول → قيد التوصيل
  if (f === "accepted" && t === "delivering") return true;
  // واجهة المندوب: تسليم مباشر من «مقبول» دون المرور بـ «قيد التوصيل»
  if (t === "delivered" && f === "accepted") return true;
  return false;
}

module.exports = {
  ok,
  fail,
  extractBearer,
  isValidDeliveryTransition,
  DELIVERY_STATUSES,
  OPEN_DELIVERY_STATUSES,
  deliveryLifecycleIndex,
};
