/**
 * OTP موحّد — تخزين مركزي:
 * - supabase (افتراضي للتشغيل): جدول public.ervenow_otp_challenges — hashed، restart-safe
 * - memory: للاختبارات فقط (Jest يضبط ERVENOW_OTP_BACKEND=memory)
 *
 * الإنتاج لا يعتمد على process memory.
 *
 * Env:
 *   ERVENOW_OTP_BACKEND=supabase|memory
 *   ERVENOW_OTP_ALLOW_MEMORY=1     (تجاوز صريح في غير الإنتاج)
 *   ERVENOW_OTP_PEPPER=...
 *   ERVENOW_OTP_RESEND_COOLDOWN_MS
 *   ERVENOW_OTP_LOCK_MS
 *   ERVENOW_OTP_MAX_ATTEMPTS       (افتراضي 5)
 *   ERVENOW_OTP_IP_MAX_PER_10MIN   (افتراضي 10)
 */

const crypto = require("crypto");

const OTP_SCOPE = {
  CORE_LOGIN: "core_login",
  DRIVER_LOGIN: "driver_login",
  WALLET_WITHDRAW: "wallet_withdraw",
};

const memoryStore = new Map();
const memoryIpHits = [];

function isProd() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function otpBackendMode() {
  const v = String(process.env.ERVENOW_OTP_BACKEND || "").trim().toLowerCase();
  if (v === "memory") {
    const allow = String(process.env.ERVENOW_OTP_ALLOW_MEMORY || "").trim() === "1";
    if (isProd() && !allow) return "supabase";
    return "memory";
  }
  if (v === "supabase" || v === "postgres" || v === "postgresql") return "supabase";
  if (v === "redis") return "supabase";
  return "supabase";
}

function resendCooldownMs() {
  const n = Number(process.env.ERVENOW_OTP_RESEND_COOLDOWN_MS || 45000);
  return Number.isFinite(n) && n >= 5000 ? Math.min(n, 300000) : 45000;
}

function lockDurationMs() {
  const n = Number(process.env.ERVENOW_OTP_LOCK_MS || 300000);
  return Number.isFinite(n) && n >= 60000 ? Math.min(n, 3600000) : 300000;
}

function maxAttempts() {
  const n = Number(process.env.ERVENOW_OTP_MAX_ATTEMPTS || 5);
  return Number.isFinite(n) && n >= 3 ? Math.min(n, 10) : 5;
}

function ipMaxPer10Min() {
  const n = Number(process.env.ERVENOW_OTP_IP_MAX_PER_10MIN || 10);
  return Number.isFinite(n) && n >= 3 ? Math.min(n, 60) : 10;
}

function getOtpPepper() {
  const p = String(process.env.ERVENOW_OTP_PEPPER || "").trim();
  if (p.length >= 16) return p;
  const jwt = String(process.env.ERVENOW_JWT_SECRET || process.env.ERWENOW_JWT_SECRET || "").trim();
  if (p.length > 0 && p.length < 16) {
    throw new Error("ERVENOW_OTP_PEPPER قصير جداً — يجب 16 حرفاً على الأقل");
  }
  if (jwt.length >= 16) {
    if (isProd()) {
      console.warn(
        "[otp] ERVENOW_OTP_PEPPER غير معيّن — يُستخدم اشتقاق من ERVENOW_JWT_SECRET (يفضّل فصل المفتاح في الإنتاج)"
      );
    }
    return `${jwt}:ervenow:otp-pepper:v1`;
  }
  throw new Error("ERVENOW_OTP_PEPPER أو ERVENOW_JWT_SECRET (16+ حرف) مطلوب لتخزين OTP");
}

function hashCode(scope, subjectKey, code) {
  const pepper = getOtpPepper();
  return crypto.createHash("sha256").update(`${pepper}|${scope}|${subjectKey}|${code}`, "utf8").digest("hex");
}

function memoryKey(scope, subjectKey) {
  return `${scope}::${subjectKey}`;
}

function pruneIpHits(now) {
  const cutoff = now - 10 * 60 * 1000;
  while (memoryIpHits.length && memoryIpHits[0].t < cutoff) memoryIpHits.shift();
}

function checkIpRateMemory(ip, now) {
  if (!ip) return { ok: true };
  pruneIpHits(now);
  const n = memoryIpHits.filter((h) => h.ip === ip).length;
  if (n >= ipMaxPer10Min()) {
    return { ok: false, error: "محاولات كثيرة من نفس الشبكة — حاول لاحقاً", cooldownSeconds: 120 };
  }
  return { ok: true };
}

function recordIpMemory(ip, now) {
  if (!ip) return;
  memoryIpHits.push({ ip, t: now });
}

/**
 * بدء تحدي OTP (إرسال رمز جديد).
 */
