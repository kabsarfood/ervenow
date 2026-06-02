#!/usr/bin/env node
/**
 * ينفّذ shared/migration_ervenow_pay_checkout.sql على قاعدة Supabase.
 *
 * مطلوب في .env:
 *   SUPABASE_DB_URL أو DATABASE_URL
 *   أو SUPABASE_DB_PASSWORD + SUPABASE_URL
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

  const { error } = await sb.rpc("ervenow_ledger_order_paid_via_ew_pay", {
    p_order_id: "00000000-0000-0000-0000-000000000000",
  });
  if (error) {
    if (/function.*does not exist|schema cache/i.test(String(error.message || ""))) {
      return { ok: false, reason: error.message };
    }
  }
  return { ok: true };
}

async function main() {
  const sqlPath = path.join(__dirname, "..", "shared", "migration_ervenow_pay_checkout.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error(
      [
        "تعذّر الاتصال بقاعدة Postgres لتنفيذ الـ migration تلقائياً.",
        "",
        "أضِف إلى .env:",
        "  SUPABASE_DB_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres",
        "  أو SUPABASE_DB_PASSWORD=كلمة_مرور_قاعدة_البيانات",
        "",
        "ثم:",
        "  npm run migrate:ervenow-pay-checkout",
      ].join("\n")
    );
    process.exit(1);
  }

  console.log("[migrate] تنفيذ migration_ervenow_pay_checkout.sql …");
  await runWithPg(dbUrl, sql);
  console.log("[migrate] تم تنفيذ SQL على Postgres.");

  const v = await verifyWithSupabase();
  if (!v.ok) {
    console.warn("[migrate] تحذير: التحقق عبر API:", v.reason);
    console.warn("قد يحتاج PostgREST بضع ثوانٍ لتحديث schema cache.");
    process.exit(2);
  }

  console.log("[migrate] دوال ERVENOW PAY جاهزة (checkout_ew_pay، release، pending_balance).");
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  if (/28P01|password authentication/i.test(String(err.message || err))) {
    console.error("تحقق من كلمة مرور قاعدة البيانات في SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD.");
  }
  process.exit(1);
});
