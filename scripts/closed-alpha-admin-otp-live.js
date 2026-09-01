#!/usr/bin/env node
/**
 * Closed Alpha — live Admin OTP login only.
 * Uses Twilio Messages API (official) to read the OTP that was sent.
 * Does not mint JWTs, does not bypass OTP, does not print secrets.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
try {
  const dns = require("dns");
  if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("ipv4first");
} catch (_e) {}

const BASE = String(process.env.GATE_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const ADMIN_PHONE = "0505745650";
const CUSTOMER_PHONE = "966559010021";
const OUT = path.join(__dirname, "..", "data", "closed-alpha-admin-otp-live.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function http(method, urlPath, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let payload;
  if (body != null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + urlPath, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { status: 0, json: null, error: e && e.message };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }
  return { status: res.status, json, error: json && (json.error || json.message) };
}

function twilioAuthHeader() {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token) return null;
  return {
    sid,
    header: "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
  };
}

function arabicIndicToAscii(s) {
  return String(s || "").replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
}

function extractOtpFromText(raw) {
  const body = arabicIndicToAscii(raw);
  const m = body.match(/\b(\d{5,6})\b/);
  return m ? m[1] : null;
}

function extractOtpFromMessage(m) {
  const fromBody = extractOtpFromText(m && m.body);
  if (fromBody) return { code: fromBody, source: "body" };
  const varsRaw = m && (m.contentVariables || m.content_variables);
  if (varsRaw) {
    let vars = varsRaw;
    if (typeof vars === "string") {
      try {
        vars = JSON.parse(vars);
      } catch (_e) {
        const fromStr = extractOtpFromText(varsRaw);
        if (fromStr) return { code: fromStr, source: "content_variables_string" };
        vars = null;
      }
    }
    if (vars && typeof vars === "object") {
      for (const v of Object.values(vars)) {
        const c = extractOtpFromText(String(v));
        if (c) return { code: c, source: "content_variables" };
      }
    }
  }
  return null;
}

function toDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function messageMatchesPhone(m, phoneDigits) {
  const want = toDigits(phoneDigits).replace(/^0/, "966");
  const got = toDigits(m && m.to);
  return got === want || got.endsWith(want) || want.endsWith(got);
}

function summarizeMessage(m) {
  const body = String((m && m.body) || "");
  return {
    sid_prefix: String((m && m.sid) || "").slice(0, 4),
    status: m && m.status,
    direction: m && m.direction,
    error_code: (m && (m.error_code || m.errorCode)) || null,
    body_len: body.length,
    has_content_sid: Boolean(m && (m.contentSid || m.content_sid)),
    has_content_vars: Boolean(m && (m.contentVariables || m.content_variables)),
    to_last4: toDigits(m && m.to).slice(-4),
    date_created: m && m.date_created,
  };
}

async function twilioListMessages(qs) {
  const auth = twilioAuthHeader();
  if (!auth) return { ok: false, reason: "twilio_env_missing", messages: [] };
  const url =
    "https://api.twilio.com/2010-04-01/Accounts/" +
    encodeURIComponent(auth.sid) +
    "/Messages.json?" +
    qs;
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth.header },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, reason: "twilio_list_http_" + res.status, messages: [] };
    const data = await res.json();
    return { ok: true, messages: Array.isArray(data.messages) ? data.messages : [] };
  } catch (e) {
    return { ok: false, reason: "twilio_list_fetch_failed", messages: [], error: String(e && e.message) };
  }
}

async function twilioFetchMessage(sid) {
  const auth = twilioAuthHeader();
  if (!auth || !sid) return null;
  const url =
    "https://api.twilio.com/2010-04-01/Accounts/" +
    encodeURIComponent(auth.sid) +
    "/Messages/" +
    encodeURIComponent(sid) +
    ".json";
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth.header },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (_e) {
    return null;
  }
}

async function fetchTwilioOtp(phoneDigits, { sinceMs, attempts } = {}) {
  const want = toDigits(phoneDigits).replace(/^0/, "966");
  const e164 = "+" + want;
  const toFilters = ["whatsapp:" + e164, e164, want];
  const meta = [];
  let lastN = 0;
  const nAttempts = attempts || 8;
  for (let i = 0; i < nAttempts; i++) {
    if (i > 0) await sleep(1500);
    const batches = [];
    for (const to of toFilters) {
      batches.push(await twilioListMessages("PageSize=20&To=" + encodeURIComponent(to)));
    }
    batches.push(await twilioListMessages("PageSize=20"));
    const seen = new Set();
    const all = [];
    for (const b of batches) {
      for (const m of b.messages || []) {
        const sid = String(m.sid || "");
        if (!sid || seen.has(sid)) continue;
        seen.add(sid);
        all.push(m);
      }
    }
    lastN = all.length;
    const candidates = all.filter((m) => messageMatchesPhone(m, want));
    candidates.sort((a, b) => String(b.date_created || "").localeCompare(String(a.date_created || "")));
    for (const m of candidates) {
      const created = Date.parse(m.date_created || m.date_sent || "") || 0;
      if (sinceMs && created && created + 15000 < sinceMs) continue;
      let extracted = extractOtpFromMessage(m);
      if (!extracted && (!m.body || String(m.body).length < 4)) {
        const full = await twilioFetchMessage(m.sid);
        if (full) extracted = extractOtpFromMessage(full);
        meta.push({ via: "sid_fetch", summary: summarizeMessage(full || m), extracted: Boolean(extracted) });
      } else {
        meta.push({ via: "list", summary: summarizeMessage(m), extracted: Boolean(extracted) });
      }
      if (extracted) {
        return {
          ok: true,
          code: extracted.code,
          source: extracted.source,
          attempt: i + 1,
          twilio_status: m.status || null,
          twilio_error_code: m.error_code || m.errorCode || null,
          meta,
        };
      }
    }
    if (candidates.length === 0 && all.length) {
      meta.push({
        via: "no_to_match",
        n: all.length,
        to_last4s: all.slice(0, 8).map((m) => toDigits(m.to).slice(-4)),
      });
    }
  }
  return { ok: false, reason: "no_otp_in_recent_messages", n: lastN, meta };
}

async function probeAdmin(token) {
  const paths = {
    settings: "/api/admin/settings",
    orders: "/api/admin/orders",
    users: "/api/admin/customers",
    drivers: "/api/admin/drivers",
    finance: "/api/admin/finance-summary",
  };
  const out = {};
  for (const [name, p] of Object.entries(paths)) {
    const r = await http("GET", p, token ? { token } : {});
    out[name] = r.status;
  }
  return out;
}

async function main() {
  const result = {
    generated_at: new Date().toISOString(),
    base: BASE,
    allow_dev_otp: String(process.env.ALLOW_DEV_OTP || ""),
    twilio_sid_set: Boolean(process.env.TWILIO_ACCOUNT_SID),
    twilio_token_set: Boolean(process.env.TWILIO_AUTH_TOKEN),
    twilio_from_set: Boolean(process.env.TWILIO_WHATSAPP_NUMBER),
    jwt_minted: false,
    otp_bypass: false,
  };

  const health = await http("GET", "/api/core/health");
  result.health = health.status;
  if (health.status !== 200) {
    result.ok = false;
    result.reason = "server_not_healthy";
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: false, reason: result.reason, health: health.status }));
    process.exit(1);
  }

  let sinceMs = Date.now();
  const send = await http("POST", "/api/core/send-otp", {
    body: { phone: ADMIN_PHONE, role: "admin", login_only: true },
  });
  result.send_otp = {
    status: send.status,
    ok: Boolean(send.json && (send.json.ok === true || send.json.sent === true)),
    error: send.json && send.json.error ? send.json.error : null,
  };
  const cooldownReuse = send.status === 429;
  if (send.status !== 200 && !cooldownReuse) {
    result.ok = false;
    result.reason = "send_otp_failed";
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: false, reason: result.reason, send: result.send_otp }));
    process.exit(1);
  }
  if (cooldownReuse) {
    sinceMs = Date.now() - 4 * 60 * 1000;
    result.send_otp.reused_active_challenge = true;
  }

  const fetched = await fetchTwilioOtp(ADMIN_PHONE, { sinceMs, attempts: cooldownReuse ? 4 : 10 });
  result.twilio_fetch = {
    ok: fetched.ok,
    reason: fetched.reason || null,
    source: fetched.source || null,
    attempt: fetched.attempt || null,
    twilio_status: fetched.twilio_status || null,
    twilio_error_code: fetched.twilio_error_code || null,
    n: fetched.n != null ? fetched.n : null,
    meta: fetched.meta || [],
  };
  if (!fetched.ok) {
    result.ok = false;
    result.reason = "otp_not_in_twilio_messages";
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: false, reason: result.reason, twilio_fetch: result.twilio_fetch }));
    process.exit(1);
  }

  const verify = await http("POST", "/api/core/verify-otp", {
    body: { phone: ADMIN_PHONE, code: fetched.code, role: "admin", login_only: true },
  });
  const token = verify.json && (verify.json.token || verify.json.access_token);
  const role = verify.json && (verify.json.user && verify.json.user.role || verify.json.role);
  result.verify_otp = {
    status: verify.status,
    has_token: Boolean(token),
    role: role || null,
    error: verify.error || null,
  };
  if (verify.status !== 200 || !token) {
    result.ok = false;
    result.reason = "verify_otp_failed";
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: false, reason: result.reason, verify: result.verify_otp }));
    process.exit(1);
  }

  result.admin_surfaces = await probeAdmin(token);
  result.anonymous_surfaces = await probeAdmin(null);

  let customerToken = null;
  const custSend = await http("POST", "/api/core/send-otp", {
    body: { phone: CUSTOMER_PHONE, role: "customer", login_only: true },
  });
  result.customer_send_otp = { status: custSend.status, ok: Boolean(custSend.json && custSend.json.ok) };
  if (result.customer_send_otp.ok) {
    const custFetched = await fetchTwilioOtp(CUSTOMER_PHONE, { sinceMs: Date.now(), attempts: 8 });
    result.customer_twilio_fetch = { ok: custFetched.ok, source: custFetched.source || null, reason: custFetched.reason || null };
    if (custFetched.ok) {
      const custVerify = await http("POST", "/api/core/verify-otp", {
        body: { phone: CUSTOMER_PHONE, code: custFetched.code, role: "customer", login_only: true },
      });
      customerToken = custVerify.json && (custVerify.json.token || custVerify.json.access_token);
      result.customer_verify_otp = { status: custVerify.status, has_token: Boolean(customerToken) };
    }
  }
  result.non_admin_surfaces = customerToken ? await probeAdmin(customerToken) : null;

  const adminOk = Object.values(result.admin_surfaces).every((s) => s === 200);
  const anonOk = Object.values(result.anonymous_surfaces).every((s) => s === 401);
  const nonAdminOk =
    result.non_admin_surfaces && Object.values(result.non_admin_surfaces).every((s) => s === 403);

  result.ok = adminOk && anonOk && Boolean(token) && result.verify_otp.status === 200;
  result.rbac = {
    admin_all_200: adminOk,
    anonymous_all_401: anonOk,
    non_admin_all_403: Boolean(nonAdminOk),
    non_admin_available: Boolean(customerToken),
  };
  result.session_source = "verify-otp";
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      ok: result.ok,
      send_otp: result.send_otp.status,
      twilio_source: result.twilio_fetch.source,
      verify_otp: result.verify_otp.status,
      has_token: result.verify_otp.has_token,
      role: result.verify_otp.role,
      admin_surfaces: result.admin_surfaces,
      anonymous_surfaces: result.anonymous_surfaces,
      non_admin_surfaces: result.non_admin_surfaces,
      rbac: result.rbac,
    })
  );
  process.exit(result.ok && anonOk && adminOk ? 0 : 1);
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, reason: "script_error", error: String(e && e.message) }));
  process.exit(1);
});
