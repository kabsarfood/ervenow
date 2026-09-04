#!/usr/bin/env node
/**
 * ترحيلات Prelaunch: OTP consumed_at + حقول تسجيل العملاء.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  return null;
}

async function main() {
  const url = buildDbUrl();
  if (!url) {
    console.error("[migrate:prelaunch] SUPABASE_DB_URL missing");
    process.exit(1);
  }
  const { Client } = require("pg");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const file of ["migration_ervenow_otp_challenges.sql", "migration_prelaunch_otp_consumed.sql", "migration_prelaunch_user_attribution.sql"]) {
    const sql = fs.readFileSync(path.join(__dirname, "..", "shared", file), "utf8");
    await client.query(sql);
    console.log("[migrate:prelaunch] applied", file);
  }
  await client.end();
}

main().catch((e) => {
  console.error("[migrate:prelaunch]", e && e.message);
  process.exit(1);
});
