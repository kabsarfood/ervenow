require("dotenv").config();
const pg = require("pg");
const { buildCarTransportProviderMessage } = require("../shared/services/carTransportNotify");
const { sendWhatsApp, getLastWhatsAppError } = require("../shared/utils/whatsapp");

(async () => {
  const c = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const o = await c.query("SELECT * FROM orders WHERE order_number = $1", ["ED-14-001"]);
  const p = await c.query(
    "SELECT phone FROM users WHERE role = 'service' AND service_type = 'pickup_truck'"
  );
  await c.end();

  const order = o.rows[0];
  order.payment_status = "paid";
  const msg = buildCarTransportProviderMessage(order);
  for (const row of p.rows) {
    const phone = String(row.phone || "").trim();
    if (phone.length < 10) continue;
    console.log("إرسال إلى", phone);
    const ok = await sendWhatsApp({ to: phone, message: msg });
    if (ok) {
      console.log("نتيجة: تم الإرسال بنجاح ✓");
    } else {
      const err = getLastWhatsAppError();
      console.error("نتيجة: فشل الإرسال", err && (err.code || err.message || err));
    }
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
