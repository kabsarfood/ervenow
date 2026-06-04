/**
 * Dry-run ledger via pg + Node settlement (يتجاوز RLS).
 */
import "dotenv/config";
import crypto from "crypto";
import { createRequire } from "module";
import pg from "pg";

const require = createRequire(import.meta.url);
const { createServiceClient } = require("../shared/config/supabase.js");
const { runDeliveredFinancialSettlement } = require("../shared/services/deliveredFinancialSettlement.js");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await c.connect();
  const cols = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
  `);
  const colSet = new Set(cols.rows.map((r) => r.column_name));
  const hasStoreId = colSet.has("store_id");

  const storesExist = await c.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='stores') AS ok
  `);
  let storeId = null;
  let storePhone = "966501111222";
  if (storesExist.rows[0]?.ok) {
    const s = await c.query(`SELECT id, phone FROM stores LIMIT 1`);
    if (s.rows[0]) {
      storeId = s.rows[0].id;
      storePhone = s.rows[0].phone || storePhone;
    } else {
      storeId = crypto.randomUUID();
      await c.query(
        `INSERT INTO stores (id, name, phone, status, is_active) VALUES ($1, 'Dry Run Store', $2, 'approved', true)`,
        [storeId, storePhone]
      );
      console.log("inserted store", storeId);
    }
  } else {
    storeId = crypto.randomUUID();
    console.log("no stores table — using synthetic store_id on order", storeId);
  }

  const merch = await c.query(`SELECT id FROM users WHERE role IN ('merchant','store') LIMIT 1`);
  let merchantId = merch.rows[0]?.id || null;
  if (!merchantId) {
    merchantId = crypto.randomUUID();
    await c.query(
      `INSERT INTO users (id, phone, role, status) VALUES ($1, $2, 'merchant', 'active') ON CONFLICT DO NOTHING`,
      [merchantId, "0501111222"]
    ).catch(async () => {
      await c.query(`INSERT INTO users (id, phone, role) VALUES ($1, $2, 'merchant')`, [
        merchantId,
        "0501111222",
      ]);
    });
  }

  const drv = await c.query(`SELECT id FROM users WHERE role = 'driver' LIMIT 1`);
  const driverId = drv.rows[0]?.id || null;

  const orderId = crypto.randomUUID();
  const orderTotal = 100;
  const platformFee = 7;
  const deliveryFee = 20;
  const driverEarning = 18;

  const row = {
    id: orderId,
    order_number: "DRY-" + Date.now(),
    order_total: orderTotal,
    total_amount: orderTotal + deliveryFee,
    platform_fee: platformFee,
    delivery_fee: deliveryFee,
    driver_earning: driverEarning,
    delivery_status: "delivered",
    status: "delivered",
    customer_phone: "0500000099",
    store_id: storeId,
    driver_id: driverId,
    merchant_id: merchantId,
    data: { store_id: storeId },
  };
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (!colSet.has(k)) continue;
    fields.push(k);
    vals.push(k === "data" && typeof v === "object" ? JSON.stringify(v) : v);
  }

  const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
  await c.query(`INSERT INTO orders (${fields.join(", ")}) VALUES (${ph})`, vals);
  console.log("inserted order", orderId);

  await c.end();

  const sb = createServiceClient();
  const order = {
    id: orderId,
    store_id: storeId,
    merchant_id: merchantId,
    driver_id: driverId,
    order_total: orderTotal,
    platform_fee: platformFee,
    delivery_fee: deliveryFee,
    driver_earning: driverEarning,
    payment_method: "mada",
    order_number: vals[1],
  };

  const fin = await runDeliveredFinancialSettlement(sb, order, "dry-run:pg");
  console.log("merchant_credit", fin.merchant_credit);

  const sb2 = createServiceClient();
  const { data: txs } = await sb2
    .from("ervenow_ledger_transactions")
    .select("reference_id, amount, type")
    .like("reference_id", `order:${orderId}:%`)
    .eq("status", "completed");

  const refs = (txs || []).map((t) => t.reference_id).sort();
  console.log("ledger_refs", refs);

  const prefix = `order:${orderId}:`;
  const ok =
    refs.includes(`${prefix}merchant_net`) &&
    refs.includes(`${prefix}earning`) &&
    refs.includes(`${prefix}commission`) &&
    !refs.includes(`${prefix}merchant`);

  if (!ok) process.exit(1);
  console.log("DRY_RUN_OK", orderId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
