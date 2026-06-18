#!/usr/bin/env node
/**
 * نشر طلب ED-14-001 للسطحات: draft → pending + إشعار المزودين
 *   node scripts/publish-order-ed-14-001.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ORDER_NUMBER = "ED-14-001";

function projectRefFromSupabaseUrl() {
  const u = String(process.env.SUPABASE_URL || "").trim();
  const m = u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const ref = projectRefFromSupabaseUrl();
  if (!pass || !ref) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
}

async function main() {
  const url = buildDbUrl();
  if (!url) {
    console.error("اضبط SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD + SUPABASE_URL في .env");
    process.exit(1);
  }

  const pg = require("pg");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const before = await client.query(
    `SELECT id, order_number, order_type, service_type, delivery_status, status,
            customer_phone, provider_id, created_at, data
     FROM orders WHERE order_number = $1`,
    [ORDER_NUMBER]
  );

  if (!before.rows.length) {
    console.error("لم يُعثر على الطلب:", ORDER_NUMBER);
    await client.end();
    process.exit(1);
  }

  const row = before.rows[0];
  console.log("قبل التحديث:", JSON.stringify(row, null, 2));

  const ds = String(row.delivery_status || "").toLowerCase();
  const pay = String(
    row.payment_status ||
      (row.data && typeof row.data === "object" ? row.data.payment_status : null) ||
      (typeof row.data === "string" ? (() => { try { return JSON.parse(row.data).payment_status; } catch { return ""; } })() : "") ||
      ""
  ).toLowerCase();
  const payMethod = String(
    row.payment_method ||
      (row.data && typeof row.data === "object" ? row.data.payment_method : null) ||
      ""
  ).toLowerCase();
  const st = String(row.service_type || "").toLowerCase();
  const carTypes = new Set(["car_transport", "pickup_truck", "vehicle_transfer"]);

  if (ds === "pending" || ds === "new") {
    console.log("الطلب منشور مسبقاً (delivery_status =", ds, ")");
    await client.end();
    return;
  }

  if (ds !== "draft") {
    console.error("حالة غير متوقعة:", row.delivery_status, "— راجع يدوياً");
    await client.end();
    process.exit(1);
  }

  if (pay !== "paid" && payMethod !== "ew_pay") {
    let ewPaid = false;
    try {
      const ew = await client.query(`SELECT public.ervenow_ledger_order_paid_via_ew_pay($1::uuid) AS paid`, [row.id]);
      ewPaid = ew.rows[0]?.paid === true;
    } catch (_) {
      /* دالة غير موجودة */
    }
    if (!ewPaid) {
      console.error("الدفع غير مؤكد — payment_status =", pay, "payment_method =", payMethod);
      await client.end();
      process.exit(1);
    }
    console.log("الدفع مؤكد عبر EW PAY (دفتر المحفظة).");
  }

  if (!carTypes.has(st) && String(row.order_type || "").toLowerCase() !== "service") {
    console.warn("تحذير: قد لا يكون طلب سطحة — service_type =", row.service_type);
  }

  const updated = await client.query(
    `UPDATE orders
     SET delivery_status = 'pending', updated_at = now()
     WHERE id = $1
       AND lower(coalesce(delivery_status, '')) = 'draft'
     RETURNING id, order_number, delivery_status, service_type, order_type`,
    [row.id]
  );

  if (!updated.rows.length) {
    console.error("لم يُحدَّث أي صف — ربما تغيّرت الحالة أثناء التنفيذ");
    await client.end();
    process.exit(1);
  }

  console.log("بعد التحديث:", JSON.stringify(updated.rows[0], null, 2));
  await client.end();

  const { createServiceClient } = require("../shared/config/supabase");
  const { notifyCarTransportProviders } = require("../shared/services/carTransportNotify");
  const sb = createServiceClient();
  if (sb) {
    const { data: full } = await sb.from("orders").select("*").eq("id", row.id).single();
    if (full) {
      try {
        await notifyCarTransportProviders(sb, full);
        console.log("تم إرسال إشعار واتساب لسائقي السطحات في نفس المدينة.");
      } catch (e) {
        console.warn("تعذر إرسال واتساب:", e && (e.message || e));
      }
    }
  }

  console.log("تم نشر الطلب", ORDER_NUMBER, "للوحة services-provider.html");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
