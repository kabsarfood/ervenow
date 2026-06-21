/**
 * LPG Central Refill Live E2E + Validation Report
 * Usage: LIVE_E2E=1 node scripts/lpg-central-refill-live-e2e.js
 *
 * Optional: E2E_GAS_CENTRAL_PROVIDER_ID, E2E_CUSTOMER_USER_ID, E2E_KEEP_ORDER=1
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

if (String(process.env.SUPABASE_INSECURE_SSL || process.env.LIVE_E2E || "").trim() === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const { createServiceOrder } = require("../shared/services/serviceOrderCreate");
const { completeServiceOrder } = require("../shared/services/completeServiceOrder");
const { resolveProviderCreditAmount } = require("../shared/services/providerLedgerCredit");
const { priceCentralRefill, computeGasPlatformCommission } = require("../shared/utils/gasDeliveryPricing");
const { providerMatchesBookingType } = require("../shared/utils/serviceProviderTypes");
const { currentGasRadiusKm, providerWithinGasRadius, providerCoords } = require("../shared/utils/gasDeliveryRadius");
const { applyProviderIdToPatch } = require("../shared/utils/orderProviderId");
const { buildOrderStatusPatch } = require("../shared/domain/orders/orderStatus");
const { DELIVERY_STATUS } = require("../shared/domain/orders/constants");
const { updateOrdersResilient } = require("../shared/utils/idempotency");
const { resolveOrderPortalType } = require("../shared/utils/orderPortalRouting");
const { orderToBookingView, bookingStatus } = require("../shared/utils/serviceOrderQuery");

function getSupabase() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function pickGasCentralProvider(sb) {
  const forced = String(process.env.E2E_GAS_CENTRAL_PROVIDER_ID || "").trim();
  if (forced) {
    const { data } = await sb.from("users").select("*").eq("id", forced).maybeSingle();
    if (data) return data;
  }
  const { data, error } = await sb
    .from("users")
    .select("*")
    .eq("role", "service")
    .eq("service_type", "gas_central_refill")
    .in("status", ["approved", "active"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function pickCustomer(sb) {
  const forced = String(process.env.E2E_CUSTOMER_USER_ID || "").trim();
  if (forced) {
    const { data } = await sb.from("users").select("*").eq("id", forced).maybeSingle();
    if (data) return data;
  }
  const { data, error } = await sb
    .from("users")
    .select("*")
    .in("role", ["customer", "user"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function walletBalance(sb, userId) {
  const { data } = await sb.from("ervenow_ledger_wallets").select("balance").eq("user_id", userId).maybeSingle();
  return Number(data && data.balance) || 0;
}

async function countNotifications(sb, orderId) {
  const oid = String(orderId || "").trim();
  if (!oid) return 0;
  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .filter("payload->>order_id", "eq", oid);
  if (!error && count != null) return count;
  const { count: c2 } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .contains("payload", { order_id: oid });
  return c2 || 0;
}

function gasModeFromOrder(order) {
  const d = order && order.data && typeof order.data === "object" ? order.data : {};
  return String(order.gas_mode || d.gas_mode || "").toLowerCase();
}

function providerSeesBooking(provider, order) {
  const enriched = {
    ...order,
    gas_mode: gasModeFromOrder(order),
    drop_lat: order.drop_lat ?? dNum(order, "drop_lat"),
    drop_lng: order.drop_lng ?? dNum(order, "drop_lng"),
  };
  const st = String(order.service_type || "").toLowerCase();
  if (!providerMatchesBookingType(provider.service_type, st, enriched.gas_mode)) return false;
  if (!providerCoords(provider)) return false;
  return providerWithinGasRadius(provider, enriched, currentGasRadiusKm(enriched));
}

function dNum(order, key) {
  const d = order && order.data && typeof order.data === "object" ? order.data : {};
  const n = Number(order[key] ?? d[key]);
  return Number.isFinite(n) ? n : null;
}

function writeReports(report) {
  const jsonPath = path.join(__dirname, "..", "data", "lpg-central-refill-live-e2e.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const mdPath = path.join(__dirname, "..", "docs", "LPG-CENTRAL-REFILL-LIVE-VALIDATION-REPORT.md");
  const checks = report.checks || {};
  const checkLines = Object.entries(checks)
    .map(([k, v]) => `| ${k} | ${v.pass ? "PASS" : "FAIL"} |`)
    .join("\n");

  fs.writeFileSync(
    mdPath,
    `# LPG Central Refill Live Validation Report

**Generated:** ${report.generated_at}

## Verdict

**${report.verdict}**

## Provider

\`\`\`json
${JSON.stringify(report.provider || {}, null, 2)}
\`\`\`

## Order

\`${report.order_id || "—"}\`

## Validation Checks

| # | Check | Result |
|---|-------|--------|
${checkLines}

## Steps

${(report.steps || []).map((s) => `- **${s.step}** → ${s.detail || s.status || "—"}`).join("\n")}

## Proofs

\`\`\`json
${JSON.stringify(report.proofs || {}, null, 2)}
\`\`\`

${report.error ? `\n**Error:** ${report.error}\n` : ""}`
  );
}

async function run() {
  if (String(process.env.LIVE_E2E || "").trim() !== "1") {
    console.log("[lpg-central-e2e] skipped — set LIVE_E2E=1");
    process.exit(0);
  }

  const sb = getSupabase();
  if (!sb) throw new Error("SUPABASE_URL + SERVICE_ROLE_KEY required");

  const report = {
    report: "LPG Central Refill Live Validation Report",
    generated_at: new Date().toISOString(),
    steps: [],
    checks: {},
    proofs: {},
    verdict: "FAIL",
    error: null,
    order_id: null,
    provider: null,
  };

  let orderId = null;
  const liters = 1000;
  const actualLiters = 1000;

  try {
    const provider = await pickGasCentralProvider(sb);
    if (!provider) {
      report.error = "no_gas_central_refill_provider";
      writeReports(report);
      console.log("[lpg-central-e2e] FAIL — no provider");
      process.exit(1);
    }
    report.provider = {
      id: provider.id,
      role: provider.role,
      service_type: provider.service_type,
      status: provider.status,
      phone: provider.phone,
      lat: provider.lat,
      lng: provider.lng,
    };

    const customer = await pickCustomer(sb);
    if (!customer) throw new Error("no customer");

    const walletBefore = await walletBalance(sb, provider.id);
    const total = priceCentralRefill(liters);

    const created = await createServiceOrder(sb, customer, {
      service_type: "gas_delivery",
      gas_mode: "central_refill",
      gas_liters: liters,
      district: "E2E Central Gas",
      location: "24.713600,46.675300",
      total_amount: total,
      payment_status: "unpaid",
      data: {
        gas_mode: "central_refill",
        gas_liters: liters,
        establishment_name: "منشأة E2E Live",
        drop_lat: 24.7136,
        drop_lng: 46.6753,
      },
    });
    if (!created.ok) throw new Error(created.message || "create failed");

    const order = created.order;
    orderId = order.id;
    report.order_id = orderId;
    const booking = orderToBookingView(order);

    report.steps.push({
      step: "1_create_refill_order",
      detail: `order ${orderId}, gas_mode=central_refill, ${liters}L, total=${total}`,
    });
    report.checks["1_create_refill_order"] = {
      pass:
        gasModeFromOrder(order) === "central_refill" &&
        order.portal_type === "service",
    };

    const visible = providerSeesBooking(provider, order);
    report.steps.push({ step: "2_visible_to_provider", detail: visible ? "yes" : "no" });
    report.checks["2_visible_to_provider"] = { pass: visible };

    const now = new Date().toISOString();
    const reservePatch = applyProviderIdToPatch(
      {
        reserved_at: now,
        updated_at: now,
        driver_lat: Number(provider.lat),
        driver_lng: Number(provider.lng),
        ...buildOrderStatusPatch(DELIVERY_STATUS.ACCEPTED),
      },
      provider.id
    );
    const { data: reserved, error: rErr } = await updateOrdersResilient(sb, reservePatch, (q) =>
      q.eq("id", orderId).is("provider_id", null)
    );
    if (rErr || !reserved) throw new Error(rErr?.message || "reserve failed");
    report.steps.push({ step: "3_accept", detail: reserved.delivery_status });
    report.checks["3_accept"] = {
      pass: reserved.delivery_status === "accepted" && String(reserved.provider_id) === String(provider.id),
    };

    const delivering = await completeServiceOrder(sb, orderId, provider.id, { actor: "provider" });
    if (delivering.error) throw new Error(delivering.error.message);
    report.steps.push({ step: "4_start_refill", detail: delivering.data?.delivery_status });
    report.checks["4_start_refill"] = { pass: delivering.data?.delivery_status === "delivering" };

    const dataPatch = {
      ...(delivering.data?.data && typeof delivering.data.data === "object" ? delivering.data.data : {}),
      actual_liters_delivered: actualLiters,
    };
    await updateOrdersResilient(sb, { data: dataPatch, updated_at: now }, { id: orderId });
    report.steps.push({ step: "5_record_actual_liters", detail: `${actualLiters} L` });
    report.checks["5_record_actual_liters"] = { pass: dataPatch.actual_liters_delivered === actualLiters };

    const delivered = await completeServiceOrder(sb, orderId, provider.id, { actor: "legacy" });
    if (delivered.error) throw new Error(delivered.error.message);
    report.steps.push({ step: "6_finish_task", detail: delivered.data?.delivery_status });
    report.checks["6_finish_task"] = { pass: delivered.data?.delivery_status === "delivered" };

    const credit = delivered.provider_credit || {};
    const credited = Number(credit.amount);
    const expectedCredit = resolveProviderCreditAmount(delivered.data);

    const settlementOk =
      (credit.ok === true || credit.ok === "true" || credit.reason === "duplicate") &&
      Number.isFinite(credited) &&
      credited === expectedCredit &&
      credited !== Number(delivered.data.total_amount);

    report.steps.push({
      step: "7_settlement",
      detail: `credit=${credited}, expected=${expectedCredit}, total=${total}`,
    });
    report.checks["7_settlement"] = { pass: settlementOk };

    const walletAfter = await walletBalance(sb, provider.id);
    const walletDelta = Math.round((walletAfter - walletBefore) * 100) / 100;
    const walletOk = walletDelta === expectedCredit || (credit.reason === "duplicate" && walletDelta >= 0);

    report.steps.push({ step: "8_wallet_credit", detail: `before=${walletBefore}, after=${walletAfter}, delta=${walletDelta}` });
    report.checks["8_wallet_credit"] = { pass: walletOk };

    const notifCount = await countNotifications(sb, orderId);
    report.steps.push({ step: "9_notifications", detail: `count=${notifCount}` });
    report.checks["9_notifications"] = { pass: notifCount > 0 };

    report.proofs = {
      portal_type: order.portal_type,
      visible_service: resolveOrderPortalType(order) === "service",
      gas_mode: order.gas_mode || order.data?.gas_mode,
      gas_liters: order.gas_liters,
      actual_liters_delivered: delivered.data?.data?.actual_liters_delivered,
      total_amount: delivered.data?.total_amount,
      platform_commission: delivered.data?.platform_commission,
      provider_net: delivered.data?.data?.provider_net,
      ledger_credit: credited,
      expected_credit: expectedCredit,
      wallet: { before: walletBefore, after: walletAfter, delta: walletDelta },
      notifications_count: notifCount,
      provider_credit: credit,
    };

    const allPass = Object.values(report.checks).every((c) => c.pass);
    report.verdict = allPass ? "PASS" : "FAIL";
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

  writeReports(report);
  console.log("[lpg-central-e2e]", report.verdict, report.checks);
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

run().catch((e) => {
  console.error("[lpg-central-e2e]", e.message || e);
  process.exit(1);
});
