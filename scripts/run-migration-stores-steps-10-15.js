#!/usr/bin/env node
/**
 * ينفّذ shared/migration_stores_steps_10_15_combined.sql على Supabase Postgres.
 * يتطلب SUPABASE_DB_URL أو DATABASE_URL أو SUPABASE_DB_PASSWORD + SUPABASE_URL في .env
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

async function verify() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, reason: "SUPABASE_URL أو SERVICE_ROLE غير مضبوط" };
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const checks = [
    () => sb.from("store_withdrawals").select("id").limit(1),
    () => sb.from("platform_settings").select("key").eq("key", "checkout_payment_methods").maybeSingle(),
    () => sb.from("categories").select("id").limit(1),
  ];
  for (const fn of checks) {
    const { error } = await fn();
    if (error) return { ok: false, reason: error.message };
  }
  return { ok: true };
}

async function main() {
  const sqlPath = path.join(__dirname, "..", "shared", "migration_stores_steps_10_15_combined.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error(
      [
        "أضِف SUPABASE_DB_URL إلى .env ثم أعد التشغيل:",
        "  npm run migrate:stores-steps-10-15",
        "",
        "أو الصق يدوياً في SQL Editor:",
        "  " + sqlPath,
      ].join("\n")
    );
    process.exit(1);
  }
  console.log("[migrate] تنفيذ الخطوات 10–15 …");
  await runWithPg(dbUrl, sql);
  console.log("[migrate] تم تنفيذ SQL.");
  const v = await verify();
  if (!v.ok) {
    console.warn("[migrate] تحذير تحقق API:", v.reason);
    console.warn("جرّب Reload schema من Supabase.");
    process.exit(2);
  }
  console.log("[migrate] store_withdrawals + platform_settings + categories جاهزة.");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
