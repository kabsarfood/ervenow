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

/** عميل خادم بدون جلسة (مهام داخلية فقط عند توفر SERVICE_ROLE) */
function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(getUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
};
