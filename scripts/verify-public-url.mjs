/**
 * يتحقق أن ERVENOW_PUBLIC_URL معيّن وأن دوال الروابط لا تعتمد على localhost في الإنتاج.
 */
import "dotenv/config";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const pub = String(process.env.ERVENOW_PUBLIC_URL || "").trim().replace(/\/$/, "");
const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();

function check() {
  const issues = [];
  if (!pub.startsWith("http")) issues.push("ERVENOW_PUBLIC_URL missing or invalid");
  if (nodeEnv === "production" && /localhost|127\.0\.0\.1/i.test(pub)) {
    issues.push("production NODE_ENV but public URL is localhost");
  }

  const storeWa = require("../shared/messages/storeWhatsApp.js");
  const debt = require("../shared/utils/debtPaymentLink.js");
  const gas = require("../shared/services/gasDeliveryWhatsApp.js");

  const samples = {
    storeWhatsAppBase: typeof storeWa.buildStoreOrderLink === "function"
      ? "(fn exists)"
      : pub,
    debtLink: debt.buildDebtPaymentUrl ? debt.buildDebtPaymentUrl("test-id") : "(n/a)",
    gasBase: gas.getPublicBaseUrl ? gas.getPublicBaseUrl() : pub,
  };

  for (const [k, v] of Object.entries(samples)) {
    const s = String(v || "");
    if (nodeEnv === "production" && /localhost|127\.0\.0\.1/i.test(s)) {
      issues.push(`${k} still uses localhost default`);
    }
  }

  if (issues.length) {
    console.log("PUBLIC_URL_FAIL", { publicUrl: pub ? "set" : "missing", issues });
    process.exit(1);
  }
  console.log("PUBLIC_URL_OK", {
    publicUrl: pub,
    nodeEnv: nodeEnv || "(unset)",
    samplesMasked: Object.keys(samples),
  });
}

check();
