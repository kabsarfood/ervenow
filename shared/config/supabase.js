const { createClient } = require("@supabase/supabase-js");

try {
  const dns = require("dns");
  if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (_) {
  /* ignore */
}

/**
 * إعادة محاولة خفيفة لـ fetch (Undici) عند أخطاء شبكة عابرة — شائعة مع Supabase على بعض شبكات Windows.
 */
function wrapFetchWithRetry(baseFetch) {
  const attempts = Math.max(1, Math.min(5, Number(process.env.SUPABASE_FETCH_RETRIES) || 3));
  return async function supabaseFetch(input, init) {
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await baseFetch(input, init);
      } catch (err) {
        lastErr = err;
        const code = err && err.cause && err.cause.code;
        const retryable =
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "ENOTFOUND" ||
          code === "UND_ERR_CONNECT_TIMEOUT" ||
          (err.message && /fetch failed/i.test(String(err.message)));
        if (retryable && i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 200 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
}

function getSupabaseClientOptions() {
  const base = globalThis.fetch;
  if (typeof base !== "function") return {};
  return {
    global: {
      fetch: wrapFetchWithRetry(base),
    },
  };
}

function getUrl() {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error("SUPABASE_URL is required");
  return u;
}

function getAnonKey() {
  const k = process.env.SUPABASE_ANON_KEY;
  if (!k) throw new Error("SUPABASE_ANON_KEY is required");
  return k;
}

/**
 * مفتاح الخدمة: الاسم الرسمي أو بديل (بعض الاستضافات تقصر الاسم)
 */
function getServiceRoleKey() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
  ).trim();
}

/**
 * سبب عدم جاهزية الاتصال (للرسائل 503) — دون تسريب أسرار
 */
function getDatabaseConfigHint() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = getServiceRoleKey();
  if (!url) {
    return "اضبط متغيّر البيئة SUPABASE_URL على الخادم (رابط مشروعك من Supabase → Settings → API).";
  }
  if (!key) {
    return "اضبط SUPABASE_SERVICE_ROLE_KEY على الخادم (نفس صفحة API في Supabase: secret يسمى service_role). أعد نشر/إعادة تشغيل التطبيق بعد الحفظ.";
  }
  return "تعذر تهيئة عميل Supabase. تحقق من صحة SUPABASE_URL ومفتاح service_role في لوحة الاستضافة (Railway / إلخ).";
}

/** عميل خادم بدون جلسة (مهام داخلية فقط عند توفر SERVICE_ROLE) */
function createServiceClient() {
  const key = getServiceRoleKey();
  if (!key) return null;
  try {
    return createClient(getUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...getSupabaseClientOptions(),
    });
  } catch (e) {
    console.error("[supabase] createServiceClient:", e.message || e);
    return null;
  }
}

/** عميل مرتبط بـ JWT المستخدم — تُطبَّق RLS حسب المستخدم */
function createUserClient(accessToken) {
  const extra = getSupabaseClientOptions();
  const globalOpts = {
    ...(extra.global || {}),
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  };
  return createClient(getUrl(), getAnonKey(), {
    global: globalOpts,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = {
  createServiceClient,
  createUserClient,
  getUrl,
  getAnonKey,
  getDatabaseConfigHint,
  getServiceRoleKey,
};
