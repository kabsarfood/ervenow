/**
 * Dry-run: تسوية delivered لطلب متجر وتحقق ledger refs.
 * node scripts/dry-run-ledger-settlement.mjs
 */
import "dotenv/config";
import crypto from "crypto";
import { createRequire } from "module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { runDeliveredFinancialSettlement } = require("../shared/services/deliveredFinancialSettlement.js");

async function columnExists(table, col) {
  const { data, error } = await sb.rpc("exec_sql", {}).catch(() => ({ error: true }));
  void data;
  void error;
  const { data: rows } = await sb.from(table).select("*").limit(0);
  void rows;
  return null;
}

async function getOrderColumns() {
  const pg = (await import("pg")).default;
  const c = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders'
  `);
  await c.end();
  return new Set(r.rows.map((x) => x.column_name));
}

async function main() {
  const cols = await getOrderColumns();
  const hasStoreId = cols.has("store_id");

  let { data: storeRow } = await sb.from("stores").select("id, phone, name").limit(1).maybeSingle();
  if (!storeRow?.id) {
    const newStoreId = crypto.randomUUID();
    const phone = "966501111222";
    const { error: stErr } = await sb.from("stores").insert({
      id: newStoreId,
      name: "Dry Run Store",
      phone,
      status: "approved",
      is_active: true,
    });
    if (stErr) {
      console.error("FAIL: cannot create store:", stErr.message);
      process.exit(1);
    }
    storeRow = { id: newStoreId, phone, name: "Dry Run Store" };
    console.log("created store", newStoreId);
  }

  let merchantUser = null;
  const digits = String(storeRow.phone || "").replace(/\D/g, "");
  if (digits.length >= 9) {
    const { data: u } = await sb.from("users").select("id, role, phone").eq("phone", digits).maybeSingle();
    merchantUser = u;
  }
  if (!merchantUser?.id) {
    const { data: u } = await sb
      .from("users")
      .select("id, role")
      .eq("role", "merchant")
      .limit(1)
      .maybeSingle();
    merchantUser = u;
  }

  const { data: driver } = await sb.from("users").select("id").eq("role", "driver").limit(1).maybeSingle();
  const driverId = driver?.id || null;

  const orderId = crypto.randomUUID();
  const orderNumber = "DRY-" + Date.now();
  const orderTotal = 100;
  const platformFee = 7;
  const deliveryFee = 20;
  const driverEarning = 18;

  const base = {
    id: orderId,
    order_number: orderNumber,
    order_total: orderTotal,
    total_amount: orderTotal + deliveryFee,
    platform_fee: platformFee,
    delivery_fee: deliveryFee,
    driver_earning: driverEarning,
    delivery_status: "delivered",
    status: "delivered",
    payment_status: "paid",
    payment_method: "mada",
    customer_phone: "0500000001",
  };
  if (hasStoreId) base.store_id = storeRow.id;
  if (driverId) base.driver_id = driverId;
  if (merchantUser?.id && cols.has("merchant_id")) base.merchant_id = merchantUser.id;
  if (!hasStoreId) {
    base.data = { store_id: storeRow.id };
    base.breakdown = { store_id: storeRow.id };
  }

  const { error: insErr } = await sb.from("orders").insert(base);
  if (insErr) {
    console.error("FAIL insert order:", insErr.message);
    process.exit(1);
  }
  console.log("inserted order", orderId, "store", storeRow.id);

  const order = { ...base, store_id: storeRow.id, merchant_id: merchantUser?.id || null };
  const fin = await runDeliveredFinancialSettlement(sb, order, "dry-run:ledger");
  console.log("settlement", JSON.stringify(fin.settlement, null, 2));
  console.log("merchant_credit", JSON.stringify(fin.merchant_credit, null, 2));

  const prefix = `order:${orderId}:`;
  const { data: txs } = await sb
    .from("ervenow_ledger_transactions")
    .select("reference_id, type, amount, status")
    .like("reference_id", prefix + "%")
    .eq("status", "completed");

  const refs = (txs || []).map((t) => t.reference_id).sort();
  console.log("ledger_refs", refs);

  const need = [`${prefix}merchant_net`, `${prefix}earning`, `${prefix}commission`];
  const legacy = `${prefix}merchant`;
  const ok =
    need.every((r) => refs.includes(r)) &&
    !refs.includes(legacy) &&
    fin.merchant_credit?.ok !== false;

  if (ok) {
    console.log("DRY_RUN_OK", orderId);
  } else {
    console.error("DRY_RUN_FAIL", { need, refs, legacyFound: refs.includes(legacy) });
    process.exit(1);
  }

  // cleanup optional — keep for audit
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
