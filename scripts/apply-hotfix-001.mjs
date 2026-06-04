import "dotenv/config";
import fs from "fs";
import pg from "pg";

const sql = fs.readFileSync(
  new URL("../shared/migration_hotfix_001_merchant_settle.sql", import.meta.url),
  "utf8"
);
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query(sql);
console.log("OK: hotfix-001 applied");
await c.end();
