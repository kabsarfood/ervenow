#!/usr/bin/env node
/**
 * يضيف تصنيفي شعبيات فوال وشعبيات فلافل إلى categories.
 */
const fs = require("fs");
const path = require("path");
const dns = require("dns");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("verbatim");

async function main() {
  const dbUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    console.error("أضِف SUPABASE_DB_URL إلى .env ثم أعد التشغيل.");
    process.exit(1);
  }
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "shared", "migration_restaurant_categories_shaabiyat.sql"),
    "utf8"
  );
  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(
      `SELECT slug, name_ar, is_active
         FROM public.categories
        WHERE slug IN ('shaabiyat_foul', 'shaabiyat_falafel')
        ORDER BY sort_order`
    );
    if (rows.length !== 2) {
      console.error("[migrate] الصفوف بعد التنفيذ:", rows.length);
      process.exit(2);
    }
    rows.forEach((r) => console.log("[migrate]", r.slug, r.name_ar, "active", r.is_active));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] فشل:", err.message || err);
  process.exit(1);
});
