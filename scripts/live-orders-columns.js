#!/usr/bin/env node
const path = require("path");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const cols = await client.query(`
      select column_name, is_nullable, data_type, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'orders'
      order by ordinal_position
    `);
    const nn = cols.rows.filter((c) => c.is_nullable === "NO");
    console.log(JSON.stringify({ not_null: nn, total: cols.rows.length }, null, 2));
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
