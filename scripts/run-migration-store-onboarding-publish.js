#!/usr/bin/env node
/**
 * ينفّذ shared/migration_store_onboarding_publish.sql ثم يعيد تحميل PostgREST schema cache.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function projectRefFromSupabaseUrl() {
  const u = String(process.env.SUPABASE_URL || "").trim();
  const m = u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const ref = projectRefFromSupabaseUrl();
  if (!pass || !ref) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
}

async function runWithPg(dbUrl, sql) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function verifyWithSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, reason: "SUPABASE_URL أو SERVICE_ROLE غير مضبوط" };
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb
    .from("stores")
    .select("id, publication_status, license_number, license_file_url, needs_info_message, needs_info_at")
    .limit(1);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function main() {
  const dbUrl = buildDbUrl();
  const sqlPath = path.join(__dirname, "..", "shared", "migration_store_onboarding_publish.sql");
  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD إلى .env ثم أعد التشغيل.");
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("[migrate] تنفيذ migration_store_onboarding_publish.sql …");
  await runWithPg(dbUrl, sql);
  await runWithPg(dbUrl, "NOTIFY pgrst, 'reload schema';");
  const v = await verifyWithSupabase();
  if (!v.ok) {
    console.warn("[migrate] SQL نُفّذ لكن التحقق عبر API فشل:", v.reason);
    process.exit(2);
  }
  console.log("[migrate] publication_status / license / needs_info جاهزة وschema cache محدّث.");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
