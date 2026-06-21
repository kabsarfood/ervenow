require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const sql = `
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gas_mode text;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gas_liters integer;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_qty integer;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS provider_completed_at timestamptz;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamptz;
    ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_settled boolean;
    NOTIFY pgrst, 'reload schema';
  `;
  await client.query(sql);
  console.log("[migration] orders gas/service provider columns OK");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
