#!/usr/bin/env node
/**
 * Orders Schema Consistency Report — مقارنة أعمدة orders المتوقعة مع قاعدة البيانات.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.NODE_OPTIONS || !/use-system-ca/.test(process.env.NODE_OPTIONS)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ");
}

const {
  SCHEMA_CACHE_COLUMNS,
  EXTENDED_OPTIONAL_COLUMNS,
} = require("../shared/utils/ordersSchemaOptional");

/** أعمدة أساسية من migration_orders_unify_delivery.sql وترحيلات لاحقة */
const CORE_ORDER_COLUMNS = Object.freeze([
  "id",
  "created_at",
  "updated_at",
  "status",
  "delivery_status",
  "driver_id",
  "driver_lat",
  "driver_lng",
  "last_location_at",
  "delivery_fee",
  "external_order_id",
  "series_source",
  "customer_phone",
  "pickup_address",
  "drop_address",
  "pickup_lat",
  "pickup_lng",
  "drop_lat",
  "drop_lng",
  "distance_km",
  "notes",
  "order_number",
  "platform_fee",
  "order_total",
  "driver_earning",
  "vat_amount",
  "total_with_vat",
  "rating",
  "review",
  "invoice_number",
  "invoice_issued_at",
  "seller_name",
  "seller_vat_number",
  "invoice_url",
  "wallet_credited_at",
  "order_type",
  "portal_type",
  "service_type",
  "provider_id",
  "service_provider_id",
  "district",
  "service_location",
  "service_name",
  "customer_id",
  "total_amount",
  "rated_at",
]);

const EXPECTED_COLUMNS = [...new Set([...CORE_ORDER_COLUMNS, ...EXTENDED_OPTIONAL_COLUMNS])].sort();

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

async function fetchActualColumns(dbUrl) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders'
       ORDER BY ordinal_position`
    );
    return rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
    }));
  } finally {
    await client.end();
  }
}

function buildReport(actualCols) {
  const actualNames = new Set(actualCols.map((c) => c.name));
  const expectedSet = new Set(EXPECTED_COLUMNS);

  const missing = EXPECTED_COLUMNS.filter((c) => !actualNames.has(c));
  const extra = [...actualNames].filter((c) => !expectedSet.has(c)).sort();
  const present = EXPECTED_COLUMNS.filter((c) => actualNames.has(c));

  const schemaCacheMissing = SCHEMA_CACHE_COLUMNS.filter((c) => !actualNames.has(c));

  return {
    generated_at: new Date().toISOString(),
    table: "public.orders",
    summary: {
      expected_count: EXPECTED_COLUMNS.length,
      actual_count: actualCols.length,
      present_expected: present.length,
      missing_expected: missing.length,
      extra_columns: extra.length,
      schema_cache_missing: schemaCacheMissing.length,
      consistent: missing.length === 0,
    },
    expected_columns: EXPECTED_COLUMNS,
    actual_columns: actualCols,
    present_expected: present,
    missing_expected: missing,
    schema_cache_missing: schemaCacheMissing,
    extra_columns: extra,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Orders Schema Consistency Report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Expected columns (platform) | ${report.summary.expected_count} |`,
    `| Actual columns (database) | ${report.summary.actual_count} |`,
    `| Present & expected | ${report.summary.present_expected} |`,
    `| Missing expected | ${report.summary.missing_expected} |`,
    `| Extra (not in registry) | ${report.summary.extra_columns} |`,
    `| Schema-cache migration gaps | ${report.summary.schema_cache_missing} |`,
    `| **Consistent** | **${report.summary.consistent ? "YES" : "NO"}** |`,
    "",
  ];

  if (report.missing_expected.length) {
    lines.push("## Missing expected columns", "", "```", report.missing_expected.join("\n"), "```", "");
  } else {
    lines.push("## Missing expected columns", "", "_None — all expected columns exist._", "");
  }

  if (report.schema_cache_missing.length) {
    lines.push(
      "## Schema cache migration gaps",
      "",
      "Run: `npm run migrate:orders-schema-cache`",
      "",
      "```",
      report.schema_cache_missing.join("\n"),
      "```",
      ""
    );
  }

  if (report.extra_columns.length) {
    lines.push("## Extra columns (in DB, not in registry)", "", "```", report.extra_columns.join("\n"), "```", "");
  }

  lines.push("## Actual columns", "", "| Column | Type | Nullable |", "|--------|------|----------|");
  for (const c of report.actual_columns) {
    lines.push(`| ${c.name} | ${c.type} | ${c.nullable ? "yes" : "no"} |`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD إلى .env");
    process.exit(1);
  }

  const actual = await fetchActualColumns(dbUrl);
  const report = buildReport(actual);
  const outDir = path.join(__dirname, "..", "data");
  const jsonPath = path.join(outDir, "orders-schema-consistency-report.json");
  const mdPath = path.join(__dirname, "..", "docs", "ORDERS-SCHEMA-CONSISTENCY-REPORT.md");

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");

  console.log("[report] orders schema consistency");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`[report] JSON → ${jsonPath}`);
  console.log(`[report] MD   → ${mdPath}`);

  if (!report.summary.consistent) process.exitCode = 2;
}

main().catch((err) => {
  console.error("[report] فشل:", err.message || err);
  process.exit(1);
});
