import "dotenv/config";
import fs from "fs";
import pg from "pg";

const sql = fs.readFileSync(
  new URL("../shared/migration_ervenow_otp_challenges.sql", import.meta.url),
  "utf8"
);
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query(sql);
const t = await c.query(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ervenow_otp_challenges'
  ) AS ok
`);
console.log("otp_table_exists:", t.rows[0]?.ok);
await c.end();
