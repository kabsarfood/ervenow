#!/usr/bin/env node
/**
 * Live probe: real merchant + accepted store order → POST /api/order/:id/action start_preparing
 * Does not print tokens or secrets.
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
  return { status: res.status, json, text: text.slice(0, 500) };
}

function pickOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_number: row.order_number,
    order_type: row.order_type,
    delivery_status: row.delivery_status,
    status: row.status,
    driver_id: row.driver_id,
    store_id: row.store_id,
    merchant_id: row.merchant_id,
    customer_id: row.customer_id,
    updated_at: row.updated_at,
  };
}

async function main() {
  const out = { ok: false, steps: [] };
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const merchantRes = await client.query(
      `select id, role, status, phone from users where phone = $1 limit 1`,
      [MERCHANT_PHONE]
    );
    const merchant = merchantRes.rows[0];
    if (!merchant) throw new Error("merchant not found");
    out.merchant = { id: maskId(merchant.id), role: merchant.role, status: merchant.status };

    const adminRes = await client.query(
      `select id, role, status, phone from users where role = 'admin' and status = 'active' order by created_at asc nulls last limit 1`
    );
    const admin = adminRes.rows[0];
    if (!admin) throw new Error("admin not found");

    let orderRes = await client.query(
      `select id, order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id, updated_at
       from orders
       where store_id = $1
         and lower(coalesce(order_type,'')) in ('store','restaurant')
         and lower(coalesce(delivery_status, status, '')) = 'accepted'
       order by updated_at desc nulls last
       limit 1`,
      [STORE_ID]
    );
    let setupAccept = false;
    let seededClone = false;
    if (!orderRes.rows[0]) {
      orderRes = await client.query(
        `select id, order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id, updated_at
         from orders
         where store_id = $1
           and lower(coalesce(order_type,'')) in ('store','restaurant')
           and lower(coalesce(delivery_status, status, '')) in ('pending','new')
         order by created_at desc nulls last
         limit 1`,
        [STORE_ID]
      );
      setupAccept = !!orderRes.rows[0];
    }
    if (!orderRes.rows[0]) {
      const src = await client.query(
        `select * from orders
         where store_id = $1
           and lower(coalesce(order_type,'')) in ('store','restaurant')
         order by created_at desc nulls last
         limit 1`,
        [STORE_ID]
      );
      if (!src.rows[0]) throw new Error("no store/restaurant order to clone for live test");
      const row = src.rows[0];
      const num = "ES-LIVE-" + String(Date.now()).slice(-8);
      const ins = await client.query(
        `insert into orders (
           order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id,
           payment_status, payment_method, drop_address, drop_lat, drop_lng, pickup_address, pickup_lat, pickup_lng,
           order_total, total_amount, delivery_fee, platform_fee, vat_amount, total_with_vat, breakdown, data, created_at, updated_at
         )
         values (
           $1, $2, 'pending', 'new', null, $3, $4, $5,
           'pending', coalesce($6, 'cod'), $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18, $19, $20, now(), now()
         )
         returning id, order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id, updated_at`,
        [
          num,
          row.order_type || "restaurant",
          row.store_id,
          row.merchant_id,
          row.customer_id,
          row.payment_method,
          row.drop_address,
          row.drop_lat,
          row.drop_lng,
          row.pickup_address,
          row.pickup_lat,
          row.pickup_lng,
          row.order_total,
          row.total_amount,
          row.delivery_fee,
          row.platform_fee,
          row.vat_amount,
          row.total_with_vat,
          row.breakdown,
          row.data,
        ]
      );
      orderRes = ins;
      setupAccept = true;
      seededClone = true;
    }
    let order = orderRes.rows[0];
    if (!order) throw new Error("no accepted/pending store order for merchant store");

    const customerRes = await client.query(`select id, role, status, phone from users where id = $1`, [
      order.customer_id,
    ]);
    const customer = customerRes.rows[0];
    if (!customer) throw new Error("order customer not found");

    const tokens = {
      merchant: signToken(merchant),
      customer: signToken(customer),
      admin: signToken(admin),
    };

    if (setupAccept) {
      const acc = await http("PATCH", "/api/order/" + order.id + "/status", {
        token: tokens.merchant,
        body: { delivery_status: "accepted" },
      });
      out.steps.push({ setup_accept: acc.status, error: acc.json && acc.json.error });
      if (acc.status >= 400) throw new Error("setup accept failed: " + (acc.json && acc.json.error));
      const again = await client.query(
        `select id, order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id, updated_at
         from orders where id = $1`,
        [order.id]
      );
      order = again.rows[0];
    }

    out.order_before = pickOrder(order);
    out.order_before.id = maskId(order.id);
    out.order_number = order.order_number;
    out.order_id_masked = maskId(order.id);
    out.setup_accept_used = setupAccept;
    out.seeded_clone = seededClone;

    const ledgerBefore = await client.query(
      `select count(*)::int as n from ervenow_ledger_transactions where order_id = $1`,
      [order.id]
    ).catch(async () => {
      const alt = await client.query(
        `select count(*)::int as n from ervenow_ledger_transactions where reference = $1`,
        [String(order.id)]
      ).catch(() => ({ rows: [{ n: -1 }] }));
      return alt;
    });
    const notifBefore = await client.query(
      `select count(*)::int as n from notifications where order_id = $1`,
      [order.id]
    ).catch(() => ({ rows: [{ n: -1 }] }));

    out.ledger_before = ledgerBefore.rows[0].n;
    out.notifications_before = notifBefore.rows[0].n;

    const action = await http("POST", "/api/order/" + order.id + "/action", {
      token: tokens.merchant,
      body: { action: "start_preparing" },
    });
    out.action_http = action.status;
    const a = action.json || {};
    out.action_response = {
      ok: a.ok,
      action: a.action,
      order_id: a.order_id ? maskId(a.order_id) : null,
      workflow: a.workflow,
      previous_status: a.previous_status,
      previous_status_unified: a.previous_status_unified,
      status_unified: a.status_unified,
      current_actor_type: a.current_actor_type,
      available_actions: a.available_actions,
      error: a.error || null,
    };

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

    const customerGet = await http("GET", "/api/order/" + order.id, { token: tokens.customer });
    const merchantGet = await http("GET", "/api/order/" + order.id, { token: tokens.merchant });
    const adminGet = await http("GET", "/api/order/" + order.id, { token: tokens.admin });
    out.customer_api = readFields("customer", customerGet);
    out.merchant_api = readFields("merchant", merchantGet);
    out.admin_api = readFields("admin", adminGet);

    const board = await http("GET", "/api/store/order-board", { token: tokens.merchant });
    const boardOrders = (board.json && board.json.orders) || [];
    const boardHit = boardOrders.find((x) => String(x.id) === String(order.id));
    out.merchant_board = {
      http: board.status,
      found: !!boardHit,
      status_unified: boardHit && boardHit.status_unified,
      current_actor_type: boardHit && boardHit.current_actor_type,
      available_actions: boardHit && boardHit.available_actions,
      delivery_status: boardHit && boardHit.delivery_status,
    };

    const after = await client.query(
      `select id, order_number, order_type, delivery_status, status, driver_id, store_id, merchant_id, customer_id, updated_at
       from orders where id = $1`,
      [order.id]
    );
    const orderAfter = after.rows[0];
    out.order_after = pickOrder(orderAfter);
    if (out.order_after) out.order_after.id = maskId(orderAfter.id);

    const ledgerAfter = await client.query(
      `select count(*)::int as n from ervenow_ledger_transactions where order_id = $1`,
      [order.id]
    ).catch(async () => {
      const alt = await client.query(
        `select count(*)::int as n from ervenow_ledger_transactions where reference = $1`,
        [String(order.id)]
      ).catch(() => ({ rows: [{ n: -1 }] }));
      return alt;
    });
    const notifAfter = await client.query(
      `select count(*)::int as n from notifications where order_id = $1`,
      [order.id]
    ).catch(() => ({ rows: [{ n: -1 }] }));
    out.ledger_after = ledgerAfter.rows[0].n;
    out.notifications_after = notifAfter.rows[0].n;

    out.driver_assignment_changed = String(order.driver_id || "") !== String(orderAfter.driver_id || "");
    out.wallet_movement = out.ledger_before !== out.ledger_after && out.ledger_after !== -1;
    out.settlement_happened = false;
    if (orderAfter) {
      out.settlement_happened = ["delivered", "settled"].includes(String(orderAfter.delivery_status || "").toLowerCase());
    }

    const checks = {
      action_ok: action.status === 200 && a.ok === true && a.action === "start_preparing",
      status_preparing: String(orderAfter.delivery_status) === "preparing",
      customer_unified: out.customer_api.status_unified === "preparing",
      merchant_unified: out.merchant_api.status_unified === "preparing",
      admin_unified: out.admin_api.status_unified === "preparing",
      actor_merchant:
        out.customer_api.current_actor_type === "merchant" &&
        out.merchant_api.current_actor_type === "merchant" &&
        out.admin_api.current_actor_type === "merchant",
      merchant_actions: JSON.stringify(out.merchant_api.available_actions) === JSON.stringify(["mark_ready"]),
      no_driver: !out.driver_assignment_changed && !orderAfter.driver_id,
      no_wallet: !out.wallet_movement,
      no_settlement: !out.settlement_happened,
    };
    out.checks = checks;
    out.ok = Object.values(checks).every(Boolean);
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
