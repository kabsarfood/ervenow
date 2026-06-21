#!/usr/bin/env node
/**
 * G1-R Final — Routing Validation Report
 * node scripts/routing-validation-report.js
 */
const fs = require("fs");
const path = require("path");
const {
  resolvePortalRole,
  isTransportPortalType,
  isServicePortalType,
  isDriverPortalType,
  SERVICE_PORTAL_TYPES,
  TRANSPORT_PORTAL_TYPES,
  DRIVER_PORTAL_TYPES,
} = require("../shared/utils/resolvePortalRole");
const {
  resolveOrderPortalType,
  orderVisibleInPortal,
  ORDER_PORTAL_TYPES,
} = require("../shared/utils/orderPortalRouting");
const { isDriverDispatchOrder } = require("../shared/utils/driverDispatchOrders");

const FINAL_ROUTING_TABLE = [
  { orderKind: "restaurant", serviceType: null, expectedPortal: "merchant", label: "مطعم" },
  { orderKind: "store", serviceType: null, expectedPortal: "merchant", label: "متجر" },
  { orderKind: "service", serviceType: "plumber", expectedPortal: "service", label: "سباك" },
  { orderKind: "service", serviceType: "electrician", expectedPortal: "service", label: "كهربائي" },
  { orderKind: "service", serviceType: "ac_technician", expectedPortal: "service", label: "تكييف" },
  { orderKind: "service", serviceType: "laundry_estates", expectedPortal: "service", label: "غسيل" },
  { orderKind: "service", serviceType: "agricultural_engineer", expectedPortal: "service", label: "تشجير" },
  { orderKind: "service", serviceType: "car_polishing", expectedPortal: "service", label: "تلميع مركبات" },
  { orderKind: "gas_delivery", serviceType: "gas_delivery", expectedPortal: "service", label: "غاز" },
  { orderKind: "service", serviceType: "internal_delivery", expectedPortal: "driver", label: "توصيل داخلي" },
  { orderKind: "restaurant", serviceType: null, expectedPortal: "driver", label: "طلب جاهز للتوصيل", viaDispatch: true },
  { orderKind: "service", serviceType: "pickup_truck", expectedPortal: "transport", label: "سطحة" },
  { orderKind: "service", serviceType: "car_transport", expectedPortal: "transport", label: "نقل مركبة" },
  { orderKind: "service", serviceType: "vehicle_transfer", expectedPortal: "transport", label: "نقل مركبة" },
  { orderKind: "service", serviceType: "furniture_move", expectedPortal: "transport", label: "نقل أثاث" },
];

const PROVIDER_ROUTING_TABLE = [
  { role: "service", serviceType: "plumber", expectedPortal: "service" },
  { role: "service", serviceType: "gas_cylinder_swap", expectedPortal: "service" },
  { role: "service", serviceType: "car_polishing", expectedPortal: "service" },
  { role: "service", serviceType: "gas_delivery", expectedPortal: "service" },
  { role: "service", serviceType: "pickup_truck", expectedPortal: "transport" },
  { role: "service", serviceType: "internal_delivery", expectedPortal: "driver" },
  { role: "driver", serviceType: null, expectedPortal: "driver" },
  { role: "store", serviceType: null, expectedPortal: "merchant" },
];

function buildOrderRow(kind, serviceType, extra) {
  const row = { order_type: kind };
  if (serviceType) row.service_type = serviceType;
  if (extra) Object.assign(row, extra);
  return row;
}

function validateOrderRouting() {
  const rows = [];
  for (const spec of FINAL_ROUTING_TABLE) {
    const order =
      spec.viaDispatch
        ? buildOrderRow(spec.orderKind, spec.serviceType, { store_id: "s-demo" })
        : buildOrderRow(spec.orderKind, spec.serviceType);
    const portalType = resolveOrderPortalType(order);
    const visibleInExpected = orderVisibleInPortal(order, spec.expectedPortal);
    const pass =
      spec.viaDispatch
        ? spec.expectedPortal === "driver" && isDriverDispatchOrder(order) && visibleInExpected
        : portalType === spec.expectedPortal && visibleInExpected;
    rows.push({
      label: spec.label,
      order_type: spec.orderKind,
      service_type: spec.serviceType,
      expected_portal: spec.expectedPortal,
      resolved_portal_type: portalType,
      visible_in_portal: visibleInExpected,
      pass,
    });
  }
  return rows;
}

function validateProviderRouting() {
  return PROVIDER_ROUTING_TABLE.map((spec) => {
    const resolved = resolvePortalRole({ role: spec.role, service_type: spec.serviceType });
    const pass = resolved.portalRole === spec.expectedPortal;
    return {
      role: spec.role,
      service_type: spec.serviceType,
      expected_portal: spec.expectedPortal,
      resolved_portal: resolved.portalRole,
      pass,
    };
  });
}

