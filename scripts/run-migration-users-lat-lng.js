#!/usr/bin/env node
/**
 * ينفّذ shared/migration_users_lat_lng.sql على Supabase Postgres.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.NODE_OPTIONS || !/use-system-ca/.test(process.env.NODE_OPTIONS)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ");
}

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

  const enc = encodeURIComponent(pass);
  return `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
}

async function runWithPg(dbUrl, sql) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
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
  const { error } = await sb.from("users").select("id, lat, lng").limit(1);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error(
      [
        "تعذّر الاتصال بقاعدة Postgres.",
        "",
        "أضِف إلى .env:",
        "  SUPABASE_DB_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres",
        "",
        "ثم:",
        "  npm run migrate:users-lat-lng",
      ].join("\n")
    );
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, "..", "shared", "migration_users_lat_lng.sql"), "utf8");
  console.log("[migrate] تنفيذ migration_users_lat_lng.sql …");
  await runWithPg(dbUrl, sql);
  await runWithPg(dbUrl, "NOTIFY pgrst, 'reload schema';");
  console.log("[migrate] تم تنفيذ SQL على Postgres.");

  const v = await verifyWithSupabase();
  if (!v.ok) {
    console.warn("[migrate] تحذير: التحقق عبر API:", v.reason);
    process.exit(2);
  }

  console.log("[migrate] أعمدة users.lat / users.lng جاهزة.");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
