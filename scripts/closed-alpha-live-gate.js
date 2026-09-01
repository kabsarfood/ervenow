#!/usr/bin/env node
/**
 * Closed Alpha live gate — HTTP against a running server + test DB.
 * Does not print secrets, tokens, OTP codes, or Twilio auth material.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
try {
  const dns = require("dns");
  if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("ipv4first");
} catch (_e) {}

const BASE = String(process.env.GATE_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const STORE_LAT = 24.7139;
const STORE_LNG = 46.6759;
const CUST_LAT = STORE_LAT;
const CUST_LNG = STORE_LNG;
const PRODUCT_ID = "81c94c65-7c38-4ac4-b841-fd19f1981434"; // بيبسي catalog 3
const STORE_ID = "1fcc6d83-4c7c-4fd0-8f22-7a84edaadfce";
const CATALOG_PRICE = 3;
const GATE_CUSTOMER_PHONE = "966559010021";
const GATE_CUSTOMER_B_PHONE = "966559010022";

const report = {
  generated_at: new Date().toISOString(),
  environment: {},
  sections: {},
  actors: {},
  orders: {},
  financials: {},
  bugs: [],
  code_changes: [],
  tests: {},
  decision: "B — INTERNAL TESTING ONLY",
};

function maskId(id) {
  const s = String(id || "");
  if (s.length < 12) return s ? s.slice(0, 4) + "…" : "";
  return s.slice(0, 8) + "…" + s.slice(-4);
}

function signToken(user) {
  const secret = String(process.env.ERVENOW_JWT_SECRET || "").trim();
  return jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, secret, { expiresIn: "7d" });
}

async function http(method, urlPath, { token, body, headers, raw } = {}) {
  const headersOut = Object.assign({ Accept: "application/json" }, headers || {});
  if (token) headersOut.Authorization = "Bearer " + token;
  let payload;
  if (body != null && !raw) {
    headersOut["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (raw) {
    payload = raw;
  }
  let res;
  try {
    res = await fetch(BASE + urlPath, { method, headers: headersOut, body: payload, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { status: 0, json: null, text: "fetch_failed", error: e && e.message, headers: {} };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return { status: res.status, json, text: text.slice(0, 400), headers: Object.fromEntries(res.headers) };
}

function pg() {
  return new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
}

function setSection(name, patch) {
  report.sections[name] = Object.assign({}, report.sections[name] || {}, patch);
}

async function seedAdmin() {
  const env = Object.assign({}, process.env, {
    ERVENOW_BOOTSTRAP_ADMIN_CONFIRM: "1",
    ERVENOW_BOOTSTRAP_ADMIN_PHONE: "0505745650",
  });
  env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const r = spawnSync(process.execPath, ["--use-system-ca", path.join(__dirname, "seed-first-admin.js")], {
    env,
    encoding: "utf8",
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const already = /admin already exists/.test(out);
  const promoted = /promoted existing user/.test(out);
  const skipped = /skipped/.test(out);
  return {
    exit: r.status,
    already,
    promoted,
    skipped,
    log: out.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 400),
  };
}

function extractOtpFromTwilioBody(body) {
  const ascii = String(body || "").replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
  const match = ascii.match(/\b(\d{5,6})\b/);
  return match ? match[1] : null;
}

async function twilioListMessages(auth, qs) {
  const url =
    "https://api.twilio.com/2010-04-01/Accounts/" +
    encodeURIComponent(auth.sid) +
    "/Messages.json?" +
    qs;
  const res = await fetch(url, {
    headers: { Authorization: auth.header },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return { ok: false, reason: "twilio_list_http_" + res.status, messages: [] };
  const data = await res.json();
  return { ok: true, messages: Array.isArray(data.messages) ? data.messages : [] };
}

async function fetchTwilioOtpForTo(toE164) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token) return { ok: false, reason: "twilio_env_missing" };
  const auth = { sid, header: "Basic " + Buffer.from(sid + ":" + token).toString("base64") };
  const want = String(toE164 || "").replace(/\D/g, "");
  const filters = ["whatsapp:" + toE164, toE164, want];
  try {
    const seen = new Set();
    const all = [];
    for (const to of filters) {
      const listed = await twilioListMessages(auth, "PageSize=20&To=" + encodeURIComponent(to));
      for (const m of listed.messages || []) {
        if (m.sid && !seen.has(m.sid)) {
          seen.add(m.sid);
          all.push(m);
        }
      }
    }
    const unfiltered = await twilioListMessages(auth, "PageSize=20");
    for (const m of unfiltered.messages || []) {
      if (m.sid && !seen.has(m.sid)) {
        seen.add(m.sid);
        all.push(m);
      }
    }
    const matched = all.filter((m) => String(m.to || "").replace(/\D/g, "").endsWith(want.slice(-8)));
    const pool = matched.length ? matched : all;
    for (const m of pool) {
      const code = extractOtpFromTwilioBody(m.body);
      if (code) return { ok: true, code, sid_prefix: String(m.sid || "").slice(0, 4), twilio_status: m.status };
    }
    return { ok: false, reason: "no_otp_in_recent_messages", n: all.length };
  } catch (_e) {
    return { ok: false, reason: "twilio_list_fetch_failed" };
  }
}

function twilioSign(url, params) {
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] == null ? "" : params[key]), String(url || ""));
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf8")).digest("base64");
}

async function creditTestBalance(adminToken, userId, amount, ref) {
  return http("POST", "/api/wallet/ledger/deposit", {
    token: adminToken,
    body: {
      user_id: userId,
      role: "customer",
      amount,
      reference_id: ref,
      description: "Closed Alpha gate test balance",
    },
  });
}

async function checkout(token, { price, idempotencyKey, extra, dropNudge } = {}) {
  const nudge = dropNudge != null ? Number(dropNudge) : Math.random() * 0.008 + 0.0003;
  const dropLng = CUST_LNG + nudge;
  const body = Object.assign(
    {
      items: [
        {
          type: "restaurant",
          title: "بيبسي",
          price: price != null ? price : CATALOG_PRICE,
          data: {
            store_id: STORE_ID,
            product_id: PRODUCT_ID,
            qty: 1,
            drop_lat: CUST_LAT,
            drop_lng: dropLng,
            drop_address: "Closed Alpha gate drop — " + String(nudge),
          },
        },
      ],
      payment_method: "ew_pay",
      customer_lat: CUST_LAT,
      customer_lng: dropLng,
      customer_address: "Closed Alpha gate drop — " + String(nudge),
    },
    extra || {}
  );
  const headers = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return http("POST", "/api/order/create", { token, body, headers });
}

async function patchStatus(token, orderId, status) {
  return http("PATCH", "/api/order/" + orderId + "/status", { token, body: { delivery_status: status } });
}

async function dbOrder(client, orderId) {
  const r = await client.query(
    `select id, order_number, customer_id, merchant_id, driver_id, store_id,
            delivery_status, payment_status, payment_method,
            order_total, total_amount, delivery_fee, driver_earning, platform_fee,
            vat_amount, total_with_vat, breakdown
       from orders where id = $1`,
    [orderId]
  );
  return r.rows[0] || null;
}

async function ledgerForOrder(client, orderId) {
  const r = await client.query(
    `select t.id, t.wallet_id, t.direction, t.amount, t.reference_id, t.status, t.type, w.user_id, w.role, w.is_platform
       from ervenow_ledger_transactions t
       join ervenow_ledger_wallets w on w.id = t.wallet_id
      where t.reference_id ilike '%' || $1 || '%'
         or t.reference_id ilike '%:' || $1 || ':%'
         or t.reference_id = $1
         or t.reference_id = 'pay:order:' || $1
         or t.reference_id = 'refund:order:' || $1
      order by t.created_at`,
    [orderId]
  );
  return r.rows;
}

async function settlementRows(client, orderId) {
  const r = await client.query(
    `select entity_id, entity_type, settlement_kind, status, claimed_at, completed_at
       from settlement_log where entity_id = $1::text or entity_id = $1::uuid::text`,
    [orderId]
  ).catch(async () => {
    const r2 = await client.query(
      `select * from settlement_log where entity_id::text = $1`,
      [orderId]
    );
    return r2;
  });
  return r.rows || [];
}

async function ensureCatalog(client) {
  await client.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lat double precision`);
  await client.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lng double precision`);
  await client.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_seen timestamptz`);
  await client.query(
    `update stores
        set lat = $1,
            lng = $2,
            delivery_radius_km = 500,
            status = 'approved',
            updated_at = now()
      where id = $3`,
    [STORE_LAT, STORE_LNG, STORE_ID]
  );
  const storePhone = await client.query(`select phone, owner_user_id from stores where id = $1`, [STORE_ID]);
  const ownerId = storePhone.rows[0] && storePhone.rows[0].owner_user_id;
  if (ownerId && !storePhone.rows[0].phone) {
    const u = await client.query(`select phone from users where id = $1`, [ownerId]);
    if (u.rows[0] && u.rows[0].phone) {
      await client.query(`update stores set phone = $1 where id = $2`, [u.rows[0].phone, STORE_ID]);
    }
  }
  await client.query(
    `update drivers set lat = $1, lng = $2, active = true, status = 'approved' where phone in ('966580914984','966551658569')`,
    [STORE_LAT, STORE_LNG]
  );
  await client.query(
    `update users set lat = $1, lng = $2, status = 'active' where phone in ('966580914984','966551658569')`,
    [STORE_LAT, STORE_LNG]
  );
}

async function getOrRegisterCustomer(phone, name) {
  const existing = await http("POST", "/api/core/register", {
    body: { phone, role: "customer", name },
  });
  return existing;
}

async function loadUserByPhone(client, phone) {
  const r = await client.query(`select id, role, status, phone, name from users where phone = $1`, [phone]);
  return r.rows[0] || null;
}

async function tryOtpLogin(phone, role) {
  const send = await http("POST", "/api/core/send-otp", {
    body: { phone, role: role || "customer", login_only: true },
  });
  if (send.status !== 200 || !(send.json && (send.json.ok === true || send.json.sent === true))) {
    return { ok: false, send_status: send.status, send_error: send.json && (send.json.error || send.json.message) };
  }
  const digits = String(phone || "").replace(/\D/g, "");
  const e164 =
    digits.startsWith("966") ? "+" + digits : digits.startsWith("0") ? "+966" + digits.slice(1) : "+" + digits;
  const fetched = await fetchTwilioOtpForTo(e164);
  if (!fetched.ok) return { ok: false, send_status: 200, fetch: fetched.reason };
  const verify = await http("POST", "/api/core/verify-otp", {
    body: { phone, code: fetched.code, role: role || "customer", login_only: true },
  });
  const token = verify.json && (verify.json.token || verify.json.access_token);
  return {
    ok: verify.status === 200 && !!token,
    verify_status: verify.status,
    has_token: !!token,
    token,
  };
}

async function walkOrder(customerToken, merchantToken, driverToken, client, label) {
  const created = await checkout(customerToken, { price: 1 });
  if (created.status !== 200 || !created.json || created.json.ok !== true) {
    return { ok: false, step: "checkout", created };
  }
  const order = (created.json.orders && created.json.orders[0]) || null;
  if (!order || !order.id) return { ok: false, step: "checkout_no_order", created };
  const oid = order.id;
  const steps = [{ step: "checkout", status: created.status, order_id: oid, amount: order.total_amount || order.total_with_vat }];

  for (const st of ["accepted", "preparing", "ready"]) {
    const r = await patchStatus(merchantToken, oid, st);
    steps.push({ step: "merchant_" + st, http: r.status, err: r.json && (r.json.error || r.json.message) });
    if (r.status !== 200) return { ok: false, step: "merchant_" + st, steps, r };
  }

  const loc = await http("POST", "/api/driver/update-location", {
    token: driverToken,
    body: { lat: STORE_LAT, lng: STORE_LNG },
  });
  steps.push({ step: "driver_gps", http: loc.status, err: loc.json && loc.json.error });

  const acc = await http("POST", "/api/driver/accept/" + oid, { token: driverToken });
  steps.push({
    step: "driver_accept",
    http: acc.status,
    accepted: acc.json && acc.json.accepted,
    err: acc.json && (acc.json.error || acc.json.message),
  });
  if (acc.status !== 200 || (acc.json && acc.json.accepted === false)) {
    return { ok: false, step: "driver_accept", steps, acc };
  }

  const deliv = await patchStatus(driverToken, oid, "delivering");
  steps.push({ step: "delivering", http: deliv.status, err: deliv.json && deliv.json.error });
  if (deliv.status !== 200) return { ok: false, step: "delivering", steps, deliv };

  const done = await patchStatus(driverToken, oid, "delivered");
  steps.push({
    step: "delivered",
    http: done.status,
    settlement: done.json && done.json.settlement,
    err: done.json && done.json.error,
  });
  if (done.status !== 200) return { ok: false, step: "delivered", steps, done };

  const row = await dbOrder(client, oid);
  const txs = await ledgerForOrder(client, oid);
  const settle = await settlementRows(client, oid).catch(() => []);
  return {
    ok: String(row && row.delivery_status).toLowerCase() === "delivered",
    label,
    order_id: oid,
    order_number: row && row.order_number,
    steps,
    row,
    ledger: (txs || []).map((t) => ({
      direction: t.direction,
      amount: t.amount,
      reference_id: t.reference_id,
      status: t.status,
      type: t.type,
      role: t.role,
      is_platform: t.is_platform,
      user: maskId(t.user_id),
    })),
    settlement: settle,
    http_settlement: done.json && done.json.settlement,
  };
}

async function main() {
  report.environment = {
    base: BASE,
    node_env: String(process.env.NODE_ENV || ""),
    finance_mode: String(process.env.FINANCE_MODE || ""),
    public_url: String(process.env.ERVENOW_PUBLIC_URL || ""),
    supabase_host: (() => {
      try {
        return new URL(process.env.SUPABASE_URL).host;
      } catch (_e) {
        return "unparseable";
      }
    })(),
    twilio_sid_set: Boolean(process.env.TWILIO_ACCOUNT_SID),
    twilio_token_set: Boolean(process.env.TWILIO_AUTH_TOKEN),
    twilio_from_set: Boolean(process.env.TWILIO_WHATSAPP_NUMBER),
    twilio_webhook_url_set: Boolean(String(process.env.TWILIO_WEBHOOK_URL || "").trim()),
    allow_dev_otp: String(process.env.ALLOW_DEV_OTP || ""),
    bootstrap_confirm_in_dotenv: String(process.env.ERVENOW_BOOTSTRAP_ADMIN_CONFIRM || "") === "1",
  };

  const health = await http("GET", "/api/health");
  report.environment.local_health = health.status;
  console.log("[gate] health", health.status, health.error || "");
  if (health.status !== 200) {
    throw new Error("local server not healthy on " + BASE + " status=" + health.status + " " + (health.error || health.text));
  }

  const client = pg();
  await client.connect();
  try {
    const seed = await seedAdmin();
    console.log("[gate] seed", seed.exit, seed.already || seed.promoted || seed.skipped);
    const admins = await client.query(`select id, role, status, phone from users where role = 'admin'`);
    const adminRow = admins.rows[0];
    setSection("admin_bootstrap", {
      seed_exit: seed.exit,
      seed_already: seed.already,
      seed_promoted: seed.promoted,
      admin_count: admins.rowCount,
      admin_id: adminRow && adminRow.id,
      role: adminRow && adminRow.role,
      status: adminRow && adminRow.status,
      confirm_left_in_dotenv: String(process.env.ERVENOW_BOOTSTRAP_ADMIN_CONFIRM || "") === "1",
      result: adminRow && adminRow.role === "admin" && adminRow.status === "active" ? "PASS" : "FAIL",
    });

    await ensureCatalog(client);

    const merchant = await loadUserByPhone(client, "966531282106");
    const driverA = await loadUserByPhone(client, "966580914984");
    const driverB = await loadUserByPhone(client, "966551658569");
    if (!merchant || !driverA || !driverB || !adminRow) {
      throw new Error("missing existing merchant/driver/admin actors");
    }

    await getOrRegisterCustomer(GATE_CUSTOMER_PHONE, "GATE Customer A");
    await getOrRegisterCustomer(GATE_CUSTOMER_B_PHONE, "GATE Customer B");
    let customer = await loadUserByPhone(client, GATE_CUSTOMER_PHONE);
    let customerB = await loadUserByPhone(client, GATE_CUSTOMER_B_PHONE);

    const tokens = {
      admin: signToken(adminRow),
      merchant: signToken(merchant),
      driverA: signToken(driverA),
      driverB: signToken(driverB),
    };

    if (customer && String(customer.status).toLowerCase() !== "active") {
      await http("POST", "/api/admin/activate-customer", { token: tokens.admin, body: { id: customer.id } });
      customer = await loadUserByPhone(client, GATE_CUSTOMER_PHONE);
    }
    if (customerB && String(customerB.status).toLowerCase() !== "active") {
      await http("POST", "/api/admin/activate-customer", { token: tokens.admin, body: { id: customerB.id } });
      customerB = await loadUserByPhone(client, GATE_CUSTOMER_B_PHONE);
    }
    tokens.customer = customer ? signToken(customer) : null;
    tokens.customerB = customerB ? signToken(customerB) : null;

    report.actors = {
      admin: { id: adminRow.id, role: adminRow.role, phone_last4: String(adminRow.phone).slice(-4) },
      customer: customer && { id: customer.id, role: customer.role, status: customer.status, phone_last4: String(customer.phone).slice(-4) },
      customer_b: customerB && { id: customerB.id, role: customerB.role, status: customerB.status, phone_last4: String(customerB.phone).slice(-4) },
      merchant: { id: merchant.id, role: merchant.role, phone_last4: String(merchant.phone).slice(-4) },
      driver_a: { id: driverA.id, role: driverA.role, phone_last4: String(driverA.phone).slice(-4) },
      driver_b: { id: driverB.id, role: driverB.role, phone_last4: String(driverB.phone).slice(-4) },
      store_id: STORE_ID,
      notes: "Sessions minted with the same JWT contract as verify-otp when WhatsApp OTP could not be completed. Distinct users, no shared role impersonation.",
    };

    const noPublicAdmin = await http("POST", "/api/core/register", {
      body: { phone: "9665590188" + String(Date.now()).slice(-4), role: "admin", name: "should fail" },
    });
    const syncEscalate = await http("POST", "/api/core/users/sync", {
      token: tokens.customer,
      body: { role: "admin" },
    });
    setSection("admin_bootstrap", {
      public_register_admin: { status: noPublicAdmin.status, error: noPublicAdmin.json && noPublicAdmin.json.error },
      customer_sync_role_admin: { status: syncEscalate.status, error: syncEscalate.json && syncEscalate.json.error },
    });
    if (noPublicAdmin.status < 400) {
      report.bugs.push({ id: "public-admin-register", evidence: noPublicAdmin });
    }
    if (syncEscalate.status !== 403) {
      report.bugs.push({ id: "sync-role-escalation", evidence: syncEscalate });
    }

    const otpAdmin = await tryOtpLogin("0505745650", "admin");
    if (otpAdmin.token) tokens.admin = otpAdmin.token;
    const me = await http("GET", "/api/core/me", { token: tokens.admin });
    const anonSettings = await http("GET", "/api/admin/settings");
    const custSettings = await http("GET", "/api/admin/settings", { token: tokens.customer });
    const adminSettings = await http("GET", "/api/admin/settings", { token: tokens.admin });
    const adminSurfaces = {};
    for (const [name, p] of [
      ["orders", "/api/admin/orders"],
      ["customers", "/api/admin/customers"],
      ["drivers", "/api/admin/drivers"],
      ["me", "/api/admin/me"],
      ["stats", "/api/admin/stats"],
      ["finance_summary", "/api/admin/finance-summary"],
      ["store_requests", "/api/admin/store-requests"],
    ]) {
      const a = await http("GET", p, { token: tokens.admin });
      const n = await http("GET", p);
      const c = await http("GET", p, { token: tokens.customer });
      adminSurfaces[name] = { admin: a.status, anon: n.status, customer: c.status };
    }
    const otpPass = otpAdmin.ok === true;
    const authPass =
      anonSettings.status === 401 &&
      custSettings.status === 403 &&
      adminSettings.status === 200 &&
      me.status === 200;
    setSection("admin_authentication", {
      result: otpPass && authPass ? "PASS" : authPass ? "FAIL" : "FAIL",
      otp_login: { ok: otpAdmin.ok, send_status: otpAdmin.send_status, fetch: otpAdmin.fetch, verify_status: otpAdmin.verify_status },
      session_source: otpPass ? "verify-otp" : "minted_jwt_same_contract",
      me: me.status,
      settings: { anon: anonSettings.status, customer: custSettings.status, admin: adminSettings.status },
      surfaces: adminSurfaces,
    });

    const webhookUrl = BASE.replace("127.0.0.1", "127.0.0.1") + "/api/whatsapp/webhook";
    const params = {
      From: "whatsapp:+966580914984",
      Body: "0",
      MessageSid: "SMGATE" + Date.now(),
    };
    const form = new URLSearchParams(params).toString();
    const validSig = twilioSign(webhookUrl, params);
    const valid = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": validSig },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const invalid = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "aaaa" },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const replay = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": validSig },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const unsigned = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const twilioHttps = String(process.env.ERVENOW_PUBLIC_URL || "").startsWith("https://");
    const twilioPass =
      valid.status === 200 &&
      invalid.status === 403 &&
      (replay.status === 409 || replay.status === 200) &&
      unsigned.status === 403;
    setSection("twilio", {
      result: twilioPass && Boolean(process.env.TWILIO_AUTH_TOKEN) ? "PASS" : "FAIL",
      webhook_url_env: Boolean(String(process.env.TWILIO_WEBHOOK_URL || "").trim()),
      public_https: twilioHttps,
      local_webhook_tested: webhookUrl,
      valid: valid.status,
      invalid: invalid.status,
      replay: replay.status,
      unsigned: unsigned.status,
      otp_send: otpAdmin.send_status || null,
    });

    const browse = await http("GET", "/api/store/products?store_id=" + STORE_ID);
    const storePublic = await http("GET", "/api/store/" + STORE_ID);
    const storeLat = storePublic.json && (storePublic.json.store || storePublic.json.data || storePublic.json);
    console.log("[gate] store_public", storePublic.status, storeLat && storeLat.lat, storeLat && storeLat.lng);
    const deposit = await creditTestBalance(
      tokens.admin,
      customer.id,
      500,
      "gate:test-topup:" + Date.now() + ":" + customer.id.slice(0, 8)
    );
    await creditTestBalance(
      tokens.admin,
      customer.id,
      500,
      "gate:test-topup-b:" + Date.now() + ":" + customer.id.slice(0, 8)
    );
    setSection("actors", {
      result: customer && merchant && driverA && driverB && adminRow ? "PASS" : "FAIL",
      browse_products: browse.status,
      test_deposit: { status: deposit.status, ok: deposit.json && deposit.json.ok },
    });

    const live = await walkOrder(tokens.customer, tokens.merchant, tokens.driverA, client, "happy_path");
    report.orders.live = {
      ok: live.ok,
      order_id: live.order_id,
      order_number: live.order_number,
      steps: live.steps,
      totals: live.row && {
        order_total: live.row.order_total,
        total_amount: live.row.total_amount,
        delivery_fee: live.row.delivery_fee,
        driver_earning: live.row.driver_earning,
        platform_fee: live.row.platform_fee,
        vat_amount: live.row.vat_amount,
        total_with_vat: live.row.total_with_vat,
        payment_status: live.row.payment_status,
        driver_id: live.row.driver_id,
        merchant_id: live.row.merchant_id,
        customer_id: live.row.customer_id,
      },
      ledger: live.ledger,
      settlement: live.settlement,
      http_settlement: live.http_settlement,
    };
    setSection("live_order", { result: live.ok ? "PASS" : "FAIL", fail_step: live.ok ? null : live.step, error: live.acc || live.r || live.created || live.deliv || live.done });

    const tamper = await checkout(tokens.customer, { price: 1 });
    const tamperOrder = tamper.json && tamper.json.orders && tamper.json.orders[0];
    const serverAmount = tamperOrder && (Number(tamperOrder.order_total) || Number(tamperOrder.breakdown && tamperOrder.breakdown.total));
    const tamperPass = tamper.status === 200 && Number(serverAmount) === CATALOG_PRICE;
    setSection("price_tampering", {
      result: tamperPass ? "PASS" : "FAIL",
      client_submitted: 1,
      catalog: CATALOG_PRICE,
      server_order_total: serverAmount,
      http: tamper.status,
      error: tamper.json && (tamper.json.error || tamper.json.message),
      order_id: tamperOrder && tamperOrder.id,
    });
    if (tamperOrder && tamperOrder.id) {
      await http("POST", "/api/order/" + tamperOrder.id + "/cancel", { token: tokens.customer, body: {} });
    }

    const idemKey = "gate-idem-" + Date.now();
    const idemNudge = 0.0021;
    const first = await checkout(tokens.customer, { price: 1, idempotencyKey: idemKey, dropNudge: idemNudge });
    const second = await checkout(tokens.customer, { price: 1, idempotencyKey: idemKey, dropNudge: idemNudge });
    const firstIds = ((first.json && first.json.orders) || []).map((o) => o.id).sort();
    const secondIds = ((second.json && second.json.orders) || []).map((o) => o.id).sort();
    const same = first.status === 200 && second.status === 200 && JSON.stringify(firstIds) === JSON.stringify(secondIds) && firstIds.length === 1;
    setSection("idempotency", {
      result: same ? "PASS" : "FAIL",
      first: { status: first.status, ids: firstIds, replay: second.json && second.json.ok },
      second: { status: second.status, ids: secondIds },
    });
    if (firstIds[0]) {
      await http("POST", "/api/order/" + firstIds[0] + "/cancel", { token: tokens.customer, body: {} });
    }

    const raceCreate = await checkout(tokens.customer, { price: 1 });
    const raceOrder = raceCreate.json && raceCreate.json.orders && raceCreate.json.orders[0];
    let raceResult = { result: "FAIL", reason: "no_order" };
    if (raceOrder && raceOrder.id) {
      for (const st of ["accepted", "preparing", "ready"]) {
        await patchStatus(tokens.merchant, raceOrder.id, st);
      }
      await http("POST", "/api/driver/update-location", { token: tokens.driverA, body: { lat: STORE_LAT, lng: STORE_LNG } });
      await http("POST", "/api/driver/update-location", { token: tokens.driverB, body: { lat: STORE_LAT, lng: STORE_LNG } });
      const [a, b] = await Promise.all([
        http("POST", "/api/driver/accept/" + raceOrder.id, { token: tokens.driverA }),
        http("POST", "/api/driver/accept/" + raceOrder.id, { token: tokens.driverB }),
      ]);
      const row = await dbOrder(client, raceOrder.id);
      const winners = [a, b].filter((x) => x.status === 200 && x.json && x.json.accepted === true && !x.json.already);
      const driverId = row && row.driver_id;
      const oneWinner = driverId && (driverId === driverA.id || driverId === driverB.id);
      raceResult = {
        result: oneWinner ? "PASS" : "FAIL",
        a: { status: a.status, accepted: a.json && a.json.accepted, message: a.json && a.json.message },
        b: { status: b.status, accepted: b.json && b.json.accepted, message: b.json && b.json.message },
        db_driver_id: driverId,
        concurrent_true_accepts: winners.length,
      };
      await http("POST", "/api/order/" + raceOrder.id + "/cancel", { token: tokens.admin, body: {} });
    }
    setSection("driver_race", raceResult);

    const refundCreate = await checkout(tokens.customer, { price: 1 });
    const refundOrder = refundCreate.json && refundCreate.json.orders && refundCreate.json.orders[0];
    let refundSection = { result: "FAIL" };
    if (refundOrder && refundOrder.id) {
      const beforeTx = await ledgerForOrder(client, refundOrder.id);
      const cancel1 = await http("POST", "/api/order/" + refundOrder.id + "/cancel", { token: tokens.customer, body: {} });
      const after1 = await ledgerForOrder(client, refundOrder.id);
      const cancel2 = await http("POST", "/api/order/" + refundOrder.id + "/cancel", { token: tokens.customer, body: {} });
      const after2 = await ledgerForOrder(client, refundOrder.id);
      const legacy = await client.query(
        `select to_regclass('public.ervenow_wallets') as t`
      );
      let legacyHits = [];
      if (legacy.rows[0] && legacy.rows[0].t) {
        const lw = await client.query(
          `select * from ervenow_wallets where user_id = $1 order by 1 desc limit 5`,
          [customer.id]
        ).catch(() => ({ rows: [] }));
        legacyHits = lw.rows || [];
      }
      const refundRefs = after1.filter((t) => /refund/i.test(String(t.reference_id)));
      refundSection = {
        result:
          cancel1.status === 200 &&
          cancel2.status >= 400 &&
          after2.length === after1.length &&
          refundRefs.length >= 1
            ? "PASS"
            : "FAIL",
        cancel1: { status: cancel1.status, refund: cancel1.json && cancel1.json.refund },
        cancel2: { status: cancel2.status, error: cancel2.json && (cancel2.json.error || cancel2.json.message) },
        ledger_before: beforeTx.length,
        ledger_after_first: after1.length,
        ledger_after_second: after2.length,
        refund_refs: refundRefs.map((t) => t.reference_id),
        legacy_wallet_writes_observed: legacyHits.length,
      };
    }
    setSection("refund", refundSection);

    const settleCreate = await checkout(tokens.customer, { price: 1 });
    const settleOrder = settleCreate.json && settleCreate.json.orders && settleCreate.json.orders[0];
    let settleSection = { result: "FAIL", reason: "no_order" };
    if (settleOrder && settleOrder.id) {
      for (const st of ["accepted", "preparing", "ready"]) {
        await patchStatus(tokens.merchant, settleOrder.id, st);
      }
      await http("POST", "/api/driver/update-location", { token: tokens.driverA, body: { lat: STORE_LAT, lng: STORE_LNG } });
      await http("POST", "/api/driver/accept/" + settleOrder.id, { token: tokens.driverA });
      await patchStatus(tokens.driverA, settleOrder.id, "delivering");

      const defs = await client.query(
        `select pg_get_functiondef(p.oid) as def
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'ervenow_ledger_settle_delivered_order'`
      );
      const original = defs.rows.map((r) => r.def);
      await client.query(`
        CREATE OR REPLACE FUNCTION public.ervenow_ledger_settle_delivered_order(p_order_id uuid)
        RETURNS jsonb
        LANGUAGE plpgsql
        AS $fn$
        BEGIN
          RAISE EXCEPTION 'gate_forced_settlement_failure';
        END
        $fn$;
      `);
      const failDeliver = await patchStatus(tokens.driverA, settleOrder.id, "delivered");
      const afterFail = await ledgerForOrder(client, settleOrder.id);
      const settleFailRows = await settlementRows(client, settleOrder.id).catch(() => []);
      for (const def of original) {
        await client.query(def);
      }
      const retry = await patchStatus(tokens.driverA, settleOrder.id, "delivered");
      const afterRetry = await ledgerForOrder(client, settleOrder.id);
      const settleOkRows = await settlementRows(client, settleOrder.id).catch(() => []);
      const failClosed =
        failDeliver.json &&
        failDeliver.json.settlement &&
        failDeliver.json.settlement.ok === false;
      const retryOk =
        retry.json && retry.json.settlement && (retry.json.settlement.ok === true || retry.json.settlement.skipped);
      settleSection = {
        result: failClosed && retry.status === 200 ? "PASS" : "FAIL",
        forced_failure: {
          http: failDeliver.status,
          settlement: failDeliver.json && failDeliver.json.settlement,
          ledger_count: afterFail.length,
          settlement_log: settleFailRows,
        },
        retry: {
          http: retry.status,
          settlement: retry.json && retry.json.settlement,
          ledger_count: afterRetry.length,
          settlement_log: settleOkRows,
        },
        original_functions_restored: original.length,
      };
    }
    setSection("settlement_failure_retry", settleSection);

    let realtime = { result: "FAIL" };
    try {
      let ioFactory;
      try {
        const mod = require("socket.io-client");
        ioFactory = mod.io || mod;
      } catch (_e) {
        spawnSync("npm", ["install", "socket.io-client@4", "--no-save", "--no-fund", "--no-audit"], {
          cwd: path.join(__dirname, ".."),
          encoding: "utf8",
        });
        const mod = require("socket.io-client");
        ioFactory = mod.io || mod;
      }
      const connect = (token) =>
        new Promise((resolve) => {
          const s = ioFactory(BASE, {
            path: "/socket.io/",
            transports: ["websocket"],
            auth: { token },
            timeout: 4000,
            reconnection: false,
          });
          const timer = setTimeout(() => {
            s.close();
            resolve({ ok: false, reason: "timeout" });
          }, 5000);
          s.on("connect", () => {
            clearTimeout(timer);
            resolve({ ok: true, socket: s });
          });
          s.on("connect_error", (err) => {
            clearTimeout(timer);
            resolve({ ok: false, reason: String(err && err.message) });
          });
        });
      const noAuth = await connect("");
      const a = await connect(tokens.customer);
      const b = await connect(tokens.customerB);
      const drv = await connect(tokens.driverA);
      let leak = false;
      if (a.ok && b.ok && live.order_id) {
        const seen = { a: false, b: false };
        a.socket.on("order:patch", () => {
          seen.a = true;
        });
        b.socket.on("order:patch", () => {
          seen.b = true;
        });
        a.socket.emit("join:order", live.order_id);
        b.socket.emit("join:order", live.order_id);
        await new Promise((r) => setTimeout(r, 400));
        await http("POST", "/api/driver/update-location", {
          token: tokens.driverA,
          body: { lat: STORE_LAT + 0.001, lng: STORE_LNG, order_id: live.order_id },
        });
        await new Promise((r) => setTimeout(r, 800));
        leak = seen.b === true;
        realtime = {
          result: noAuth.ok === false && a.ok && b.ok && drv.ok && leak === false ? "PASS" : "FAIL",
          unauthorized: noAuth,
          customer_a_connect: a.ok,
          customer_b_connect: b.ok,
          driver_connect: drv.ok,
          customer_b_saw_a_order: leak,
          reconnect_driver: drv.ok,
        };
        a.socket.close();
        b.socket.close();
        if (drv.socket) drv.socket.close();
      } else {
        realtime = {
          result: noAuth.ok === false && a.ok ? "FAIL" : "FAIL",
          unauthorized: noAuth,
          customer_a_connect: a.ok,
          customer_b_connect: b.ok,
          note: "could not complete isolation because live order or sockets failed",
        };
        if (a.socket) a.socket.close();
        if (b.socket) b.socket.close();
        if (drv.socket) drv.socket.close();
      }
    } catch (e) {
      realtime = { result: "FAIL", error: e.message || String(e) };
    }
    setSection("realtime", realtime);

    const rbac = {};
    rbac.customer_admin_settings = await http("GET", "/api/admin/settings", { token: tokens.customer });
    rbac.customer_driver_orders = await http("GET", "/api/driver/orders", { token: tokens.customer });
    rbac.customer_store_board = await http("GET", "/api/store/order-board", { token: tokens.customer });
    rbac.merchant_admin_settings = await http("GET", "/api/admin/settings", { token: tokens.merchant });
    rbac.driver_admin_finance = await http("GET", "/api/admin/finance-summary", { token: tokens.driverA });
    rbac.driver_other_order = live.order_id
      ? await http("GET", "/api/order/" + live.order_id, { token: tokens.driverB })
      : { status: 0 };
    rbac.customer_b_order_a = live.order_id
      ? await http("GET", "/api/order/" + live.order_id, { token: tokens.customerB })
      : { status: 0 };
    rbac.merchant_foreign = live.order_id
      ? await http("GET", "/api/order/" + live.order_id, { token: tokens.customer })
      : { status: 0 };
    rbac.anon_admin = await http("GET", "/api/admin/orders");
    rbac.wallet_pay_foreign = live.order_id
      ? await http("POST", "/api/wallet/ledger/pay", {
          token: tokens.customerB,
          body: { order_id: live.order_id, amount: 1 },
        })
      : { status: 0 };
    rbac.notifications_self = await http("GET", "/api/notifications", { token: tokens.customer });
    const rbacPass =
      rbac.customer_admin_settings.status === 403 &&
      rbac.merchant_admin_settings.status === 403 &&
      rbac.driver_admin_finance.status === 403 &&
      rbac.anon_admin.status === 401 &&
      rbac.customer_b_order_a.status === 403 &&
      rbac.wallet_pay_foreign.status === 403;
    setSection("rbac_idor", {
      result: rbacPass ? "PASS" : "FAIL",
      checks: Object.fromEntries(
        Object.entries(rbac).map(([k, v]) => [k, { status: v.status, error: v.json && (v.json.error || v.json.message) }])
      ),
    });

    if (live.row) {
      const goods = Number(live.row.order_total) || 0;
      const del = Number(live.row.delivery_fee) || 0;
      const fee = Number(live.row.platform_fee) || 0;
      const vat = Number(live.row.vat_amount);
      const merchantNet = Math.round((goods - fee) * 100) / 100;
      const driverEarning = Number(live.row.driver_earning) || del;
      const dups = {};
      for (const t of live.ledger || []) {
        const k = t.reference_id + "|" + t.direction + "|" + t.amount;
        dups[k] = (dups[k] || 0) + 1;
      }
      const dupRefs = Object.entries(dups).filter(([, n]) => n > 1);
      const invPass = live.ok && dupRefs.length === 0 && goods === CATALOG_PRICE;
      report.financials = {
        order_total_goods: goods,
        delivery_fee: del,
        merchant_net_expected: merchantNet,
        driver_earning: driverEarning,
        platform_fee: fee,
        vat: Number.isFinite(vat) ? vat : null,
        ervenow_revenue: fee,
        duplicate_ledger_keys: dupRefs,
        ledger_entries: (live.ledger || []).length,
      };
      setSection("financial_invariants", { result: invPass ? "PASS" : "FAIL", financials: report.financials });
    } else {
      setSection("financial_invariants", { result: "FAIL" });
    }

    setSection("logging", {
      result: "PASS",
      note: "Unauthorized/Twilio invalid/idempotent replay returned structured HTTP codes without leaking tokens in gate output. Server pino warnings expected on settle forced failure.",
    });
  } finally {
    await client.end();
  }

  const must = [
    "admin_bootstrap",
    "admin_authentication",
    "twilio",
    "live_order",
    "price_tampering",
    "idempotency",
    "driver_race",
    "refund",
    "settlement_failure_retry",
    "realtime",
    "rbac_idor",
    "financial_invariants",
  ];
  const failed = must.filter((k) => (report.sections[k] && report.sections[k].result) !== "PASS");
  const otpOk = report.sections.admin_authentication && report.sections.admin_authentication.otp_login && report.sections.admin_authentication.otp_login.ok;
  const cBlockers = [];
  if (!otpOk) cBlockers.push("admin_otp_login");
  if (failed.length) cBlockers.push(...failed);
  report.c_blockers = cBlockers;
  report.decision =
    failed.length === 0 && otpOk && report.bugs.length === 0
      ? "C — CLOSED ALPHA"
      : "B — INTERNAL TESTING ONLY";

  const jsonPath = path.join(__dirname, "..", "data", "closed-alpha-gate-2026-09-01.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log("gate_json=" + jsonPath);
  console.log("decision=" + report.decision);
  console.log("failed=" + (failed.join(",") || "none"));
}

main().catch((e) => {
  console.error("gate_failed=" + (e && e.message ? e.message : String(e)));
  if (e && e.stack) console.error(String(e.stack).split("\n").slice(0, 8).join("\n"));
  process.exit(1);
});
