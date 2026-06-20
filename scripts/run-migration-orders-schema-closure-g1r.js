/**
 * Run G1-R orders schema closure migration (7 missing columns).
 * Usage: node scripts/run-migration-orders-schema-closure-g1r.js
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

async function main() {
  const dbUrl = buildDbUrl();
  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD إلى .env");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "shared", "migration_orders_schema_closure_g1r.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--") && s !== "NOTIFY pgrst, 'reload schema'");

  const { Client } = require("pg");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const stmt of statements) {
      if (!stmt) continue;
      await client.query(stmt);
      console.log("[migrate] OK:", stmt.split("\n")[0].slice(0, 80));
    }
    try {
      await client.query("NOTIFY pgrst, 'reload schema'");
    } catch (_) {}
    console.log("[migrate] migration_orders_schema_closure_g1r applied");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
