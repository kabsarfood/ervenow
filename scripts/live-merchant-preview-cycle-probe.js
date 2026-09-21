#!/usr/bin/env node
/**
 * Merchant preview button cycle (same APIs the UI calls):
 * Accept PATCH → start_preparing action → mark_ready action → wait for driver
 */
const path = require("path");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE = String(process.env.GATE_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const STORE_ID = "1fcc6d83-4c7c-4fd0-8f22-7a84edaadfce";
const MERCHANT_PHONE = "966531282106";

function maskId(id) {
  const s = String(id || "");
  if (s.length < 12) return s ? s.slice(0, 4) + "…" : "";
  return s.slice(0, 8) + "…" + s.slice(-4);
}

function signToken(user) {
  const secret = String(process.env.ERVENOW_JWT_SECRET || "").trim();
  return jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, secret, { expiresIn: "2h" });
}

async function http(method, urlPath, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {}
  return { status: res.status, json };
}

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const merchant = (await client.query(`select id, role, phone from users where phone = $1`, [MERCHANT_PHONE])).rows[0];
    const src = (
      await client.query(
        `select * from orders where store_id = $1 and lower(coalesce(order_type,'')) in ('store','restaurant') order by created_at desc limit 1`,
        [STORE_ID]
      )
    ).rows[0];
    if (!merchant || !src) throw new Error("merchant or source order missing");
    const num = "ES-UI-" + String(Date.now()).slice(-8);
    const ins = await client.query(
      `insert into orders (
         order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id,
         payment_status, payment_method, drop_address, drop_lat, drop_lng, pickup_address, pickup_lat, pickup_lng,
         order_total, total_amount, delivery_fee, platform_fee, vat_amount, total_with_vat, breakdown, data, created_at, updated_at
       ) values (
         $1, $2, 'pending', 'new', null, $3, $4, $5,
         'pending', coalesce($6,'cod'), $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, now(), now()
       ) returning id, customer_id`,
      [
        num, src.order_type || "restaurant", src.store_id, src.merchant_id, src.customer_id,
        src.payment_method, src.drop_address, src.drop_lat, src.drop_lng, src.pickup_address, src.pickup_lat, src.pickup_lng,
        src.order_total, src.total_amount, src.delivery_fee, src.platform_fee, src.vat_amount, src.total_with_vat, src.breakdown, src.data,
      ]
    );
    const order = ins.rows[0];
    const customer = (await client.query(`select id, role, phone from users where id = $1`, [order.customer_id])).rows[0];
    const admin = (await client.query(`select id, role, phone from users where role='admin' and status='active' limit 1`)).rows[0];
    const tokens = { merchant: signToken(merchant), customer: signToken(customer), admin: signToken(admin) };

    const accept = await http("PATCH", "/api/order/" + order.id + "/status", {
      token: tokens.merchant,
      body: { delivery_status: "accepted" },
    });
    const prep = await http("POST", "/api/order/" + order.id + "/action", {
      token: tokens.merchant,
      body: { action: "start_preparing" },
    });
    const ready = await http("POST", "/api/order/" + order.id + "/action", {
      token: tokens.merchant,
      body: { action: "mark_ready" },
    });
    const cGet = await http("GET", "/api/order/" + order.id, { token: tokens.customer });
    const mGet = await http("GET", "/api/order/" + order.id, { token: tokens.merchant });
    const aGet = await http("GET", "/api/order/" + order.id, { token: tokens.admin });
    const row = (await client.query(`select delivery_status, driver_id from orders where id=$1`, [order.id])).rows[0];
    const ledger = (await client.query(`select count(*)::int as n from ervenow_ledger_transactions where reference_id::text=$1`, [String(order.id)])).rows[0].n;
    const o = (x) => x.json && x.json.order;
    const checks = {
      accept_old: accept.status === 200,
      start_preparing: prep.status === 200 && prep.json && prep.json.action === "start_preparing",
      mark_ready: ready.status === 200 && ready.json && ready.json.action === "mark_ready",
      ready_unified: o(cGet).status_unified === "ready" && o(mGet).status_unified === "ready" && o(aGet).status_unified === "ready",
      actor_merchant: o(cGet).current_actor_type === "merchant" && o(mGet).current_actor_type === "merchant",
      wait_driver: Array.isArray(o(mGet).available_actions) && o(mGet).available_actions.length === 0,
      driver_null: !row.driver_id,
      no_ledger: ledger === 0,
    };
    const out = {
      ok: Object.values(checks).every(Boolean),
      order_number: num,
      order_id: maskId(order.id),
      accept_http: accept.status,
      preparing_http: prep.status,
      ready_http: ready.status,
      ready_action: ready.json && ready.json.action,
      customer: { status_unified: o(cGet).status_unified, current_actor_type: o(cGet).current_actor_type },
      merchant: { status_unified: o(mGet).status_unified, current_actor_type: o(mGet).current_actor_type, available_actions: o(mGet).available_actions },
      admin: { status_unified: o(aGet).status_unified, current_actor_type: o(aGet).current_actor_type },
      delivery_status: row.delivery_status,
      driver_id: row.driver_id,
      ledger,
      checks,
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 2);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message || String(e) }));
  process.exit(1);
});
