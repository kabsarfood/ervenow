#!/usr/bin/env node
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const STORE_ID = "1fcc6d83-4c7c-4fd0-8f22-7a84edaadfce";
const MERCHANT_PHONE = "966531282106";

function maskId(id) {
  const s = String(id || "");
  if (s.length < 12) return s ? s.slice(0, 4) + "…" : "";
  return s.slice(0, 8) + "…" + s.slice(-4);
}

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const merchant = await client.query(`select id, role, status from users where phone = $1`, [MERCHANT_PHONE]);
    const m = merchant.rows[0];
    const stores = m
      ? await client.query(`select id, name, owner_id, merchant_id, user_id, phone from stores where id = $1 or owner_id = $2 or merchant_id = $2 or user_id = $2 or phone like '%' || $3 limit 10`, [
          STORE_ID,
          m.id,
          MERCHANT_PHONE.slice(-9),
        ]).catch(() => ({ rows: [] }))
      : { rows: [] };

    const byStore = await client.query(
      `select lower(coalesce(delivery_status, status, '')) as st, count(*)::int as n
       from orders where store_id = $1 group by 1 order by n desc`,
      [STORE_ID]
    );
    const byMerchant = m
      ? await client.query(
          `select lower(coalesce(delivery_status, status, '')) as st, count(*)::int as n
           from orders where merchant_id = $1 group by 1 order by n desc`,
          [m.id]
        )
      : { rows: [] };
    const recent = await client.query(
      `select id, order_number, order_type, delivery_status, status, store_id, merchant_id, created_at
       from orders
       where store_id = $1 or merchant_id = $2
       order by created_at desc nulls last
       limit 8`,
      [STORE_ID, m ? m.id : "00000000-0000-0000-0000-000000000000"]
    );
    const anyAccepted = await client.query(
      `select id, order_number, order_type, delivery_status, store_id, merchant_id
       from orders
       where lower(coalesce(order_type,'')) in ('store','restaurant')
         and lower(coalesce(delivery_status, status, '')) = 'accepted'
       order by updated_at desc nulls last
       limit 5`
    );
    console.log(
      JSON.stringify(
        {
          merchant: m && { id: maskId(m.id), role: m.role, status: m.status },
          stores: stores.rows.map((s) => ({
            id: maskId(s.id),
            match_gate_store: s.id === STORE_ID,
            name: s.name,
          })),
          counts_gate_store: byStore.rows,
          counts_merchant_id: byMerchant.rows,
          recent: recent.rows.map((r) => ({
            id: maskId(r.id),
            order_number: r.order_number,
            order_type: r.order_type,
            delivery_status: r.delivery_status,
            status: r.status,
            store_match: r.store_id === STORE_ID,
            merchant_match: m && r.merchant_id === m.id,
          })),
          any_accepted_store: anyAccepted.rows.map((r) => ({
            id: maskId(r.id),
            order_number: r.order_number,
            order_type: r.order_type,
            delivery_status: r.delivery_status,
            store: maskId(r.store_id),
            merchant: maskId(r.merchant_id),
          })),
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
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