async function startOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const code = String(opts.code || "").trim();
  const ttlMs = Number(opts.ttlMs) || 5 * 60 * 1000;
  const mode = opts.mode === "memory" ? "memory" : opts.mode === "supabase" ? "supabase" : otpBackendMode();
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

  try {
    getOtpPepper();
  } catch (e) {
    return { ok: false, error: e.message || "OTP pepper missing" };
  }

  if (mode === "memory") {
    const now = Date.now();
    const ipCheck = checkIpRateMemory(ip, now);
    if (!ipCheck.ok) return ipCheck;
    const k = memoryKey(scope, subjectKey);
    const prev = memoryStore.get(k);
    const cd = resendCooldownMs();
    if (prev && prev.lastSentAt && now - prev.lastSentAt < cd) {
      const remain = Math.ceil((cd - (now - prev.lastSentAt)) / 1000);
      return { ok: false, error: `انتظر ${remain} ثانية قبل إعادة إرسال الرمز`, cooldownSeconds: remain };
    }
    if (prev && prev.lockUntil && prev.lockUntil > now) {
      const remain = Math.ceil((prev.lockUntil - now) / 1000);
      return { ok: false, error: `محاولات كثيرة — حاول بعد ${remain} ثانية`, cooldownSeconds: remain };
    }
    memoryStore.set(k, {
      codeHash: hashCode(scope, subjectKey, code),
      expiresAt: now + ttlMs,
      attempts: 0,
      lastSentAt: now,
      resendCount: prev ? (prev.resendCount || 0) + 1 : 0,
      lockUntil: 0,
      consumed: false,
      extras: metadata,
    });
    recordIpMemory(ip, now);
    return { ok: true };
  }

  const sb = opts.sb;
  if (!sb) return { ok: false, error: "Supabase client مطلوب لـ OTP supabase" };

  const cd = resendCooldownMs();
  const nowIso = new Date().toISOString();
  const windowIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  if (ip) {
    const { data: ipRows, error: ipErr } = await sb
      .from("ervenow_otp_challenges")
      .select("id")
      .eq("ip", ip)
      .gte("last_sent_at", windowIso);
    if (!ipErr && Array.isArray(ipRows) && ipRows.length >= ipMaxPer10Min()) {
      return { ok: false, error: "محاولات كثيرة من نفس الشبكة — حاول لاحقاً", cooldownSeconds: 120 };
    }
  }

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
  const insertRow = {
    scope,
    subject_key: subjectKey,
    code_hash: codeHash,
    attempts: 0,
    max_attempts: maxAttempts(),
    resend_count: prevResend + 1,
    last_sent_at: nowIso,
    locked_until: null,
    expires_at: expiresAt,
    consumed_at: null,
    ip,
    metadata,
  };
  const { error: insErr } = await sb.from("ervenow_otp_challenges").insert(insertRow);
  if (insErr) {
    if (/consumed_at/i.test(String(insErr.message || ""))) {
      delete insertRow.consumed_at;
      const retry = await sb.from("ervenow_otp_challenges").insert(insertRow);
      if (!retry.error) return { ok: true };
    }
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

async function verifyOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const code = String(opts.code || "").trim();
  const mode = opts.mode === "memory" ? "memory" : opts.mode === "supabase" ? "supabase" : otpBackendMode();
  const sb = opts.sb;

  if (!scope || !subjectKey || !code) {
    return { ok: false, error: "scope/subject/code مطلوبة" };
  }

  try {
    getOtpPepper();
  } catch (e) {
    return { ok: false, error: e.message || "OTP pepper missing" };
  }

  if (mode === "memory") {
    const k = memoryKey(scope, subjectKey);
    const row = memoryStore.get(k);
    if (!row || !row.expiresAt || row.expiresAt <= Date.now()) {
      memoryStore.delete(k);
      return { ok: false, error: "رمز غير صحيح أو منتهي" };
    }
    if (row.consumed) {
      return { ok: false, error: "رمز مستخدم مسبقاً" };
    }
    if (row.lockUntil && row.lockUntil > Date.now()) {
      const remain = Math.ceil((row.lockUntil - Date.now()) / 1000);
      return { ok: false, error: `تم القفل مؤقتاً — حاول بعد ${remain} ثانية` };
    }
    const expected = hashCode(scope, subjectKey, code);
    if (row.codeHash !== expected) {
      row.attempts = Number(row.attempts || 0) + 1;
      const maxA = maxAttempts();
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
    row.consumed = true;
    memoryStore.set(k, row);
    const extras = row.extras && typeof row.extras === "object" ? row.extras : {};
    return { ok: true, metadata: extras };
  }

  if (!sb) return { ok: false, error: "Supabase client مطلوب" };

  const { data: rows, error: selErr } = await sb
    .from("ervenow_otp_challenges")
    .select("*")
    .eq("scope", scope)
    .eq("subject_key", subjectKey)
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
  if (row.consumed_at) {
    return { ok: false, error: "رمز مستخدم مسبقاً" };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "رمز غير صحيح أو منتهي" };
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const remain = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000);
    return { ok: false, error: `تم القفل مؤقتاً — حاول بعد ${remain} ثانية` };
  }

  const expected = hashCode(scope, subjectKey, code);
  if (expected !== row.code_hash) {
    const attempts = Number(row.attempts || 0) + 1;
    const maxA = Number(row.max_attempts || maxAttempts());
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
  const consumedIso = new Date().toISOString();
  const { error: consErr } = await sb
    .from("ervenow_otp_challenges")
    .update({ consumed_at: consumedIso })
    .eq("id", row.id);
  if (consErr && /consumed_at/i.test(String(consErr.message || ""))) {
    await sb.from("ervenow_otp_challenges").delete().eq("id", row.id);
  }
  return { ok: true, metadata: metaOut };
}

async function invalidateOtpChallenge(opts) {
  const scope = String(opts.scope || "").trim();
  const subjectKey = String(opts.subjectKey || "").trim();
  const mode = opts.mode === "memory" ? "memory" : opts.mode === "supabase" ? "supabase" : otpBackendMode();
  const sb = opts.sb;
  if (!scope || !subjectKey) return;
  if (mode === "memory") {
    memoryStore.delete(memoryKey(scope, subjectKey));
    return;
  }
  if (!sb) return;
  await sb.from("ervenow_otp_challenges").delete().eq("scope", scope).eq("subject_key", subjectKey);
}

/** للاختبارات — لا يُصدَّر كمسار HTTP */
function _resetMemoryStoreForTests() {
  memoryStore.clear();
  memoryIpHits.length = 0;
}

module.exports = {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
  _resetMemoryStoreForTests,
};
