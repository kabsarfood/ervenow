/**
 * ERVENOW Launch Blockers — تحقق عملي (لا يطبع أسراراً).
 * تشغيل: node scripts/verify-launch-blockers.mjs
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function mask(v) {
  const s = String(v || "").trim();
  if (!s) return "(missing)";
  if (s.length <= 8) return "(set,len=" + s.length + ")";
  return s.slice(0, 4) + "…" + s.slice(-2) + " (len=" + s.length + ")";
}

function envPresent(name) {
  return String(process.env[name] || "").trim().length > 0;
}

async function checkMerchantRpc(pg) {
  const r = await pg.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ervenow_ledger_settle_delivered_order'
    LIMIT 1
  `);
  if (!r.rows.length) {
    return { ok: false, reason: "function ervenow_ledger_settle_delivered_order not found in DB" };
  }
  const def = String(r.rows[0].def || "");
  const hasHotfix =
    /amt_merchant\s*:=\s*0/i.test(def) &&
    !/ref_prefix\s*\|\|\s*':merchant'.*صافي تاجر/i.test(def) &&
    !/append_completed\s*\([^)]*':merchant'/i.test(def);
  const hasLegacyDeposit =
    /append_completed[\s\S]*?':merchant'/i.test(def) ||
    /ref_prefix\s*\|\|\s*':merchant'/i.test(def);
  if (hasLegacyDeposit && !hasHotfix) {
    return { ok: false, reason: "RPC still contains ledger merchant deposit (:merchant)" };
  }
  if (!/amt_merchant\s*:=\s*0/i.test(def)) {
    return { ok: false, reason: "RPC missing amt_merchant := 0 (hotfix pattern)" };
  }
  return { ok: true, reason: "RPC has amt_merchant:=0 and no :merchant append" };
}

async function checkLedgerRefs(pg) {
  const r = await pg.query(`
    SELECT reference_id, type, amount, created_at
    FROM public.ervenow_ledger_transactions
    WHERE status = 'completed'
      AND (
        reference_id LIKE 'order:%:merchant_net'
        OR reference_id LIKE 'order:%:earning'
        OR reference_id LIKE 'order:%:commission'
        OR reference_id LIKE 'order:%:merchant'
      )
    ORDER BY created_at DESC
    LIMIT 200
  `);
  const rows = r.rows || [];
  if (!rows.length) {
    return {
      ok: false,
      reason: "no completed ledger refs found — cannot prove dry-run (run one delivered order first)",
      sample: [],
    };
  }
  const byOrder = new Map();
  for (const row of rows) {
    const ref = String(row.reference_id || "");
    const m = ref.match(/^order:([^:]+):(merchant_net|earning|commission|merchant)$/);
    if (!m) continue;
    const oid = m[1];
    const kind = m[2];
    if (!byOrder.has(oid)) byOrder.set(oid, new Set());
    byOrder.get(oid).add(kind);
  }
  let duplicate = [];
  let good = null;
  for (const [oid, kinds] of byOrder) {
    if (kinds.has("merchant") && kinds.has("merchant_net")) {
      duplicate.push(oid);
    }
    if (
      kinds.has("merchant_net") &&
      kinds.has("earning") &&
      kinds.has("commission") &&
      !good
    ) {
      good = oid;
    }
  }
  if (duplicate.length) {
    return {
      ok: false,
      reason: "duplicate merchant deposit refs on order(s): " + duplicate.slice(0, 3).join(", "),
      sample: rows.slice(0, 5),
    };
  }
  if (!good) {
    return {
      ok: false,
      reason: "no order with merchant_net+earning+commission trio in recent 200 txs",
      sample: rows.slice(0, 8).map((x) => x.reference_id),
    };
  }
  return {
    ok: true,
    reason: "order " + good + " has merchant_net, earning, commission; no :merchant duplicate",
    orderId: good,
  };
}

async function pingRedis() {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return { ok: false, reason: "REDIS_URL missing" };
  try {
    const Redis = require("ioredis");
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 8000,
      lazyConnect: true,
    });
    await redis.connect();
    const pong = await redis.ping();
    await redis.quit();
    return { ok: pong === "PONG", reason: pong === "PONG" ? "PING ok" : "unexpected: " + pong };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

async function probeHealthFull(baseUrl) {
  const u = String(baseUrl || "").replace(/\/$/, "") + "/api/health/full";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(u, { signal: ac.signal });
    clearTimeout(t);
    const body = await res.json();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function main() {
  const results = {};

  // BLOCKER 2
  const fm = String(process.env.FINANCE_MODE || "ledger_only").trim().toLowerCase();
  results.financeMode = {
    verified: fm === "ledger_only",
    value: fm || "(unset, defaults ledger_only in code)",
  };

  // BLOCKER 3
  const { allowDevOtpBypass } = require("../shared/utils/devOtpBypass.js");
  const devFlag = allowDevOtpBypass();
  const nodeEnv = String(process.env.NODE_ENV || "").trim();
  results.devOtp = {
    verified:
      !devFlag &&
      (nodeEnv !== "production" || !envPresent("ALLOW_DEV_OTP") || !/^(1|true|yes)$/i.test(process.env.ALLOW_DEV_OTP)),
    allowDevOtp: devFlag,
    allowDevOtpRaw: mask(process.env.ALLOW_DEV_OTP),
    nodeEnv: nodeEnv || "(unset)",
    bypassCodeActive: false,
  };
  if (nodeEnv === "production" && devFlag) results.devOtp.verified = false;

  // BLOCKER 4
  const otpBackend = String(process.env.ERVENOW_OTP_BACKEND || "memory").trim().toLowerCase();
  const pepperOk = String(process.env.ERVENOW_OTP_PEPPER || "").trim().length >= 16;
  results.otpBackend = {
    verified: otpBackend === "supabase" && pepperOk,
    backend: otpBackend,
    pepper: pepperOk ? "set (16+)" : mask(process.env.ERVENOW_OTP_PEPPER),
  };

  // BLOCKER 5
  const twilioOk =
    envPresent("TWILIO_ACCOUNT_SID") &&
    envPresent("TWILIO_AUTH_TOKEN") &&
    (envPresent("TWILIO_WHATSAPP_NUMBER") || envPresent("TWILIO_WHATSAPP_FROM"));
  results.twilio = {
    verified: false,
    varsPresent: twilioOk,
    sid: mask(process.env.TWILIO_ACCOUNT_SID),
    token: mask(process.env.TWILIO_AUTH_TOKEN),
    whatsapp: mask(process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM),
    liveOtpTested: false,
    note: "vars check only — live OTP send not run from this script",
  };

  // BLOCKER 7
  const pubUrl = String(process.env.ERVENOW_PUBLIC_URL || "").trim();
  const cors = String(process.env.CORS_ORIGINS || "").trim();
  results.publicUrl = {
    verified: pubUrl.startsWith("http"),
    publicUrl: pubUrl || "(missing)",
    corsOrigins: cors ? cors.split(",").length + " origin(s)" : "(missing — may use ERVENOW_PUBLIC_URL only)",
  };

  // BLOCKER 6
  results.redis = await pingRedis();
  results.redis.workerScript = "npm run worker:delivery (separate process — not auto-detected)";

  // BLOCKER 1 & 8 — need DB
  const dbUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    results.merchantRpc = { verified: false, reason: "SUPABASE_DB_URL missing — cannot inspect RPC on Supabase" };
    results.liveTransaction = { verified: false, reason: "SUPABASE_DB_URL missing — cannot query ledger" };
  } else {
    const pg = new (require("pg").Client)({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await pg.connect();
      const rpc = await checkMerchantRpc(pg);
      results.merchantRpc = { verified: rpc.ok, ...rpc };

      const ledger = await checkLedgerRefs(pg);
      results.liveTransaction = { verified: ledger.ok, ...ledger };

      const otpTable = await pg.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'ervenow_otp_challenges'
        ) AS ok
      `);
      if (otpBackend === "supabase" && !otpTable.rows[0]?.ok) {
        results.otpBackend.verified = false;
        results.otpBackend.reason = "ERVENOW_OTP_BACKEND=supabase but table ervenow_otp_challenges missing";
      }
    } catch (e) {
      results.merchantRpc = { verified: false, reason: "DB error: " + (e.message || String(e)) };
      results.liveTransaction = { verified: false, reason: "DB error: " + (e.message || String(e)) };
    } finally {
      try {
        await pg.end();
      } catch (_) {}
    }
  }

  // Optional: health/full against local or public API
  const apiBase =
    String(process.env.ERVENOW_LAUNCH_VERIFY_API || process.env.ERVENOW_PUBLIC_URL || "http://127.0.0.1:4000").trim();
  const health = await probeHealthFull(apiBase);
  results.healthFull = health;
  if (health.ok && health.body?.services) {
    results.redis.healthFullRedis = health.body.services.redis;
    results.redis.verified =
      results.redis.ok === true &&
      (health.body.services.redis === "ok" || health.body.services.redis === "skipped");
  }

  // Twilio: optional API config probe
  if (twilioOk && health.ok) {
    try {
      const core = await fetch(apiBase.replace(/\/$/, "") + "/api/core/health");
      const cj = await core.json();
      results.twilio.coreHealth = cj;
    } catch (_) {}
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
