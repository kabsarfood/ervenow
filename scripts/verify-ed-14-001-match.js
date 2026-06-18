require("dotenv").config();
const pg = require("pg");
const { providerAreaMatchesCarBooking } = require("../shared/services/carTransportNotify");

function buildDbUrl() {
  return process.env.SUPABASE_DB_URL || null;
}

(async () => {
  const c = new pg.Client({ connectionString: buildDbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const o = await c.query("SELECT * FROM orders WHERE order_number = $1", ["ED-14-001"]);
  const p = await c.query(
    "SELECT phone, service_type, service_district FROM users WHERE role = 'service' AND service_type = 'pickup_truck'"
  );
  const order = o.rows[0];
  console.log("pickup_district_label:", order.data?.car?.pickup_district_label);
  console.log("from_location:", order.data?.from_location);
  for (const u of p.rows) {
    console.log(u.phone, providerAreaMatchesCarBooking(u.service_type, u.service_district, order) ? "يرى ✓" : "لا ✗");
  }
  await c.end();
})();
