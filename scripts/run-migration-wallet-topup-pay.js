#!/usr/bin/env node
/**
 * ينفّذ shared/migration_wallet_topup_pay.sql على Supabase Postgres.
 * npm run migrate:wallet-topup-pay
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
  const sqlPath = path.join(__dirname, "..", "shared", "migration_wallet_topup_pay.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const dbUrl = buildDbUrl();

  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD + SUPABASE_URL إلى .env");
    process.exit(1);
  }

  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  console.log("[migrate] تنفيذ migration_wallet_topup_pay.sql …");
  await client.connect();
  try {
    await client.query(sql);

    const stc = await client.query(
      "SELECT value FROM public.platform_settings WHERE key = 'stcpay_display_number'"
    );
    const tables = await client.query(
      "SELECT to_regclass('public.wallet_topup_requests') AS req, to_regclass('public.wallet_topup_codes') AS codes"
    );

    console.log("[migrate] stcpay_display_number =", stc.rows[0]?.value || "(missing)");
    console.log("[migrate] wallet_topup_requests =", tables.rows[0]?.req || "missing");
    console.log("[migrate] wallet_topup_codes =", tables.rows[0]?.codes || "missing");
    console.log("[migrate] تم بنجاح.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
