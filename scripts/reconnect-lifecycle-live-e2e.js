/**
 * Full live lifecycle E2E — real Supabase (no mock)
 * Usage: LIVE_E2E=1 node scripts/reconnect-lifecycle-live-e2e.js
 *
 * Optional env:
 *   E2E_STORE_ID, E2E_MERCHANT_USER_ID, E2E_DRIVER_USER_ID, E2E_CUSTOMER_USER_ID
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (String(process.env.SUPABASE_INSECURE_SSL || process.env.LIVE_E2E || "").trim() === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const { patchUnifiedOrderStatus } = require("../shared/services/unifiedOrderStatus");

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function pickRow(sb, table, select, filters) {
  let q = sb.from(table).select(select);
  Object.entries(filters || {}).forEach(([k, v]) => {
    q = q.eq(k, v);
  });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function resolveActors(sb) {
  const storeId = String(process.env.E2E_STORE_ID || "").trim();
  const storeSelect = "id,name,owner_user_id,lat,lng,address";
  let store = storeId ? await pickRow(sb, "stores", storeSelect, { id: storeId }) : null;
  if (!store) {
    const { data, error } = await sb.from("stores").select(storeSelect).limit(1).maybeSingle();
    if (error) throw new Error("stores: " + error.message);
    store = data;
  }
  if (!store) throw new Error("لا متجر للاختبار — عيّن E2E_STORE_ID");

  const merchantId = String(process.env.E2E_MERCHANT_USER_ID || store.owner_user_id || "").trim();
  const { data: merchantUser, error: mErr } = await sb
    .from("users")
    .select("id,phone,role")
    .eq("id", merchantId)
    .maybeSingle();
  if (mErr) throw new Error("merchant: " + mErr.message);
  if (!merchantUser) throw new Error("merchant user not found");

  let driverId = String(process.env.E2E_DRIVER_USER_ID || "").trim();
  if (!driverId) {
    const { data: driverRow, error: dErr } = await sb
      .from("users")
      .select("id,phone,role,lat,lng")
      .eq("role", "driver")
      .in("status", ["approved", "active"])
      .limit(1)
      .maybeSingle();
    if (dErr) throw new Error("driver lookup: " + dErr.message);
    if (!driverRow) throw new Error("لا مندوب معتمد — عيّن E2E_DRIVER_USER_ID");
    driverId = driverRow.id;
  }
  const { data: driverUser, error: duErr } = await sb
    .from("users")
    .select("id,phone,role,lat,lng")
    .eq("id", driverId)
    .maybeSingle();
  if (duErr) throw new Error("driver: " + duErr.message);
  if (!driverUser) throw new Error("driver user not found");

  let customerId = String(process.env.E2E_CUSTOMER_USER_ID || "").trim();
  if (!customerId) {
    const { data: cust } = await sb.from("users").select("id,phone,role").eq("role", "customer").limit(1).maybeSingle();
    customerId = cust && cust.id;
  }
  const { data: customerUser } = customerId
    ? await sb.from("users").select("id,phone,role").eq("id", customerId).maybeSingle()
    : { data: { id: merchantId, phone: merchantUser.phone, role: "customer" } };

  return {
    store,
    merchant: { id: merchantUser.id, phone: merchantUser.phone, role: "store" },
    driver: {
      id: driverUser.id,
      phone: driverUser.phone,
      role: "driver",
      lat: driverUser.lat || store.lat || 24.7136,
      lng: driverUser.lng || store.lng || 46.6753,
    },
    customer: { id: customerUser.id, phone: customerUser.phone, role: "customer" },
  };
}

async function createStoreOrder(sb, actors) {
  const id = crypto.randomUUID();
  const orderNumber = "E2E-" + Date.now().toString(36).toUpperCase();
  const lat = Number(actors.store.lat) || 24.7136;
  const lng = Number(actors.store.lng) || 46.6753;
  const row = {
    id,
    order_number: orderNumber,
    store_id: actors.store.id,
    merchant_id: actors.merchant.id,
    customer_id: actors.customer.id,
    customer_phone: actors.customer.phone || "0500000000",
    store_name: actors.store.name || "E2E Store",
    order_type: "store",
    portal_type: "merchant",
    delivery_status: "pending",
    status: "pending",
    payment_status: "paid",
    payment_method: "ew_pay",
    order_total: 50,
    total_amount: 50,
    delivery_fee: 15,
    driver_earning: 12,
    platform_fee: 3,
    pickup_lat: lat,
    pickup_lng: lng,
    drop_lat: lat + 0.01,
    drop_lng: lng + 0.01,
    pickup_address: actors.store.address || "E2E pickup",
    drop_address: "E2E drop address",
    currency_code: "SAR",
    country_code: "SA",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from("orders").insert(row).select("*").single();
  if (error) throw new Error("insert order: " + error.message);
  return data;
}

async function step(sb, orderId, status, user, label) {
  const out = await patchUnifiedOrderStatus(sb, orderId, status, user);
  if (out.error) throw new Error(label + ": " + (out.error.message || String(out.error)));
  return out;
}

async function driverAcceptReady(sb, orderId, driver) {
  await sb
    .from("users")
    .update({ lat: driver.lat, lng: driver.lng, updated_at: new Date().toISOString() })
    .eq("id", driver.id);
  return step(sb, orderId, "picked_up", driver, "driver accept (picked_up)");
}

async function countNotifications(sb, orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return 0;
  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .filter("payload->>order_id", "eq", oid);
  if (!error && count != null) return count;
  const { count: c2, error: e2 } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .contains("payload", { order_id: oid });
  if (!e2 && c2 != null) return c2;
  return 0;
}

async function driverWalletDelta(sb, driverId, beforeBal) {
  const { data } = await sb.from("ervenow_ledger_wallets").select("balance").eq("user_id", driverId).maybeSingle();
  const after = Number(data && data.balance) || 0;
  return { before: beforeBal, after, delta: after - beforeBal };
}

async function main() {
  if (String(process.env.LIVE_E2E || "").trim() !== "1") {
    console.log("[live-e2e] skipped — set LIVE_E2E=1 to run");
    process.exit(0);
  }

  const sb = getSupabase();
  if (!sb) {
    console.error("[live-e2e] SUPABASE_URL + SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  const report = {
    generated_at: new Date().toISOString(),
    verdict: "FAIL",
    order_id: null,
    steps: [],
    proofs: {},
    error: null,
  };

  let orderId = null;
  try {
    const actors = await resolveActors(sb);
    const { data: walletBefore } = await sb
      .from("ervenow_ledger_wallets")
      .select("balance")
      .eq("user_id", actors.driver.id)
      .maybeSingle();
    const driverBalBefore = Number(walletBefore && walletBefore.balance) || 0;

    const order = await createStoreOrder(sb, actors);
    orderId = order.id;
    report.order_id = orderId;

    const chain = [
      { status: "accepted", user: actors.merchant, label: "merchant accept" },
      { status: "preparing", user: actors.merchant, label: "merchant preparing" },
      { status: "ready", user: actors.merchant, label: "merchant ready" },
    ];
    for (const s of chain) {
      const out = await step(sb, orderId, s.status, s.user, s.label);
      report.steps.push({ step: s.label, status: out.data && out.data.delivery_status });
    }

    const pick = await driverAcceptReady(sb, orderId, actors.driver);
    report.steps.push({ step: "driver accept", status: pick.data && pick.data.delivery_status });

    const del1 = await step(sb, orderId, "delivering", actors.driver, "driver delivering");
    report.steps.push({ step: "delivering", status: del1.data && del1.data.delivery_status });

    const del2 = await step(sb, orderId, "delivered", actors.driver, "driver delivered");
    report.steps.push({
      step: "delivered",
      status: del2.data && del2.data.delivery_status,
      settlement: del2.settlement,
      driver_credit: del2.driver_credit,
    });

    const { data: finalOrder } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    const notifCount = await countNotifications(sb, orderId);
    const wallet = await driverWalletDelta(sb, actors.driver.id, driverBalBefore);

    report.proofs = {
      order_status: finalOrder && finalOrder.delivery_status,
      wallet_credited_at: finalOrder && finalOrder.wallet_credited_at,
      delivered_at: finalOrder && finalOrder.delivered_at,
      driver_id: finalOrder && finalOrder.driver_id,
      notifications_count: notifCount,
      driver_wallet: wallet,
    };

    const ok =
      finalOrder &&
      String(finalOrder.delivery_status).toLowerCase() === "delivered" &&
      finalOrder.driver_id === actors.driver.id &&
      (finalOrder.wallet_credited_at ||
        (del2.settlement && del2.settlement.ok) ||
        (del2.driver_credit && del2.driver_credit.ok) ||
        wallet.delta > 0) &&
      notifCount > 0;

    report.verdict = ok ? "PASS" : "FAIL";
  } catch (e) {
    report.error = e.message || String(e);
    report.verdict = "FAIL";
  } finally {
    if (orderId && String(process.env.E2E_KEEP_ORDER || "") !== "1") {
      try {
        await sb.from("orders").delete().eq("id", orderId);
        report.cleanup = "deleted";
      } catch (_e) {
        report.cleanup = "failed";
      }
    }
  }

  const jsonPath = path.join(__dirname, "..", "data", "reconnect-lifecycle-live-e2e.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(__dirname, "..", "docs", "RECONNECT-LIFECYCLE-LIVE-E2E.md");
  fs.writeFileSync(
    mdPath,
    "# Full Live E2E — Store Delivery Lifecycle\n\n" +
      "**التاريخ:** " +
      report.generated_at +
      "\n\n**الحكم:** **" +
      report.verdict +
      "**\n\n" +
      (report.order_id ? "**Order:** `" + report.order_id + "`\n\n" : "") +
      "## Steps\n\n" +
      report.steps.map((s) => "- " + s.step + " → " + (s.status || "—")).join("\n") +
      "\n\n## Proofs\n\n```json\n" +
      JSON.stringify(report.proofs, null, 2) +
      "\n```\n" +
      (report.error ? "\n**Error:** " + report.error + "\n" : "")
  );

  console.log("[live-e2e]", report.verdict, report.proofs);
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

main();
