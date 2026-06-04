import "dotenv/config";
import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const s = await c.query(`
  SELECT id, store_id, delivery_status, order_total, platform_fee, driver_id, created_at
  FROM orders
  WHERE store_id IS NOT NULL
    AND lower(coalesce(delivery_status, status, '')) = 'delivered'
  ORDER BY created_at DESC
  LIMIT 5
`);
console.log(JSON.stringify(s.rows, null, 2));
await c.end();