function validateTransportExclusions() {
  const removedFromTransport = ["internal_delivery", "gas_delivery", "gas_cylinder_swap", "gas_central_refill", "car_polishing"];
  return removedFromTransport.map((t) => ({
    service_type: t,
    is_transport: isTransportPortalType(t),
    is_service: isServicePortalType(t),
    is_driver: isDriverPortalType(t),
    pass: !isTransportPortalType(t),
  }));
}

function validateTaxonomySets() {
  return {
    order_portal_types: ORDER_PORTAL_TYPES,
    service_portal_types: [...SERVICE_PORTAL_TYPES].sort(),
    transport_portal_types: [...TRANSPORT_PORTAL_TYPES].sort(),
    driver_portal_types: [...DRIVER_PORTAL_TYPES].sort(),
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const orderRows = validateOrderRouting();
  const providerRows = validateProviderRouting();
  const transportExclusions = validateTransportExclusions();
  const taxonomy = validateTaxonomySets();

  const allPass =
    orderRows.every((r) => r.pass) &&
    providerRows.every((r) => r.pass) &&
    transportExclusions.every((r) => r.pass);

  const report = {
    generated_at: generatedAt,
    freeze: "G1-R Final Portal Role Classification",
    status: allPass ? "PASS" : "FAIL",
    summary: {
      order_routing_pass: orderRows.filter((r) => r.pass).length,
      order_routing_total: orderRows.length,
      provider_routing_pass: providerRows.filter((r) => r.pass).length,
      provider_routing_total: providerRows.length,
      transport_exclusions_pass: transportExclusions.filter((r) => r.pass).length,
      transport_exclusions_total: transportExclusions.length,
    },
    taxonomy,
    order_routing: orderRows,
    provider_routing: providerRows,
    transport_exclusions: transportExclusions,
    decisions: {
      gas_portal: "service",
      internal_delivery_portal: "driver",
      transport_portal_scope: "pickup_truck, car_transport, vehicle_transfer, furniture_move only",
    },
  };

  const root = path.join(__dirname, "..");
  const jsonPath = path.join(root, "data", "routing-validation-report.json");
  const mdPath = path.join(root, "docs", "ROUTING-VALIDATION-REPORT.md");

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const md = [
    "# ERVENOW — Routing Validation Report (G1-R Final)",
    "",
    `Generated: ${generatedAt}`,
    "",
    `**Status: ${report.status}**`,
    "",
    "## Summary",
    "",
    `- Order routing: ${report.summary.order_routing_pass}/${report.summary.order_routing_total}`,
    `- Provider routing: ${report.summary.provider_routing_pass}/${report.summary.provider_routing_total}`,
    `- Transport exclusions: ${report.summary.transport_exclusions_pass}/${report.summary.transport_exclusions_total}`,
    "",
    "## Final Decisions",
    "",
    "| Item | Portal |",
    "|------|--------|",
    "| Gas (غاز) | **Service** |",
    "| Internal delivery (توصيل داخلي) | **Driver** |",
    "| Transport | سطحة · نقل مركبات · نقل أثاث فقط |",
    "",
    "## Order Routing Matrix",
    "",
    "| Label | order_type | service_type | Expected | Resolved | Visible | Pass |",
    "|-------|------------|--------------|----------|----------|---------|------|",
    ...orderRows.map(
      (r) =>
        `| ${r.label} | ${r.order_type} | ${r.service_type || "—"} | ${r.expected_portal} | ${r.resolved_portal_type} | ${r.visible_in_portal} | ${r.pass ? "✓" : "✗"} |`
    ),
    "",
    "## Provider Account Routing",
    "",
    "| role | service_type | Expected | Resolved | Pass |",
    "|------|--------------|----------|----------|------|",
    ...providerRows.map(
      (r) => `| ${r.role} | ${r.service_type || "—"} | ${r.expected_portal} | ${r.resolved_portal} | ${r.pass ? "✓" : "✗"} |`
    ),
    "",
    "## Removed from Transport Portal",
    "",
    ...transportExclusions.map(
      (r) =>
        `- \`${r.service_type}\`: transport=${r.is_transport}, service=${r.is_service}, driver=${r.is_driver} → ${r.pass ? "OK" : "FAIL"}`
    ),
    "",
    "## Taxonomy Sets",
    "",
    "```json",
    JSON.stringify(taxonomy, null, 2),
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(mdPath, md, "utf8");

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  ERVENOW — Routing Validation Report (G1-R Final)");
  console.log("══════════════════════════════════════════════════════\n");
  console.log("Status:", report.status);
  console.log("JSON:", jsonPath);
  console.log("MD:  ", mdPath);
  console.log("\nOrder routing:", `${report.summary.order_routing_pass}/${report.summary.order_routing_total}`);
  console.log("Provider routing:", `${report.summary.provider_routing_pass}/${report.summary.provider_routing_total}`);
  console.log("Transport exclusions:", `${report.summary.transport_exclusions_pass}/${report.summary.transport_exclusions_total}`);
  console.log("\n══════════════════════════════════════════════════════\n");

  if (!allPass) process.exit(1);
}

main();
