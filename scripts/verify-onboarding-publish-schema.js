#!/usr/bin/env node
require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const u = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const c = new Client({ connectionString: u, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`
    select column_name
    from information_schema.columns
    where table_schema='public' and table_name='stores'
      and column_name in ('publication_status','license_number','license_file_url','needs_info_message','needs_info_at')
    order by 1
  `);
  console.log("columns", r.rows.map((x) => x.column_name).join(", "));
  const g = await c.query(`
    select
      count(*) filter (where publication_status='published') as published,
      count(*) filter (where publication_status='draft') as draft,
      count(*) filter (where publication_status='paused') as paused,
      count(*) filter (where publication_status is null) as nulls
    from stores
  `);
  console.log("counts", g.rows[0]);
  await c.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
