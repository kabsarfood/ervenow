import "dotenv/config";
import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ervenow_ledger_settle_delivered_order'
  LIMIT 1
`);
const def = r.rows[0]?.def || "";
const lines = def.split("\n").filter((l) => /merchant|amt_merchant/i.test(l));
console.log("--- merchant lines ---");
console.log(lines.join("\n"));
console.log("amt_merchant:=0", /amt_merchant\s*:=\s*0/i.test(def));
const appendMerchant = def.match(/append_completed[\s\S]{0,120}/gi) || [];
console.log("append_completed count", appendMerchant.length);
for (const a of appendMerchant) if (/merchant/i.test(a)) console.log("APPEND:", a.slice(0, 200));

const dup = await c.query(`
  SELECT reference_id FROM ervenow_ledger_transactions
  WHERE status = 'completed' AND reference_id LIKE 'order:%:merchant'
  ORDER BY created_at DESC LIMIT 10
`);
const net = await c.query(`
  SELECT reference_id FROM ervenow_ledger_transactions
  WHERE status = 'completed' AND reference_id LIKE 'order:%:merchant_net'
  ORDER BY created_at DESC LIMIT 10
`);
console.log("legacy :merchant txs", dup.rows.length, dup.rows.map((x) => x.reference_id));
console.log(":merchant_net txs", net.rows.length, net.rows.map((x) => x.reference_id));
await c.end();
