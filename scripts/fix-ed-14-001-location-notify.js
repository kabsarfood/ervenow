#!/usr/bin/env node
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ORDER_NUMBER = "ED-14-001";

function buildDbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const m = String(process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!pass || !m) return null;
  return `postgresql://postgres:${encodeURIComponent(pass)}@db.${m[1]}.supabase.co:5432/postgres?sslmode=require`;
}

async function main() {
  const pg = require("pg");
  const c = new pg.Client({ connectionString: buildDbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  const updated = await c.query(
    `UPDATE orders
     SET data = jsonb_set(
           jsonb_set(
             jsonb_set(
               coalesce(data::jsonb, '{}'::jsonb),
               '{car,pickup_district_label}',
               '"الرياض"'::jsonb,
               true
             ),
             '{from_location,district}',
             '"الرياض"'::jsonb,
             true
           ),
           '{from_location,address}',
           '"الرياض — موقع الاستلام"'::jsonb,
           true
         ),
         updated_at = now()
     WHERE order_number = $1
     RETURNING id, order_number, data`,
    [ORDER_NUMBER]
  );

  console.log("تحديث موقع الاستلام:", updated.rows[0]?.order_number);
  await c.end();

  const { createServiceClient } = require("../shared/config/supabase");
  const { notifyCarTransportProviders, getCarTransportProviderPhones, providerAreaMatchesCarBooking } =
    require("../shared/services/carTransportNotify");
  const sb = createServiceClient();
  const { data: order } = await sb.from("orders").select("*").eq("order_number", ORDER_NUMBER).single();

  const { data: providers } = await sb
    .from("users")
    .select("phone, service_district, service_type")
    .eq("role", "service")
    .eq("service_type", "pickup_truck");

  for (const p of providers || []) {
    console.log(p.phone, providerAreaMatchesCarBooking(p.service_type, p.service_district, order) ? "يرى ✓" : "لا يرى ✗");
  }

  const phones = await getCarTransportProviderPhones(sb, order);
  console.log("إشعار إلى:", phones.join(", "));
  if (phones.length) {
    await notifyCarTransportProviders(sb, order);
    console.log("تم إرسال واتساب.");
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
