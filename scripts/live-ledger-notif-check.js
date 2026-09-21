#!/usr/bin/env node
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const ORDER_ID = "48cebd16-b4a3-42f6-b54d-b3978c8b7c46";

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const ledger = await client.query(
      `select count(*)::int as n from ervenow_ledger_transactions
       where reference_id::text = $1 or metadata::text ilike '%' || $1 || '%'`,
      [ORDER_ID]
    );
    const notif = await client.query(
      `select count(*)::int as n, max(title) as last_title, max(type) as last_type
       from notifications
       where payload::text ilike '%' || $1 || '%'`,
      [ORDER_ID]
    );
    const notifRows = await client.query(
      `select recipient_type, title, type, created_at
       from notifications
       where payload::text ilike '%' || $1 || '%'
       order by created_at desc
       limit 8`,
      [ORDER_ID]
    );
    const wallets = await client.query(
      `select count(*)::int as n from ervenow_ledger_transactions t
       join ervenow_ledger_wallets w on w.id = t.wallet_id
       where t.reference_id::text = $1`,
      [ORDER_ID]
    ).catch((e) => ({ rows: [{ n: -1, error: e.message }] }));
    console.log(
      JSON.stringify(
        {
          ledger: ledger.rows[0],
          wallets: wallets.rows[0],
          notif: notif.rows[0],
          notif_rows: notifRows.rows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
