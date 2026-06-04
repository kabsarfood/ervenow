import "dotenv/config";
import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const cols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='orders'
  ORDER BY ordinal_position
`);
console.log("orders columns sample:", cols.rows.map((r) => r.column_name).slice(0, 30).join(", "));
const txs = await c.query(`
  SELECT reference_id, type, amount, created_at
  FROM ervenow_ledger_transactions
  WHERE status='completed'
  ORDER BY created_at DESC LIMIT 30
`);
console.log("recent ledger refs:", txs.rows.map((r) => r.reference_id));
await c.end();
