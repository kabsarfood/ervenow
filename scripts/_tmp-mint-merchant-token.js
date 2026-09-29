#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const MERCHANT_PHONE = "966531282106";

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const merchant = (
    await client.query("select id, role, phone from users where phone = $1", [MERCHANT_PHONE])
  ).rows[0];
  const other = (
    await client.query(
      "select u.id from users u join stores s on s.owner_user_id = u.id where u.phone <> $1 limit 1",
      [MERCHANT_PHONE]
    )
  ).rows[0];
  await client.end();
  if (!merchant) throw new Error("merchant missing");
  const secret = String(process.env.ERVENOW_JWT_SECRET || "").trim();
  if (!secret) throw new Error("no jwt secret");
  const token = jwt.sign({ sub: merchant.id, phone: merchant.phone, role: "store" }, secret, {
    expiresIn: "2h",
  });
  const out = path.join(process.env.TEMP || ".", "ervenow-merchant-test-session.json");
  fs.writeFileSync(
    out,
    JSON.stringify({
      token,
      merchantId: merchant.id,
      hasOther: Boolean(other),
      otherId: other ? other.id : null,
    })
  );
  console.log("ok");
  console.log("merchantPrefix=" + String(merchant.id).slice(0, 8));
  console.log("hasOther=" + Boolean(other));
  console.log("out=" + out);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
