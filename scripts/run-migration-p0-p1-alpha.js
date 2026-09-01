#!/usr/bin/env node
/**
 * يطبّق ترحيلات P0 ثم P1-settlement على Postgres الاختبار.
 * لا يطبع أسراراً. لا يُشغَّل ضد Production عامة إلا بقرار مشغّل.
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

async function runSql(client, fileName) {
  const sqlPath = path.join(__dirname, "..", "shared", fileName);
  const sql = fs.readFileSync(sqlPath, "utf8");
  await client.query(sql);
  console.log("[migrate:p0-p1] applied", fileName);
}

async function verify(client) {
  const fns = await client.query(
    `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'ervenow_ledger_refund_cancelled_order',
          'settlement_log_release_claim'
        )
      ORDER BY 1`
  );
  const names = (fns.rows || []).map((r) => r.proname);
  console.log("[migrate:p0-p1] functions present:", names.join(", ") || "(none)");

  const pol = await client.query(
    `SELECT tablename, policyname, qual
       FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('ervenow_ledger_wallets', 'ervenow_ledger_transactions')
      ORDER BY 1, 2`
  );
  const usingTrue = (pol.rows || []).filter((r) => String(r.qual || "").replace(/\s/g, "") === "true");
  console.log(
    "[migrate:p0-p1] ledger policies:",
    (pol.rows || []).length,
    "USING(true) leftover:",
    usingTrue.length
  );
  return {
    refundFn: names.includes("ervenow_ledger_refund_cancelled_order"),
    releaseFn: names.includes("settlement_log_release_claim"),
    usingTrueLeft: usingTrue.length,
  };
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("[migrate:p0-p1] no SUPABASE_DB_URL / DATABASE_URL / SUPABASE_DB_PASSWORD — skip live apply");
    process.exit(2);
  }
  const { Client } = require("pg");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await runSql(client, "migration_p0_ledger_cancel_refund.sql");
    await runSql(client, "migration_p0_finance_rls_lockdown.sql");
    await runSql(client, "migration_p1_settlement_fail_closed.sql");
    const v = await verify(client);
    if (!v.refundFn || !v.releaseFn) {
      console.error("[migrate:p0-p1] verification failed");
      process.exit(1);
    }
    if (v.usingTrueLeft > 0) {
      console.error("[migrate:p0-p1] finance RLS still has USING(true)");
      process.exit(1);
    }
    console.log("[migrate:p0-p1] OK");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[migrate:p0-p1]", e && e.message ? e.message : "failed");
  process.exit(1);
});
