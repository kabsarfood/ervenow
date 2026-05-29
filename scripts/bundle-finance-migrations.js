#!/usr/bin/env node
/**
 * يدمج هجرات المالية في ملف واحد للصق في Supabase SQL Editor.
 * npm run migrate:finance:bundle
 */
const fs = require("fs");
const path = require("path");

const SHARED = path.join(__dirname, "..", "shared");
const OUT = path.join(SHARED, "RUN_ALL_FINANCE_MIGRATIONS.sql");

const FILES = [
  "migration_database_refactor_05_settlement_log.sql",
  "migration_finance_patch_existing_tables.sql",
  "migration_finance_core_functions.sql",
  "migration_bootstrap_ledger_finance.sql",
  "migration_driver_ledger_settle_fix.sql",
  "migration_finance_grants.sql",
];

/** جداول السحب موجودة في bootstrap — نُضيف دوال الملخص والموافقة فقط */
const WITHDRAW_FUNCTIONS_ONLY = "migration_ervenow_ledger_withdraw_requests.sql";
const WITHDRAW_SKIP_UNTIL = "-- ——— ملخص مالي للأدمن";

function main() {
  const parts = [
    "-- =============================================================================",
    "-- ERVENOW — هجرة مالية موحّدة (انسخ هذا الملف بالكامل → Supabase SQL Editor → Run)",
    "-- =============================================================================",
    "-- الترتيب: settlement_log → ledger → إصلاح أجر المندوب → ملخص الأدمن والسحب",
    "-- بعد التنفيذ: Supabase → Settings → API → Reload schema",
    "-- ثم أعد تشغيل خادم Node",
    "-- =============================================================================",
    "",
    "-- إصلاح: إن كان withdraw_requests عرضاً قديماً نحذفه ليُنشأ كجدول",
    "DO $$",
    "BEGIN",
    "  IF EXISTS (",
    "    SELECT 1 FROM pg_class c",
    "    JOIN pg_namespace n ON n.oid = c.relnamespace",
    "    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests' AND c.relkind IN ('v', 'm')",
    "  ) THEN",
    "    EXECUTE 'DROP VIEW IF EXISTS public.withdraw_requests CASCADE';",
    "  END IF;",
    "END $$;",
    "",
    "DROP FUNCTION IF EXISTS public.ervenow_ledger_user_wallet_summary(uuid, text);",
    "DROP FUNCTION IF EXISTS public.ervenow_ledger_finance_summary();",
    "DROP FUNCTION IF EXISTS public.ervenow_ledger_settle_delivered_order(uuid);",
    "DROP FUNCTION IF EXISTS public.ervenow_ledger_credit(uuid, numeric, text, text, text);",
    "DROP FUNCTION IF EXISTS public.ervenow_ledger_credit(uuid, numeric, text, text);",
    "DROP FUNCTION IF EXISTS public.ledger_withdraw_request_approve(uuid);",
    "",
  ];

  for (const name of FILES) {
    const fp = path.join(SHARED, name);
    if (!fs.existsSync(fp)) {
      console.warn("[bundle] تخطي — غير موجود:", name);
      continue;
    }
    parts.push(`-- ─── ${name} ───`);
    parts.push(fs.readFileSync(fp, "utf8").trim());
    parts.push("");
    parts.push("NOTIFY pgrst, 'reload schema';");
    parts.push("");
  }

  const wfp = path.join(SHARED, WITHDRAW_FUNCTIONS_ONLY);
  if (fs.existsSync(wfp)) {
    let wsql = fs.readFileSync(wfp, "utf8");
    const idx = wsql.indexOf(WITHDRAW_SKIP_UNTIL);
    if (idx >= 0) wsql = wsql.slice(idx);
    parts.push(`-- ─── ${WITHDRAW_FUNCTIONS_ONLY} (دوال فقط — بدون إعادة إنشاء الجداول) ───`);
    parts.push(wsql.trim());
    parts.push("");
    parts.push("NOTIFY pgrst, 'reload schema';");
    parts.push("");
  }

  parts.push("-- تحقق سريع:");
  parts.push("SELECT 'ervenow_ledger_wallets' AS tbl, count(*)::int AS n FROM public.ervenow_ledger_wallets");
  parts.push("UNION ALL SELECT 'ervenow_ledger_transactions', count(*)::int FROM public.ervenow_ledger_transactions");
  parts.push("UNION ALL SELECT 'settlement_log', count(*)::int FROM public.settlement_log");
  parts.push("UNION ALL SELECT 'withdraw_requests', count(*)::int FROM public.withdraw_requests;");

  fs.writeFileSync(OUT, parts.join("\n"), "utf8");
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log("[bundle] OK →", OUT);
  console.log("[bundle] الحجم تقريباً:", kb, "KB");
  console.log("[bundle] افتح الملف → Ctrl+A → Ctrl+C → Supabase SQL Editor → Run");
}

main();
