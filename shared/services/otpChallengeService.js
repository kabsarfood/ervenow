/**
 * OTP موحّد — وضعان:
 * - memory: Map في الذاكرة (افتراضي — توافق مع البيئات الحالية)
 * - supabase: جدول public.ervenow_otp_challenges (إنتاج متعدد النسخ)
 *
 * Env:
 *   ERVENOW_OTP_BACKEND=memory|supabase  (افتراضي memory)
 *   ERVENOW_OTP_PEPPER=...              (موصى به عند supabase؛ يُفضّل 32+ حرفاً)
 *   ERVENOW_OTP_RESEND_COOLDOWN_MS      (افتراضي 45000)
 *   ERVENOW_OTP_LOCK_MS                 (افتراضي 300000 بعد تجاوز max attempts)
 */

const crypto = require("crypto");

const OTP_SCOPE = {
  CORE_LOGIN: "core_login",
  DRIVER_LOGIN: "driver_login",
  WALLET_WITHDRAW: "wallet_withdraw",
};

const memoryStore = new Map();

function otpBackendMode() {
  const v = String(process.env.ERVENOW_OTP_BACKEND || "memory")
    .trim()
    .toLowerCase();
  return v === "supabase" ? "supabase" : "memory";
}

function resendCooldownMs() {
  const n = Number(process.env.ERVENOW_OTP_RESEND_COOLDOWN_MS || 45000);
  return Number.isFinite(n) && n >= 5000 ? Math.min(n, 300000) : 45000;
}

function lockDurationMs() {
  const n = Number(process.env.ERVENOW_OTP_LOCK_MS || 300000);
  return Number.isFinite(n) && n >= 60000 ? Math.min(n, 3600000) : 300000;
}

function getOtpPepper() {
  const p = String(process.env.ERVENOW_OTP_PEPPER || "").trim();
  if (p.length >= 16) return p;
  const jwt = String(process.env.ERVENOW_JWT_SECRET || process.env.ERWENOW_JWT_SECRET || "").trim();
  if (p.length > 0 && p.length < 16) {
    throw new Error("ERVENOW_OTP_PEPPER قصير جداً — يجب 16 حرفاً على الأقل");
  }
  if (jwt.length >= 16) {
    if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
      console.warn(
        "[otp] ERVENOW_OTP_PEPPER غير معيّن — يُستخدم اشتقاق من ERVENOW_JWT_SECRET (يفضّل فصل المفتاح في الإنتاج)"
      );
    }
    return `${jwt}:ervenow:otp-pepper:v1`;
  }
  throw new Error("ERVENOW_OTP_PEPPER أو ERVENOW_JWT_SECRET (16+ حرف) مطلوب لتخزين OTP في Supabase");
}

function hashCode(scope, subjectKey, code) {
  const pepper = getOtpPepper();
  return crypto.createHash("sha256").update(`${pepper}|${scope}|${subjectKey}|${code}`, "utf8").digest("hex");
}

function memoryKey(scope, subjectKey) {
  return `${scope}::${subjectKey}`;
}

/**
 * بدء تحدي OTP (إرسال رمز جديد).
 * @param {object} opts
 * @param {import("@supabase/supabase-js").SupabaseClient|null} opts.sb
 * @param {'memory'|'supabase'} opts.mode
 * @param {string} opts.scope
 * @param {string} opts.subjectKey
 * @param {string} opts.code
 * @param {number} opts.ttlMs
 * @param {string} [opts.ip]
 * @param {object} [opts.metadata]
 * @returns {Promise<{ ok: true } | { ok: false, error: string, cooldownSeconds?: number }>}
 */
async function startOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const code = String(opts.code || "").trim();
  const ttlMs = Number(opts.ttlMs) || 5 * 60 * 1000;
  const mode = opts.mode === "supabase" ? "supabase" : "memory";
  const ip = opts.ip != null ? String(opts.ip).slice(0, 128) : null;
  const metadata =
    opts.metadata && typeof opts.metadata === "object"
      ? opts.metadata
      : opts.extras && typeof opts.extras === "object"
        ? opts.extras
        : {};

  if (!scope || !subjectKey || !code) {
    return { ok: false, error: "scope/subject/code مطلوبة" };
  }

  if (mode === "memory") {
    const k = memoryKey(scope, subjectKey);
    const now = Date.now();
    const prev = memoryStore.get(k);
    const cd = resendCooldownMs();
    if (prev && prev.lastSentAt && now - prev.lastSentAt < cd) {
      const remain = Math.ceil((cd - (now - prev.lastSentAt)) / 1000);
      return { ok: false, error: `انتظر ${remain} ثانية قبل إعادة إرسال الرمز`, cooldownSeconds: remain };
    }
    const extras = opts.extras && typeof opts.extras === "object" ? opts.extras : {};
    memoryStore.set(k, {
      code,
      expiresAt: now + ttlMs,
      attempts: 0,
      lastSentAt: now,
      resendCount: prev ? (prev.resendCount || 0) + 1 : 0,
      lockUntil: 0,
      extras,
    });
    return { ok: true };
  }

  const sb = opts.sb;
  if (!sb) return { ok: false, error: "Supabase client مطلوب لـ OTP supabase" };

  try {
    getOtpPepper();
  } catch (e) {
    return { ok: false, error: e.message || "OTP pepper missing" };
  }

  const cd = resendCooldownMs();
  const nowIso = new Date().toISOString();
  const { data: lastRows, error: selErr } = await sb
    .from("ervenow_otp_challenges")
    .select("last_sent_at, locked_until, resend_count")
    .eq("scope", scope)
    .eq("subject_key", subjectKey)
    .order("created_at", { ascending: false })
    .limit(1);
  if (selErr && !/does not exist|schema cache|relation/i.test(String(selErr.message || ""))) {
    return { ok: false, error: selErr.message };
  }
  const last = lastRows && lastRows[0];
  if (last && last.locked_until) {
    const lu = new Date(last.locked_until).getTime();
    if (lu > Date.now()) {
      const remain = Math.ceil((lu - Date.now()) / 1000);
      return { ok: false, error: `محاولات كثيرة — حاول بعد ${remain} ثانية`, cooldownSeconds: remain };
    }
  }
  if (last && last.last_sent_at) {
    const delta = Date.now() - new Date(last.last_sent_at).getTime();
    if (delta >= 0 && delta < cd) {
      const remain = Math.ceil((cd - delta) / 1000);
      return { ok: false, error: `انتظر ${remain} ثانية قبل إعادة إرسال الرمز`, cooldownSeconds: remain };
    }
  }

  await sb.from("ervenow_otp_challenges").delete().eq("scope", scope).eq("subject_key", subjectKey);

  const codeHash = hashCode(scope, subjectKey, code);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const prevResend = last && last.resend_count != null ? Number(last.resend_count) : 0;
  const { error: insErr } = await sb.from("ervenow_otp_challenges").insert({
    scope,
    subject_key: subjectKey,
    code_hash: codeHash,
    attempts: 0,
    max_attempts: 5,
    resend_count: prevResend + 1,
    last_sent_at: nowIso,
    locked_until: null,
    expires_at: expiresAt,
    ip,
    metadata,
  });
  if (insErr) {
    if (/does not exist|schema cache|relation/i.test(String(insErr.message || ""))) {
      return {
        ok: false,
        error: "جدول ervenow_otp_challenges غير جاهز — نفّذ shared/migration_ervenow_otp_challenges.sql",
      };
    }
    return { ok: false, error: insErr.message };
  }
  return { ok: true };
}

