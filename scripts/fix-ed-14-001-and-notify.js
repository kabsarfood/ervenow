#!/usr/bin/env node
/**
 * إصلاح ED-14-001:
 * 1) تأكيد نشر الطلب (draft→pending إن لزم)
 * 2) تصحيح دور سائق السطحة driver → service
 * 3) إرسال واتساب
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ORDER_NUMBER = "ED-14-001";
const PICKUP_USER_ID = "3dcd8139-62a6-44d3-95fc-3825b28ee192";

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const m = String(process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!pass || !m) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${m[1]}.supabase.co:5432/postgres?sslmode=require`;
}

async function main() {
  const url = buildDbUrl();
  if (!url) {
    console.error("اضبط SUPABASE_DB_URL في .env");
    process.exit(1);
  }

  const pg = require("pg");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const orderBefore = await client.query(`SELECT id, delivery_status FROM orders WHERE order_number = $1`, [
    ORDER_NUMBER,
  ]);
  if (!orderBefore.rows.length) {
    console.error("الطلب غير موجود:", ORDER_NUMBER);
    process.exit(1);
  }
  const orderId = orderBefore.rows[0].id;
  const ds = String(orderBefore.rows[0].delivery_status || "").toLowerCase();

  if (ds === "draft") {
    const pub = await client.query(
      `UPDATE orders SET delivery_status = 'pending', updated_at = now()
       WHERE id = $1 AND lower(coalesce(delivery_status,'')) = 'draft'
       RETURNING order_number, delivery_status`,
      [orderId]
    );
    console.log("نشر الطلب:", pub.rows[0] || "(لم يُحدَّث)");
  } else {
    console.log("الطلب منشور مسبقاً — delivery_status =", ds);
  }

  const userBefore = await client.query(
    `SELECT id, name, phone, role, service_type, service_district FROM users WHERE id = $1`,
    [PICKUP_USER_ID]
  );
  console.log("\nسائق السطحة قبل:", JSON.stringify(userBefore.rows[0], null, 2));

  if (userBefore.rows[0] && userBefore.rows[0].role === "driver") {
    const fixed = await client.query(
      `UPDATE users SET role = 'service', updated_at = now()
       WHERE id = $1 AND role = 'driver' AND lower(coalesce(service_type,'')) = 'pickup_truck'
       RETURNING id, name, phone, role, service_type, service_district`,
      [PICKUP_USER_ID]
    );
    console.log("تصحيح الدور:", JSON.stringify(fixed.rows[0], null, 2));
  } else {
    console.log("دور السائق لا يحتاج تصحيح.");
  }

  await client.end();

  const { createServiceClient } = require("../shared/config/supabase");
  const { notifyCarTransportProviders, getCarTransportProviderPhones } = require("../shared/services/carTransportNotify");
  const sb = createServiceClient();
  const { data: order } = await sb.from("orders").select("*").eq("id", orderId).single();
  const phones = await getCarTransportProviderPhones(sb, order);
  console.log("\nأرقام الإشعار:", phones.join(", ") || "(لا أحد)");

  if (phones.length && order) {
    await notifyCarTransportProviders(sb, order);
    console.log("تم إرسال واتساب لسائقي السطحات.");
  }

  console.log("\n✓ الطلب", ORDER_NUMBER, "جاهز في /services-provider.html");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
