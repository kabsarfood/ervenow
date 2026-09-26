#!/usr/bin/env node
/**
 * ينفّذ shared/migration_users_last_seen_at.sql مرة واحدة.
 * بلا إعادة محاولة عند انقطاع الاتصال.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function buildDbUrl() {
  return String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
}

function hostOnly(dbUrl) {
  try {
    const u = new URL(dbUrl);
    return `${u.hostname}:${u.port || "5432"}`;
  } catch (_e) {
    return "unparsed";
  }
}

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("[migrate] SUPABASE_DB_URL غير مضبوط. لم تُنفَّذ الإضافة.");
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, "..", "shared", "migration_users_last_seen_at.sql"), "utf8");
  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout: 12000,
    statement_timeout: 12000,
  });

  console.log("[migrate] محاولة واحدة نحو", hostOnly(dbUrl));
  try {
    await client.connect();
  } catch (e) {
    console.error("[migrate] فشل الاتصال. لا إعادة محاولة.", e.message || e);
    process.exit(1);
  }

  try {
    await client.query(sql);
    const check = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'users'
         AND column_name = 'last_seen_at'`
    );
    console.log("[migrate] rows", check.rowCount);
    console.log(JSON.stringify(check.rows));
  } catch (e) {
    console.error("[migrate] فشل التنفيذ. لا إعادة محاولة.", e.message || e);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch (_e) {
      /* ignore */
    }
  }
}

main();
