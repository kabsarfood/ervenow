#!/usr/bin/env node
/**
 * ينفّذ shared/migration_orders_portal_type.sql على Supabase
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

async function verifyPortalType(dbUrl) {
  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const col = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'portal_type'
    `);
    const counts = await client.query(`
      SELECT portal_type, COUNT(*)::int AS n
      FROM public.orders
      GROUP BY portal_type
      ORDER BY portal_type NULLS LAST
    `);
    const nulls = await client.query(`
      SELECT COUNT(*)::int AS n FROM public.orders WHERE portal_type IS NULL
    `);
    return {
      columnExists: (col.rows || []).length > 0,
      counts: counts.rows || [],
      nullCount: nulls.rows?.[0]?.n ?? null,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD مطلوب في .env");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "shared", "migration_orders_portal_type.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  console.log("[migrate] تنفيذ migration_orders_portal_type.sql …");
  await runWithPg(dbUrl, sql);
  await runWithPg(dbUrl, "NOTIFY pgrst, 'reload schema';");
  console.log("[migrate] تم التنفيذ على Postgres.");

  const report = await verifyPortalType(dbUrl);
  if (!report.columnExists) {
    console.error("[migrate] فشل التحقق: عمود portal_type غير موجود");
    process.exit(2);
  }

  console.log("[migrate] توزيع portal_type:");
  for (const row of report.counts) {
    console.log(`  ${row.portal_type ?? "(null)"}: ${row.n}`);
  }
  console.log(`[migrate] بدون portal_type: ${report.nullCount}`);
  console.log("[migrate] orders.portal_type جاهز.");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
