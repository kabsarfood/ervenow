require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(`
    SELECT proname
    FROM pg_proc
    WHERE proname IN (
      'ervenow_ledger_checkout_ew_pay',
      'ervenow_ledger_release_ew_pay_order',
      'ervenow_ledger_order_paid_via_ew_pay',
      'ervenow_ledger_pending_balance'
    )
    ORDER BY 1
  `);
  console.log("functions:", r.rows.map((x) => x.proname).join(", ") || "(none)");
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
