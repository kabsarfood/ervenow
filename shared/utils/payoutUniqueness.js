/**
 * منع تكرار الآيبان بين جهات مختلفة + مساعدات هوية/جوال
 */

const crypto = require("crypto");
const { normalizePhone } = require("./phone");

function stripIban(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

/** بصمة ثابتة للمقارنة دون تخزين الآيبان كنص في فهارس متعددة */
function ibanFingerprintFromPlain(plain) {
  const n = stripIban(plain);
  if (!n) return null;
  return crypto.createHash("sha256").update(n, "utf8").digest("hex");
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * أرقام الهوية/الإقامة فقط (للتمييز والفهرس الفريد).
 */
function iqamaDigitsNormalized(iqamaRaw) {
  const d = digitsOnly(iqamaRaw);
  return d.length >= 8 ? d : "";
}

/**
 * جوالات نعتبرها نفس «المالك» (لا يُمنع تكرار الآيبان بينها وبين سجلها).
 * @param {string[]} ownerPhonesDigits — أرقام مخزّنة كما في قاعدة البيانات (مثلاً 9665… أو 05…)
 */
function phoneInOwnerSet(rowPhone, ownerPhonesDigits) {
  const rowN = normalizePhone(rowPhone);
  if (!rowN) return false;
  for (const o of ownerPhonesDigits || []) {
    const on = normalizePhone(o);
    if (on && on === rowN) return true;
  }
  return false;
}

/**
 * يمنع استخدام نفس الآيبان لجهة أخرى (مستخدم / مندوب / متجر) بخلاف أرقام الجوال المذكورة في ownerPhonesDigits.
 */
async function assertPayoutIbanGloballyAvailable(sb, plainIban, ctx) {
  const fp = ibanFingerprintFromPlain(plainIban);
  if (!fp) return;
  const owners = ctx.ownerPhonesDigits || [];

  const { data: usersHit, error: uErr } = await sb.from("users").select("id, phone").eq("payout_iban_fingerprint", fp).limit(20);
  if (uErr) throw new Error(uErr.message);
  for (const r of usersHit || []) {
    if (ctx.excludeUserId && String(r.id) === String(ctx.excludeUserId)) continue;
    if (phoneInOwnerSet(r.phone, owners)) continue;
    throw new Error("هذا الآيبان مسجّل لمستخدم آخر — كل آيبان لجهة واحدة فقط");
  }

  const { data: drvHit, error: dErr } = await sb.from("drivers").select("phone").eq("payout_iban_fingerprint", fp).limit(20);
  if (dErr) throw new Error(dErr.message);
  for (const r of drvHit || []) {
    if (phoneInOwnerSet(r.phone, owners)) continue;
    throw new Error("هذا الآيبان مسجّل لمندوب آخر — كل آيبان لجهة واحدة فقط");
  }

  const { data: stHit, error: sErr } = await sb.from("stores").select("id, phone").eq("payout_iban_fingerprint", fp).limit(20);
  if (sErr) throw new Error(sErr.message);
  for (const r of stHit || []) {
    if (ctx.excludeStoreId && String(r.id) === String(ctx.excludeStoreId)) continue;
    if (phoneInOwnerSet(r.phone, owners)) continue;
    throw new Error("هذا الآيبان مسجّل لمتجر آخر — كل آيبان لجهة واحدة فقط");
  }
}

/** تسجيل متجر جديد: لا يُسمح بنفس جوال متجر قيد المراجعة أو معتمد. */
async function assertStorePhoneNotDuplicateForRegister(sb, phoneDigits) {
  const p = normalizePhone(phoneDigits);
  if (!p) return;
  const { data, error } = await sb
    .from("stores")
    .select("id, status")
    .eq("phone", p)
    .in("status", ["pending", "approved"])
    .limit(5);
  if (error) throw new Error(error.message);
  if (data && data.length) {
    throw new Error("رقم الجوال مسجّل مسبقاً لطلب متجر قيد المراجعة أو متجر معتمد — لا يمكن تكرار رقم الجوال");
  }
}

module.exports = {
  ibanFingerprintFromPlain,
  iqamaDigitsNormalized,
  digitsOnly,
  assertPayoutIbanGloballyAvailable,
  assertStorePhoneNotDuplicateForRegister,
  stripIban,
};