/**
 * التحقق من الرمز واستهلاك التحدي عند النجاح.
 * @returns {Promise<{ ok: true } | { ok: false, error: string, attemptsRemaining?: number }>}
 */
async function verifyOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const code = String(opts.code || "").trim();
  const mode = opts.mode === "supabase" ? "supabase" : "memory";
  const sb = opts.sb;

  if (!scope || !subjectKey || !code) {
    return { ok: false, error: "scope/subject/code مطلوبة" };
  }

  if (mode === "memory") {
    const k = memoryKey(scope, subjectKey);
    const row = memoryStore.get(k);
    if (!row || !row.expiresAt || row.expiresAt <= Date.now()) {
      memoryStore.delete(k);
      return { ok: false, error: "رمز غير صحيح أو منتهي" };
    }
    if (row.lockUntil && row.lockUntil > Date.now()) {
      const remain = Math.ceil((row.lockUntil - Date.now()) / 1000);
      return { ok: false, error: `تم القفل مؤقتاً — حاول بعد ${remain} ثانية` };
    }
    if (row.code !== code) {
      row.attempts = Number(row.attempts || 0) + 1;
      const maxA = 5;
      if (row.attempts >= maxA) {
        row.lockUntil = Date.now() + lockDurationMs();
      }
      memoryStore.set(k, row);
      return {
        ok: false,
        error: "رمز غير صحيح أو منتهي",
        attemptsRemaining: Math.max(0, maxA - row.attempts),
      };
    }
    const extras = row.extras && typeof row.extras === "object" ? row.extras : {};
    memoryStore.delete(k);
    return { ok: true, metadata: extras };
  }

  if (!sb) return { ok: false, error: "Supabase client مطلوب" };

  try {
    getOtpPepper();
  } catch (e) {
    return { ok: false, error: e.message || "OTP pepper missing" };
  }

  const { data: rows, error: selErr } = await sb
    .from("ervenow_otp_challenges")
    .select("*")
    .eq("scope", scope)
    .eq("subject_key", subjectKey)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (selErr) {
    if (/does not exist|schema cache|relation/i.test(String(selErr.message || ""))) {
      return { ok: false, error: "جدول OTP غير جاهز — نفّذ migration_ervenow_otp_challenges.sql" };
    }
    return { ok: false, error: selErr.message };
  }
  const row = rows && rows[0];
  if (!row) {
    return { ok: false, error: "رمز غير صحيح أو منتهي" };
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const remain = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000);
    return { ok: false, error: `تم القفل مؤقتاً — حاول بعد ${remain} ثانية` };
  }

  const expected = hashCode(scope, subjectKey, code);
  if (expected !== row.code_hash) {
    const attempts = Number(row.attempts || 0) + 1;
    const maxA = Number(row.max_attempts || 5);
    const lockUntil =
      attempts >= maxA ? new Date(Date.now() + lockDurationMs()).toISOString() : row.locked_until;
    await sb
      .from("ervenow_otp_challenges")
      .update({ attempts, locked_until: lockUntil })
      .eq("id", row.id);
    return {
      ok: false,
      error: "رمز غير صحيح أو منتهي",
      attemptsRemaining: Math.max(0, maxA - attempts),
    };
  }

  const metaOut = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  await sb.from("ervenow_otp_challenges").delete().eq("id", row.id);
  return { ok: true, metadata: metaOut };
}

/**
 * إلغاء تحدي (مثلاً بعد فشل إرسال واتساب) حتى لا يبقى رمزاً «عالقاً».
 */
async function invalidateOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const mode = opts.mode === "supabase" ? "supabase" : "memory";
  const sb = opts.sb;
  if (!scope || !subjectKey) return;
  if (mode === "memory") {
    memoryStore.delete(memoryKey(scope, subjectKey));
    return;
  }
  if (!sb) return;
  await sb.from("ervenow_otp_challenges").delete().eq("scope", scope).eq("subject_key", subjectKey);
}

module.exports = {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
};
