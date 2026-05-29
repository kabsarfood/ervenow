#!/usr/bin/env node
/**
 * تنفيذ هجرة المالية على Supabase تلقائياً.
 *
 * مطلوب في .env (أحدها):
 *   SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres
 *   أو DATABASE_URL
 *   أو SUPABASE_URL + SUPABASE_DB_PASSWORD
 *
 *   npm run migrate:finance:bundle
 *   npm run migrate:finance
 *
 * بدون .env: انسخ shared/RUN_ALL_FINANCE_MIGRATIONS.sql إلى Supabase SQL Editor.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const LITE_STEPS = [
  "migration_database_refactor_05_settlement_log.sql",
  "migration_finance_patch_existing_tables.sql",
  "migration_finance_core_functions.sql",
  "migration_driver_ledger_settle_fix.sql",
];

const FULL_STEPS = [
  "migration_database_refactor_05_settlement_log.sql",
  "migration_finance_patch_existing_tables.sql",
  "migration_finance_core_functions.sql",
  "migration_bootstrap_ledger_finance.sql",
  "migration_driver_ledger_settle_fix.sql",
  "migration_finance_grants.sql",
];

async function runWithPg(dbUrl, sql, label) {
  let Client;
  try {
    Client = require("pg").Client;
  } catch (_e) {
    console.error("ثبّت pg: npm install pg --save-dev");
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    if (label) console.log("[migrate:finance] ✓", label);
  } finally {
    await client.end();
  }
}

function readSharedSql(name) {
  return fs.readFileSync(path.join(__dirname, "..", "shared", name), "utf8");
}

function withdrawFunctionsOnly() {
  const wsql = readSharedSql("migration_ervenow_ledger_withdraw_requests.sql");
  const marker = "-- ——— ملخص مالي للأدمن";
  const idx = wsql.indexOf(marker);
  return idx >= 0 ? wsql.slice(idx) : wsql;
}

async function ledgerTablesExist(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ervenow_ledger_wallets' LIMIT 1`
  );
  return rows.length > 0;
}

async function runMigrationsStepByStep(dbUrl) {
  const viewFix = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind IN ('v', 'm')
  ) THEN
    EXECUTE 'DROP VIEW IF EXISTS public.withdraw_requests CASCADE';
  END IF;
END $$;
`;
  await runWithPg(dbUrl, viewFix, "fix withdraw_requests view");

  const dropOldFns = `
DROP FUNCTION IF EXISTS public.ervenow_ledger_user_wallet_summary(uuid, text);
DROP FUNCTION IF EXISTS public.ervenow_ledger_finance_summary();
DROP FUNCTION IF EXISTS public.ervenow_ledger_settle_delivered_order(uuid);
DROP FUNCTION IF EXISTS public.ervenow_ledger_settle_service_booking(uuid);
DROP FUNCTION IF EXISTS public.ervenow_ledger_credit(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.ervenow_ledger_credit(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.ledger_withdraw_request_approve(uuid);
DROP FUNCTION IF EXISTS public.ervenow_ledger_withdraw_atomic(uuid);
`;
  await runWithPg(dbUrl, dropOldFns, "drop conflicting functions");

  let steps = FULL_STEPS;
  let Client = require("pg").Client;
  const probe = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await probe.connect();
  try {
    if (await ledgerTablesExist(probe)) {
      steps = LITE_STEPS;
      console.log("[migrate:finance] جداول ledger موجودة — مسار ترقية خفيف (lite)");
    } else {
      console.log("[migrate:finance] تثبيت كامل (bootstrap)");
    }
  } finally {
    await probe.end();
  }

  for (const name of steps) {
    await runWithPg(dbUrl, readSharedSql(name), name);
  }
  await runWithPg(dbUrl, withdrawFunctionsOnly(), "withdraw RPCs");
  await runWithPg(dbUrl, readSharedSql("migration_finance_grants.sql"), "migration_finance_grants.sql");
  await runWithPg(dbUrl, "NOTIFY pgrst, 'reload schema';", "reload schema");
}

async function verify() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const checks = [
    { name: "ervenow_ledger_wallets", fn: () => sb.from("ervenow_ledger_wallets").select("id", { count: "exact", head: true }) },
    { name: "ervenow_ledger_settle_delivered_order", fn: () => sb.rpc("ervenow_ledger_settle_delivered_order", { p_order_id: "00000000-0000-0000-0000-000000000000" }) },
  ];

  for (const c of checks) {
    try {
      const { error } = await c.fn();
      if (c.name.includes("settle")) {
        const msg = String(error?.message || "");
        if (/order_not_found|not_delivered/i.test(msg) || !error) {
          console.log("[verify] OK — دالة", c.name, "موجودة");
        } else if (/does not exist|schema cache/i.test(msg)) {
          console.warn("[verify] FAIL —", c.name, ":", msg);
        } else {
          console.log("[verify] OK —", c.name, "(استجابة متوقعة)");
        }
      } else if (error && /does not exist|schema cache/i.test(String(error.message || ""))) {
        console.warn("[verify] FAIL — جدول", c.name);
      } else {
        console.log("[verify] OK — جدول", c.name);
      }
    } catch (e) {
      console.warn("[verify]", c.name, e.message || e);
    }
  }
}

async function main() {
  const bundleScript = path.join(__dirname, "bundle-finance-migrations.js");
  spawnSync(process.execPath, [bundleScript], { stdio: "inherit", cwd: path.join(__dirname, "..") });

  const sqlPath = path.join(__dirname, "..", "shared", "RUN_ALL_FINANCE_MIGRATIONS.sql");
  if (!fs.existsSync(sqlPath)) {
    console.error("لم يُنشأ الملف:", sqlPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, "utf8");
  const dbUrl = buildDbUrl();

  if (!dbUrl) {
    console.log("");
    console.log("══════════════════════════════════════════════════════════");
    console.log("  لا يوجد اتصال بقاعدة البيانات في .env");
    console.log("  الملف الجاهز للنسخ:");
    console.log("  ", sqlPath);
    console.log("");
    console.log("  الخطوات:");
    console.log("  1) supabase.com → مشروعك → SQL Editor → New query");
    console.log("  2) افتح RUN_ALL_FINANCE_MIGRATIONS.sql بمحرر النصوص");
    console.log("  3) Ctrl+A ثم Ctrl+C ثم الصق في SQL Editor");
    console.log("  4) Run");
    console.log("  5) Settings → API → Reload schema");
    console.log("══════════════════════════════════════════════════════════");
    process.exit(0);
  }

  console.log("[migrate:finance] جارٍ التنفيذ على قاعدة البيانات…");
  try {
    await runMigrationsStepByStep(dbUrl);
    console.log("[migrate:finance] تم التنفيذ بنجاح.");
    await verify();
    console.log("[migrate:finance] أعد تشغيل خادم Node ثم نفّذ reconcile للطلبات القديمة إن لزم.");
  } catch (e) {
    console.error("[migrate:finance] فشل:", e.message || e);
    console.error("بديل: الصق محتوى", sqlPath, "في Supabase SQL Editor يدوياً.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
