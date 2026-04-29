const { createClient } = require("@supabase/supabase-js");

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
    });
  } catch (e) {
    console.error("[supabase] createServiceClient:", e.message || e);
    return null;
  }
}

/** عميل مرتبط بـ JWT المستخدم — تُطبَّق RLS حسب المستخدم */
function createUserClient(accessToken) {
  return createClient(getUrl(), getAnonKey(), {
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
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
