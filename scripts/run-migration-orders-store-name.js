#!/usr/bin/env node
/**
 * ينفّذ shared/migration_orders_store_name.sql على Supabase Postgres.
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

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD إلى .env ثم أعد التشغيل.");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "shared", "migration_orders_store_name.sql"), "utf8");
  await runWithPg(dbUrl, sql);
  await runWithPg(dbUrl, "NOTIFY pgrst, 'reload schema';");
  console.log("[migrate] orders.store_name / store_address جاهزان.");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
