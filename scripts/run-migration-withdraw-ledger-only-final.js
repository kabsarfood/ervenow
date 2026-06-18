#!/usr/bin/env node
/**
 * ينفّذ shared/migration_withdraw_ledger_only_final.sql على Supabase مرة واحدة
 * مع نسخة احتياطية نصية للبنية قبل التنفيذ وتقرير بعده.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.NODE_OPTIONS || !/use-system-ca/.test(process.env.NODE_OPTIONS)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ");
}

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const u = String(process.env.SUPABASE_URL || "").trim();
  const m = u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!pass || !m) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${m[1]}.supabase.co:5432/postgres?sslmode=require`;
}

const STRUCTURE_SQL = `
SELECT
  c.relname AS object_name,
  CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE c.relkind::text END AS kind,
  pg_get_viewdef(c.oid, true) AS view_definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('ervenow_withdraw_requests', 'withdraw_requests');

SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('ervenow_withdraw_requests', 'withdraw_requests')
ORDER BY c.table_name, c.ordinal_position;

SELECT
  tc.constraint_name,
  tc.table_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
LEFT JOIN information_schema.check_constraints cc
  ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('ervenow_withdraw_requests', 'withdraw_requests')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ervenow_withdraw_requests', 'withdraw_requests')
ORDER BY tablename, indexname;
`;

function formatStructureReport(rows) {
  const lines = [];
  const objects = rows[0]?.rows || [];
  const columns = rows[1]?.rows || [];
  const constraints = rows[2]?.rows || [];
  const indexes = rows[3]?.rows || [];

  for (const obj of objects) {
    lines.push(`=== ${obj.object_name} (${obj.kind}) ===`);
    if (obj.view_definition) {
      lines.push("VIEW DEFINITION:");
      lines.push(obj.view_definition);
      lines.push("");
    }
    const cols = columns.filter((c) => c.table_name === obj.object_name);
    if (cols.length) {
      lines.push("COLUMNS:");
      for (const c of cols) {
        let type = c.data_type;
        if (c.data_type === "USER-DEFINED") type = c.udt_name;
        if (c.numeric_precision) type += `(${c.numeric_precision}${c.numeric_scale != null ? "," + c.numeric_scale : ""})`;
        lines.push(
          `  ${c.column_name} ${type} ${c.is_nullable === "NO" ? "NOT NULL" : "NULL"}${c.column_default ? " DEFAULT " + c.column_default : ""}`
        );
      }
      lines.push("");
    } else if (obj.kind === "VIEW") {
      lines.push("(VIEW columns via information_schema may be empty — see VIEW DEFINITION above)");
      lines.push("");
    }
    const cons = constraints.filter((x) => x.table_name === obj.object_name);
    if (cons.length) {
      lines.push("CONSTRAINTS:");
      for (const c of cons) {
        let line = `  ${c.constraint_type} ${c.constraint_name}`;
        if (c.column_name) line += ` (${c.column_name})`;
        if (c.foreign_table_name) line += ` -> ${c.foreign_table_name}(${c.foreign_column_name})`;
        if (c.check_clause) line += ` CHECK ${c.check_clause}`;
        lines.push(line);
      }
      lines.push("");
    }
    const idx = indexes.filter((i) => i.indexname && i.indexdef?.includes(obj.object_name));
    if (idx.length) {
      lines.push("INDEXES:");
      for (const i of idx) lines.push(`  ${i.indexname}: ${i.indexdef}`);
      lines.push("");
    }
  }

  if (!objects.length) {
    lines.push("(لا يوجد ervenow_withdraw_requests أو withdraw_requests في public قبل التنفيذ)");
  }
  return lines.join("\n");
}

async function dumpStructure(client) {
  const parts = STRUCTURE_SQL.split(";").map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const q of parts) {
    const r = await client.query(q);
    results.push(r);
  }
  return formatStructureReport(results);
}

async function postMigrationChecks(client) {
  const kindQ = await client.query(`
    SELECT c.relname, CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' ELSE c.relkind::text END AS kind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'withdraw_requests'
  `);
  const colsQ = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ervenow_withdraw_requests'
    ORDER BY ordinal_position
  `);
  const rpcQ = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'ledger_withdraw_request_approve'
    ) AS exists
  `);
  return {
    withdraw_requests_kind: kindQ.rows[0]?.kind || "MISSING",
    ervenow_columns: colsQ.rows,
    has_iban: colsQ.rows.some((c) => c.column_name === "iban"),
    has_processed_at: colsQ.rows.some((c) => c.column_name === "processed_at"),
    approve_rpc_ok: rpcQ.rows[0]?.exists === true,
  };
}

async function testWithdrawInsert(sb) {
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, role")
    .in("role", ["driver", "merchant", "service", "transport"])
    .limit(1)
    .maybeSingle();
  if (userErr || !user?.id) {
    return { ok: false, step: "find_user", error: userErr?.message || "no suitable user" };
  }

  const testAmount = 50;
  const testIban = "SA0380000000608010167519";
  const { data: inserted, error: insErr } = await sb
    .from("ervenow_withdraw_requests")
    .insert({
      user_id: user.id,
      amount: testAmount,
      iban: testIban,
      status: "pending",
      note: "migration_test_withdraw_post",
    })
    .select("id, user_id, amount, iban, status, created_at")
    .single();

  if (insErr) {
    const msg = String(insErr.message || "");
    const missingTable = /ervenow_withdraw_requests|schema cache|relation|does not exist/i.test(msg);
    return {
      ok: false,
      step: "insert",
      error: insErr.message,
      missing_table_message: missingTable ? "جدول طلبات السحب غير موجود" : null,
    };
  }

  return { ok: true, request_id: inserted.id, user_id: user.id, inserted };
}

async function testApproveRpc(sb, requestId) {
  const { data, error } = await sb.rpc("ledger_withdraw_request_approve", {
    p_request_id: requestId,
  });
  if (error) {
    const msg = String(error.message || "");
    return {
      ok: false,
      error: error.message,
      rpc_missing: /ledger_withdraw_request_approve|does not exist|schema cache/i.test(msg),
    };
  }
  return { ok: true, result: data };
}

async function cleanupTestRequest(client, requestId) {
  if (!requestId) return;
  await client.query(`DELETE FROM public.ervenow_withdraw_requests WHERE id = $1 AND note = 'migration_test_withdraw_post'`, [
    requestId,
  ]);
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL مطلوب في .env");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "shared", "migration_withdraw_ledger_only_final.sql");
  const migrationSql = fs.readFileSync(sqlPath, "utf8");

  const { Client } = require("pg");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const report = {
    backup_before: "",
    migration_executed: false,
    structure_after: "",
    checks: null,
    test_withdraw: null,
    test_approve: null,
    missing_table_message_gone: null,
  };

  try {
    console.log("=== BACKUP BEFORE (text) ===");
    report.backup_before = await dumpStructure(client);
    console.log(report.backup_before);

    console.log("\n=== RUNNING MIGRATION (once) ===");
    await client.query(migrationSql);
    report.migration_executed = true;
    console.log("Migration SQL executed successfully.");

    report.structure_after = await dumpStructure(client);
    report.checks = await postMigrationChecks(client);

    await client.end();

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    const { createClient } = require("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // wait for PostgREST schema cache
    await new Promise((r) => setTimeout(r, 3000));

    report.test_withdraw = await testWithdrawInsert(sb);
    if (report.test_withdraw.ok && report.test_withdraw.request_id) {
      report.test_approve = await testApproveRpc(sb, report.test_withdraw.request_id);
    }

    report.missing_table_message_gone =
      report.test_withdraw.ok === true && !report.test_withdraw.missing_table_message;

    // cleanup test row (reconnect for delete)
    if (report.test_withdraw.request_id) {
      const c2 = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await c2.connect();
      try {
        await cleanupTestRequest(c2, report.test_withdraw.request_id);
      } finally {
        await c2.end();
      }
    }

    const outPath = path.join(__dirname, "..", "shared", "migration_withdraw_ledger_only_final_report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

    console.log("\n=== REPORT SUMMARY ===");
    console.log(JSON.stringify({
      withdraw_requests_kind: report.checks?.withdraw_requests_kind,
      has_iban: report.checks?.has_iban,
      has_processed_at: report.checks?.has_processed_at,
      approve_rpc_ok: report.checks?.approve_rpc_ok,
      test_withdraw: report.test_withdraw,
      test_approve: report.test_approve,
      missing_table_message_gone: report.missing_table_message_gone,
      report_file: outPath,
    }, null, 2));
  } catch (err) {
    await client.end().catch(() => {});
    console.error("FAILED:", err.message || err);
    process.exit(1);
  }
}

main();
