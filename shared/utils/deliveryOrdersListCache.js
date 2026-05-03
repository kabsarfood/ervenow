const { getClient, cacheGetJson, cacheSetJson } = require("./redisCache");

const EPOCH_KEY = "delivery:orders:list_epoch";
const LIST_CACHE_TTL_MS = 5000;

async function readListEpoch() {
  const r = getClient();
  if (!r) return "0";
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    const v = await r.get(EPOCH_KEY);
    return v != null && v !== "" ? String(v) : "0";
  } catch {
    return "0";
  }
}

/** بعد أي تغيير يؤثر على قائمة الطلبات (مندوب/عميل/عدّ ضيف) — يُبطل مفاتيح الكاش القديمة. */
async function bumpDeliveryOrdersListEpoch() {
  const r = getClient();
  if (!r) return;
  try {
    if (r.status === "wait" || r.status === "end") await r.connect().catch(() => {});
    await r.incr(EPOCH_KEY);
  } catch {
    /* ignore */
  }
}

function buildOrdersListCacheKey(req, epoch) {
  const e = String(epoch || "0");
  if (!req.appUser) return `orders:${e}:guest`;
  const id = req.appUser.id;
  const role = String(req.appUser.role || "user");
  return `orders:${e}:${id}:${role}`;
}

module.exports = {
  readListEpoch,
  bumpDeliveryOrdersListEpoch,
  buildOrdersListCacheKey,
  LIST_CACHE_TTL_MS,
};
