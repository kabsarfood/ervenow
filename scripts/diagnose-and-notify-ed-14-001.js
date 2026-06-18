#!/usr/bin/env node
/**
 * تشخيص + إشعار طلب ED-14-001 لسائقي السطحات
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
    console.error("اضبط SUPABASE_DB_URL في .env");
    process.exit(1);
  }

  const pg = require("pg");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const orderQ = await client.query(`SELECT * FROM orders WHERE order_number = $1`, [ORDER_NUMBER]);
  if (!orderQ.rows.length) {
    console.error("الطلب غير موجود");
    process.exit(1);
  }
  const order = orderQ.rows[0];
  console.log("\n=== الطلب ED-14-001 ===");
  console.log("id:", order.id);
  console.log("delivery_status:", order.delivery_status);
  console.log("service_type:", order.service_type);
  console.log("provider_id:", order.provider_id);

  let ewPaid = null;
  try {
    const ew = await client.query(`SELECT public.ervenow_ledger_order_paid_via_ew_pay($1::uuid) AS paid`, [order.id]);
    ewPaid = ew.rows[0]?.paid;
    console.log("EW PAY مدفوع (دفتر):", ewPaid);
  } catch (e) {
    console.log("تحقق EW PAY:", e.message);
  }

  const providers = await client.query(
    `SELECT id, name, phone, role, service_type, service_district, status
     FROM users
     WHERE role = 'service' AND lower(coalesce(service_type, '')) = 'pickup_truck'
     ORDER BY created_at DESC
     LIMIT 50`
  );

  const allService = await client.query(
    `SELECT role, service_type, count(*)::int AS n
     FROM users
     WHERE role IN ('service', 'driver')
     GROUP BY role, service_type
     ORDER BY n DESC`
  );
  console.log("\n=== كل حسابات service/driver ===");
  console.log(JSON.stringify(allService.rows, null, 2));

  let driversSample = [];
  try {
    const d = await client.query(`SELECT phone, car_type, status FROM drivers LIMIT 20`);
    driversSample = d.rows;
  } catch (_) {}
  console.log("\n=== جدول drivers (عينة) ===");
  console.log(JSON.stringify(driversSample, null, 2));

  console.log("\n=== سائقو السطحات المسجلون ===");
  console.log("العدد:", providers.rows.length);
  for (const p of providers.rows) {
    console.log(`  - ${p.name || "—"} | ${p.phone} | مدينة: ${p.service_district || "—"} | status: ${p.status || "—"}`);
  }

  await client.end();

  const { createServiceClient } = require("../shared/config/supabase");
  const { getCarTransportProviderPhones, providerAreaMatchesCarBooking } = require("../shared/services/carTransportNotify");
  const sb = createServiceClient();

  if (sb && providers.rows.length) {
    console.log("\n=== مطابقة المدينة للطلب ===");
    for (const p of providers.rows) {
      const match = providerAreaMatchesCarBooking(p.service_type, p.service_district, order);
      console.log(`  ${p.phone} (${p.service_district || "بدون مدينة"}): ${match ? "يرى الطلب ✓" : "لا يرى ✗"}`);
    }
  }

  const phones = await getCarTransportProviderPhones(sb, order);
  console.log("\n=== أرقام تستلم الإشعار ===");
  console.log(phones.length ? phones.join(", ") : "(لا أحد — تحقق من المدينة أو تسجيل السائقين)");

  if (phones.length) {
    const { notifyCarTransportProviders } = require("../shared/services/carTransportNotify");
    await notifyCarTransportProviders(sb, order);
    console.log("\nتم إرسال إشعار واتساب لـ", phones.length, "سائق/سائقين.");
  } else {
    console.log("\nلم يُرسل واتساب — لا يوجد سائق سطحة مطابق للمدينة.");
    console.log("الحل: سجّل سائق سطحة بمدينة تغطي موقع الاستلام (الرياض) أو حدّث service_district للسائقين الحاليين.");
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
