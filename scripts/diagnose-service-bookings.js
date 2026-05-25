#!/usr/bin/env node
/**
 * تشخيص service_bookings من الطرفية (يتطلب SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD في .env)
 *
 *   node scripts/diagnose-service-bookings.js
 *
 * بديل: Supabase SQL Editor → shared/diagnose_service_bookings_before_migration.sql
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

async function main() {
  const url = buildDbUrl();
  if (!url) {
    console.error("اضبط SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD + SUPABASE_URL في .env");
    console.error("أو نفّذ: shared/diagnose_service_bookings_before_migration.sql في Supabase SQL Editor");
    process.exit(1);
  }

  let pg;
  try {
    pg = require("pg");
  } catch {
    console.error("npm install pg — أو استخدم SQL Editor");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const sqlPath = path.join(__dirname, "..", "shared", "diagnose_service_bookings_before_migration.sql");
  const full = fs.readFileSync(sqlPath, "utf8");

  // schema list
  const schemaQ = await client.query(`
    WITH src AS (
      SELECT CASE
        WHEN to_regclass('public.service_bookings') IS NOT NULL THEN 'service_bookings'
        WHEN to_regclass('public.service_bookings_legacy') IS NOT NULL THEN 'service_bookings_legacy'
        ELSE NULL
      END AS table_name
    )
    SELECT c.column_name, c.data_type, c.is_nullable
    FROM information_schema.columns c
    JOIN src ON src.table_name IS NOT NULL AND c.table_name = src.table_name
    WHERE c.table_schema = 'public'
    ORDER BY c.ordinal_position
  `);

  console.log("\n=== service_bookings SCHEMA ===");
  if (!schemaQ.rows.length) {
    console.log("(no service_bookings / service_bookings_legacy table)");
  } else {
    for (const r of schemaQ.rows) {
      console.log(`  ${r.column_name.padEnd(28)} ${r.data_type}  nullable=${r.is_nullable}`);
    }
  }

  // ensure diagnose function exists
  const fnBlock = full.split("-- ─── 6) التقرير الكامل")[0];
  const fromFn = fnBlock.indexOf("CREATE OR REPLACE FUNCTION public.ervenow_pick_src_col");
  if (fromFn >= 0) {
    await client.query(fnBlock.slice(fromFn));
  }

  const diag = await client.query(`SELECT public.ervenow_diagnose_service_bookings_schema() AS d`);
  const report = diag.rows[0]?.d;
  if (!report?.ok) {
    console.error("\nDiagnosis failed:", report);
    await client.end();
    process.exit(1);
  }

  console.log("\n=== SEMANTIC MAPPING (source → orders) ===");
  const m = report.semantic_mapping || {};
  for (const [k, v] of Object.entries(m)) {
    if (k === "orders_target") continue;
    console.log(`  ${String(k).padEnd(22)} → ${v ?? "(not found)"}`);
  }

  console.log("\n=== MISSING CRITICAL ===");
  console.log(JSON.stringify(report.missing_critical, null, 2));

  console.log("\n=== UNMAPPED SOURCE COLUMNS (→ orders.data) ===");
  console.log(JSON.stringify(report.unmapped_source_columns, null, 2));

  // sample
  const tbl = report.source_table;
  if (tbl) {
    const sample = await client.query(`SELECT * FROM public.${tbl} LIMIT 5`);
    console.log(`\n=== SAMPLE (5 rows from ${tbl}) ===`);
    console.log(JSON.stringify(sample.rows, null, 2));
  }

  console.log("\n=== GENERATED INSERT SQL (review then run) ===\n");
  console.log(report.generated_insert_sql);

  await client.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
