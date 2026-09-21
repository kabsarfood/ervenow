#!/usr/bin/env node
/**
 * Live probe: mark_ready on the preparing store order from start_preparing live test.
 * Does not print tokens.
 */
const path = require("path");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE = String(process.env.GATE_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const ORDER_NUMBER = "ES-LIVE-15745106";

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
  let payload;
  if (body != null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return { status: res.status, json };
}

function readFields(label, res) {
  const o = (res.json && (res.json.order || res.json)) || {};
  return {
    label,
    http: res.status,
    error: res.json && res.json.error,
    status_unified: o.status_unified,
    current_actor_type: o.current_actor_type,
    available_actions: o.available_actions,
    delivery_status: o.delivery_status,
    driver_id: o.driver_id ? maskId(o.driver_id) : o.driver_id,
    workflow: o.workflow,
  };
}

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const orderRes = await client.query(
      `select id, order_number, order_type, delivery_status, driver_id, store_id, merchant_id, customer_id
       from orders where order_number = $1`,
      [ORDER_NUMBER]
    );
    const order = orderRes.rows[0];
    if (!order) throw new Error("live order not found");
    const merchant = (await client.query(`select id, role, phone from users where id = $1`, [order.merchant_id])).rows[0];
    const customer = (await client.query(`select id, role, phone from users where id = $1`, [order.customer_id])).rows[0];
    const admin = (
      await client.query(`select id, role, phone from users where role = 'admin' and status = 'active' limit 1`)
    ).rows[0];
    const tokens = {
      merchant: signToken(merchant),
      customer: signToken(customer),
      admin: signToken(admin),
    };

    const ledgerBefore = (
      await client.query(
        `select count(*)::int as n from ervenow_ledger_transactions where reference_id::text = $1`,
        [String(order.id)]
      )
    ).rows[0].n;
    const notifBefore = (
      await client.query(
        `select count(*)::int as n from notifications where payload::text ilike '%' || $1 || '%'`,
        [String(order.id)]
      )
    ).rows[0].n;

    const action = await http("POST", "/api/order/" + order.id + "/action", {
      token: tokens.merchant,
      body: { action: "mark_ready" },
    });
    const a = action.json || {};
    const customerGet = await http("GET", "/api/order/" + order.id, { token: tokens.customer });
    const merchantGet = await http("GET", "/api/order/" + order.id, { token: tokens.merchant });
    const adminGet = await http("GET", "/api/order/" + order.id, { token: tokens.admin });
    const after = (
      await client.query(
        `select delivery_status, driver_id from orders where id = $1`,
        [order.id]
      )
    ).rows[0];
    const ledgerAfter = (
      await client.query(
        `select count(*)::int as n from ervenow_ledger_transactions where reference_id::text = $1`,
        [String(order.id)]
      )
    ).rows[0].n;
    const notifAfter = (
      await client.query(
        `select count(*)::int as n from notifications where payload::text ilike '%' || $1 || '%'`,
        [String(order.id)]
      )
    ).rows[0].n;
    const notifTitles = (
      await client.query(
        `select recipient_type, title from notifications where payload::text ilike '%' || $1 || '%' order by created_at desc limit 6`,
        [String(order.id)]
      )
    ).rows;

    const checks = {
      before_preparing: order.delivery_status === "preparing",
      action_ok: action.status === 200 && a.ok === true && a.action === "mark_ready",
      status_ready: after.delivery_status === "ready",
      customer_unified: (customerGet.json && customerGet.json.order && customerGet.json.order.status_unified) === "ready",
      merchant_unified: (merchantGet.json && merchantGet.json.order && merchantGet.json.order.status_unified) === "ready",
      admin_unified: (adminGet.json && adminGet.json.order && adminGet.json.order.status_unified) === "ready",
      actor_merchant:
        (customerGet.json && customerGet.json.order && customerGet.json.order.current_actor_type) === "merchant" &&
        (merchantGet.json && merchantGet.json.order && merchantGet.json.order.current_actor_type) === "merchant",
      merchant_actions_empty: JSON.stringify((merchantGet.json && merchantGet.json.order && merchantGet.json.order.available_actions) || null) === "[]",
      no_driver: !after.driver_id,
      no_wallet: ledgerBefore === ledgerAfter,
    };

    const out = {
      ok: Object.values(checks).every(Boolean),
      order_number: ORDER_NUMBER,
      order_id: maskId(order.id),
      before: order.delivery_status,
      action_http: action.status,
      action_response: {
        ok: a.ok,
        action: a.action,
        workflow: a.workflow,
        previous_status: a.previous_status,
        previous_status_unified: a.previous_status_unified,
        status_unified: a.status_unified,
        current_actor_type: a.current_actor_type,
        available_actions: a.available_actions,
        error: a.error || null,
      },
      customer_api: readFields("customer", customerGet),
      merchant_api: readFields("merchant", merchantGet),
      admin_api: readFields("admin", adminGet),
      ledger_before: ledgerBefore,
      ledger_after: ledgerAfter,
      notifications_before: notifBefore,
      notifications_after: notifAfter,
      notifications: notifTitles,
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
