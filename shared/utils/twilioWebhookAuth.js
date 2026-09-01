/**
 * تحقق توقيع Twilio لـ WhatsApp webhook — لا تُنفَّذ منطق الأعمال قبل نجاحه.
 */

const crypto = require("crypto");

const REPLAY_TTL_MS = 10 * 60 * 1000;
const replaySeen = new Map();

function pruneReplay(now) {
  if (replaySeen.size < 200) return;
  for (const [k, exp] of replaySeen) {
    if (exp < now) replaySeen.delete(k);
  }
}

function twilioAuthToken() {
  return String(process.env.TWILIO_AUTH_TOKEN || "").trim();
}

function webhookPublicUrl(req) {
  const explicit = String(process.env.TWILIO_WEBHOOK_URL || "").trim();
  if (explicit) return explicit;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const path = String(req.originalUrl || req.url || "/api/whatsapp/webhook");
  if (!host) return "";
  return `${proto}://${host}${path}`;
}

function twilioSignatureHeader(req) {
  return String(req.headers["x-twilio-signature"] || req.headers["X-Twilio-Signature"] || "").trim();
}

function computeTwilioSignature(authToken, url, params) {
  const data = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] == null ? "" : params[key]), String(url || ""));
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

function signaturesMatch(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(x, "utf8"), Buffer.from(y, "utf8"));
  } catch (_e) {
    return false;
  }
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
function verifyTwilioWebhook(req) {
  const token = twilioAuthToken();
  if (!token) {
    return { ok: false, status: 503, reason: "twilio_not_configured" };
  }
  const signature = twilioSignatureHeader(req);
  if (!signature) {
    return { ok: false, status: 403, reason: "missing_signature" };
  }
  const url = webhookPublicUrl(req);
  if (!url) {
    return { ok: false, status: 503, reason: "webhook_url_missing" };
  }
  const params = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const expected = computeTwilioSignature(token, url, params);
  if (!signaturesMatch(signature, expected)) {
    return { ok: false, status: 403, reason: "invalid_signature" };
  }

  const messageSid = String(params.MessageSid || params.SmsSid || "").trim();
  if (messageSid) {
    const now = Date.now();
    pruneReplay(now);
    const prev = replaySeen.get(messageSid);
    if (prev && prev > now) {
      return { ok: false, status: 409, reason: "replay" };
    }
    replaySeen.set(messageSid, now + REPLAY_TTL_MS);
  }

  return { ok: true };
}

function resetTwilioReplayForTests() {
  replaySeen.clear();
}

module.exports = {
  REPLAY_TTL_MS,
  twilioAuthToken,
  webhookPublicUrl,
  computeTwilioSignature,
  verifyTwilioWebhook,
  resetTwilioReplayForTests,
};
