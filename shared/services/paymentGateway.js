/**
 * بوابة الدفع — Moyasar (إنتاج) أو mock (تطوير).
 */

const { logger } = require("../utils/logger");

const MOYASAR_API = "https://api.moyasar.com/v1";

function gatewayMode() {
  const forced = String(process.env.PAYMENT_GATEWAY || "").trim().toLowerCase();
  if (forced === "mock") return "mock";
  if (forced === "moyasar") return "moyasar";
  if (process.env.MOYASAR_SECRET_KEY) return "moyasar";
  return "mock";
}

function moyasarAuthHeader() {
  const key = String(process.env.MOYASAR_SECRET_KEY || "").trim();
  if (!key) return null;
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

function toHalalas(amountSar) {
  const n = Number(amountSar);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/**
 * @param {object} payload
 */
async function moyasarRequest(path, payload) {
  const auth = moyasarAuthHeader();
  if (!auth) throw new Error("MOYASAR_SECRET_KEY missing");

  const res = await fetch(MOYASAR_API + path, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || body.type || res.statusText || "moyasar_error";
    const err = new Error(String(msg));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * @param {string} paymentId
 */
async function fetchMoyasarPayment(paymentId) {
  const auth = moyasarAuthHeader();
  if (!auth) throw new Error("MOYASAR_SECRET_KEY missing");
  const id = String(paymentId || "").trim();
  const res = await fetch(`${MOYASAR_API}/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: auth },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || "fetch_payment_failed");
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * @param {string} invoiceId
 */
async function fetchMoyasarInvoice(invoiceId) {
  const auth = moyasarAuthHeader();
  if (!auth) throw new Error("MOYASAR_SECRET_KEY missing");
  const id = String(invoiceId || "").trim();
  const res = await fetch(`${MOYASAR_API}/invoices/${encodeURIComponent(id)}`, {
    headers: { Authorization: auth },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || "fetch_invoice_failed");
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * @param {{ sessionId: string, amountSar: number, description: string, callbackUrl: string, metadata?: object }} opts
 */
async function createMoyasarCheckout(opts) {
  const amount = toHalalas(opts.amountSar);
  const callbackUrl = String(opts.callbackUrl || "").trim();
  const metadata = {
    session_id: opts.sessionId,
    user_id: opts.metadata?.user_id || null,
    pay_type: opts.metadata?.pay_type || "debt",
    ...(opts.metadata || {}),
  };

  const invoice = await moyasarRequest("/invoices", {
    amount,
    currency: "SAR",
    description: String(opts.description || "سداد مستحقات ERVENOW").slice(0, 200),
    callback_url: callbackUrl,
    success_url: callbackUrl,
    metadata,
  });

  return {
    gateway: "moyasar",
    gateway_invoice_id: invoice.id,
    gateway_payment_id: invoice.id,
    checkout_url: invoice.url,
    raw: invoice,
  };
}

/**
 * @param {{ sessionId: string, amountSar: number, callbackUrl: string, metadata?: object }} opts
 */
function createMockCheckout(opts) {
  const base = String(process.env.ERVENOW_PUBLIC_URL || "http://localhost:4000").replace(/\/$/, "");
  const sessionId = opts.sessionId;
  const checkout_url =
    `${base}/pay?uid=${encodeURIComponent(opts.metadata?.user_id || "")}` +
    `&amount=${encodeURIComponent(Number(opts.amountSar).toFixed(2))}` +
    `&type=debt&mock_session=${encodeURIComponent(sessionId)}`;

  return {
    gateway: "mock",
    gateway_invoice_id: `mock_inv_${sessionId}`,
    gateway_payment_id: `mock_pay_${sessionId}`,
    checkout_url,
    raw: { mock: true },
  };
}

/**
 * @param {{ sessionId: string, amountSar: number, description: string, callbackUrl: string, metadata?: object }} opts
 */
async function createPaymentCheckoutSession(opts) {
  const mode = gatewayMode();
  if (mode === "moyasar") {
    try {
      return await createMoyasarCheckout(opts);
    } catch (e) {
      logger.error({ err: e.message, status: e.status }, "[payment_gateway] moyasar create failed");
      throw e;
    }
  }
  return createMockCheckout(opts);
}

/**
 * استخراج معرّف الدفع من webhook Moyasar.
 */
function parseWebhookGatewayId(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.id) return String(b.id);
  if (b.data && b.data.id) return String(b.data.id);
  if (b.invoice && b.invoice.id) return String(b.invoice.id);
  return null;
}

/**
 * @param {object} body — جسم webhook
 * @returns {Promise<{ paid: boolean, gateway_payment_id: string, amount_sar: number, metadata: object, raw: object }>}
 */
async function verifyWebhookPayment(body) {
  const gatewayId = parseWebhookGatewayId(body);
  if (!gatewayId) {
    return { paid: false, reason: "missing_gateway_id" };
  }

  const mode = gatewayMode();
  if (mode === "mock") {
    const status = String(body.status || body.data?.status || "").toLowerCase();
    const paid = status === "paid" || body.paid === true || body.type === "payment_paid";
    const amountHalalas = Number(body.amount) || 0;
    return {
      paid,
      gateway_payment_id: gatewayId,
      amount_sar: amountHalalas > 0 ? amountHalalas / 100 : Number(body.amount_sar) || 0,
      metadata: body.metadata || {},
      raw: body,
    };
  }

  let remote = null;
  try {
    if (String(body.object || "").toLowerCase() === "invoice" || body.url) {
      remote = await fetchMoyasarInvoice(gatewayId);
    } else {
      remote = await fetchMoyasarPayment(gatewayId);
    }
  } catch (e) {
    try {
      remote = await fetchMoyasarInvoice(gatewayId);
    } catch (_) {
      logger.warn({ err: e.message, gatewayId }, "[payment_gateway] verify fetch failed");
      return { paid: false, reason: "verify_failed" };
    }
  }

  const status = String(remote.status || "").toLowerCase();
  const paid = status === "paid";
  const amountHalalas = Number(remote.amount) || 0;

  return {
    paid,
    gateway_payment_id: String(remote.id || gatewayId),
    amount_sar: amountHalalas / 100,
    metadata: remote.metadata || {},
    raw: remote,
  };
}

module.exports = {
  gatewayMode,
  createPaymentCheckoutSession,
  verifyWebhookPayment,
  fetchMoyasarPayment,
  toHalalas,
};
