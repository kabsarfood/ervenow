/**
 * LPG Settlement Verification — proves Option A (Ledger Credit = Provider Net)
 * Usage: node scripts/lpg-settlement-verification.js
 */
const fs = require("fs");
const path = require("path");

const {
  CENTRAL_PRICE_PER_LITER,
  priceCentralRefill,
  computeGasPlatformCommission,
} = require("../shared/utils/gasDeliveryPricing");
const { computePlatformCommission } = require("../shared/utils/platformCommission");
const {
  resolveProviderCreditAmount,
  creditProviderOnDelivered,
} = require("../shared/services/providerLedgerCredit");

const LITERS = 1000;

function buildCentralOrder(liters) {
  const total = priceCentralRefill(liters);
  const platformCommission = computeGasPlatformCommission("central_refill", 1, liters, total);
  const providerNet = Math.max(0, Math.round((total - platformCommission) * 100) / 100);
  return {
    id: "verify-central-" + liters,
    provider_id: "provider-verify",
    order_type: "gas_delivery",
    service_type: "gas_delivery",
    gas_mode: "central_refill",
    gas_liters: liters,
    total_amount: total,
    platform_commission: platformCommission,
    data: { provider_net: providerNet, gas_mode: "central_refill", gas_liters: liters },
  };
}

async function run() {
  const order = buildCentralOrder(LITERS);
  const customerPerLiter = CENTRAL_PRICE_PER_LITER;
  const totalAmount = order.total_amount;
  const platformCommission = order.platform_commission;
  const providerNet = order.data.provider_net;
  const resolvedCredit = resolveProviderCreditAmount(order);

  const mockSb = {
    rpc: jestLikeFn(async (name, args) => {
      if (name !== "ervenow_ledger_credit") throw new Error("unexpected rpc");
      return { data: { ok: true, reason: "inserted", amount: args.p_amount }, error: null };
    }),
    _lastRpc: null,
  };
  function jestLikeFn(impl) {
    const fn = (...args) => {
      fn.calls.push(args);
      return impl(...args);
    };
    fn.calls = [];
    return fn;
  }

  const creditRow = await creditProviderOnDelivered(mockSb, order, "lpg-settlement-verify");
  const ledgerCredit = mockSb.rpc.calls[0] ? mockSb.rpc.calls[0][1].p_amount : null;

  const beforeFixWouldBe = totalAmount;
  const optionA = providerNet;
  const verdict = ledgerCredit === providerNet && ledgerCredit !== totalAmount ? "PASS" : "FAIL";
  const decision = "Option A — Ledger Credit = Provider Net";

  const report = {
    report: "LPG Settlement Verification Report",
    generated_at: new Date().toISOString(),
    scenario: {
      liters: LITERS,
      customer_price_per_liter_sar: customerPerLiter,
    },
    table: {
      customer_price_per_liter: customerPerLiter,
      customer_price: customerPerLiter,
      total_amount: totalAmount,
      provider_net: providerNet,
      platform_commission: platformCommission,
      ledger_credit: ledgerCredit,
      resolved_credit_amount: resolvedCredit,
      legacy_bug_credit_total_amount: beforeFixWouldBe,
    },
    proof: {
      resolveProviderCreditAmount: resolvedCredit,
      rpc_call: mockSb.rpc.calls[0] || null,
      credit_row: creditRow,
      option_a_expected: optionA,
      option_b_not_used: "Split ledger entries deferred — Option A adopted",
    },
    decision,
    verdict,
  };

  const jsonPath = path.join(__dirname, "..", "data", "lpg-settlement-verification-report.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const mdPath = path.join(__dirname, "..", "docs", "LPG-SETTLEMENT-VERIFICATION-REPORT.md");
  const md = `# LPG Settlement Verification Report

**Generated:** ${report.generated_at}

## Scenario

${LITERS} liters × ${customerPerLiter} SAR/L = **${totalAmount} SAR**

## Verification Table

| البند | القيمة (SAR) |
| ----- | ------------ |
| Customer Price / L | ${customerPerLiter} |
| Total Amount | ${totalAmount} |
| Provider Net | ${providerNet} |
| Platform Commission | ${platformCommission} |
| Ledger Credit (after fix) | ${ledgerCredit} |
| Legacy bug (credit = total) | ${beforeFixWouldBe} |

## Decision

**${decision}**

Platform commission (${platformCommission} SAR) is retained implicitly — customer pays ${totalAmount}, provider wallet receives ${ledgerCredit}.

## Proof

\`\`\`json
${JSON.stringify(report.proof, null, 2)}
\`\`\`

## Verdict

**${verdict}**
`;
  fs.writeFileSync(mdPath, md, "utf8");

  console.log("[lpg-settlement-verify]", verdict, report.table);
  return report;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
