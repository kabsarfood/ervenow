/**
 * Dry-run كامل عبر PostgreSQL فقط (يتجاوز fetch failed من Supabase REST).
 */
import "dotenv/config";
import crypto from "crypto";
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await c.connect();

  const drv = await c.query(`SELECT id FROM users WHERE role = 'driver' LIMIT 1`);
  const driverId = drv.rows[0]?.id;
  if (!driverId) {
    console.error("FAIL: no driver user");
    process.exit(1);
  }

  let merchantId = null;
  const m = await c.query(`SELECT id FROM users WHERE role = 'merchant' LIMIT 1`);
  merchantId = m.rows[0]?.id;
  if (!merchantId) {
    merchantId = crypto.randomUUID();
    await c.query(`INSERT INTO users (id, phone, role) VALUES ($1, $2, 'merchant')`, [
      merchantId,
      "0501111222",
    ]);
  }

  const orderId = crypto.randomUUID();
  const orderNumber = "DRY-" + Date.now();
  const orderTotal = 100;
  const platformFee = 7;
  const deliveryFee = 20;
  const driverEarning = 18;
  const merchantNet = 93;

  await c.query(
    `INSERT INTO orders (
      id, order_number, order_total, total_amount, platform_fee, delivery_fee,
      driver_earning, delivery_status, status, customer_phone, driver_id, data
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'delivered','delivered',$8,$9,$10::jsonb)`,
    [
      orderId,
      orderNumber,
      orderTotal,
      orderTotal + deliveryFee,
      platformFee,
      deliveryFee,
      driverEarning,
      "0500000099",
      driverId,
      JSON.stringify({ store_id: crypto.randomUUID(), dry_run: true }),
    ]
  );
  console.log("order", orderId);

  const settle = await c.query(`SELECT public.ervenow_ledger_settle_delivered_order($1::uuid) AS r`, [
    orderId,
  ]);
  console.log("settle_rpc", settle.rows[0]?.r);

  const merchRef = `order:${orderId}:merchant_net`;
  const dep = await c.query(
    `SELECT public.ervenow_ledger_deposit($1::uuid, 'merchant', $2::numeric, $3::text, $4::text) AS r`,
    [merchantId, merchantNet, merchRef, `صافي متجر dry-run ${orderNumber}`]
  );
  console.log("merchant_deposit", dep.rows[0]?.r);

  const txs = await c.query(
    `SELECT reference_id, type, amount FROM ervenow_ledger_transactions
     WHERE status = 'completed' AND reference_id LIKE $1 ORDER BY reference_id`,
    [`order:${orderId}:%`]
  );
  const refs = txs.rows.map((r) => r.reference_id);
  console.log("ledger_refs", refs);

  const prefix = `order:${orderId}:`;
  const ok =
    refs.includes(`${prefix}earning`) &&
    refs.includes(`${prefix}commission`) &&
    refs.includes(`${prefix}merchant_net`) &&
    !refs.includes(`${prefix}merchant`);

  if (!ok) process.exit(1);
  console.log("DRY_RUN_OK", orderId);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
