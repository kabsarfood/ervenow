#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const m = String(process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!pass || !m) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${m[1]}.supabase.co:5432/postgres?sslmode=require`;
}
(async () => {
  const pg = require("pg");
  const c = new pg.Client({ connectionString: buildDbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    `SELECT id, name, phone, role, service_type, service_district, status, created_at
     FROM users WHERE lower(coalesce(service_type,'')) = 'pickup_truck' OR role = 'service'`
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
