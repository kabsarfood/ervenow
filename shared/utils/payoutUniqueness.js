/**
 * منع تكرار الآيبان بين جهات مختلفة + مساعدات هوية/جوال
 */

const crypto = require("crypto");
const { normalizePhone } = require("./phone");
const { phoneLookupVariants, phonesEquivalent } = require("./userPhoneLookup");

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

function storePhoneLookupKeys(phoneDigits) {
  const p = normalizePhone(phoneDigits);
  const keys = new Set();
  if (p && p.length >= 10) keys.add(p);
  phoneLookupVariants(p).forEach((v) => {
    const d = String(v || "").replace(/\D/g, "");
    if (d.length >= 9 && d.length <= 15) keys.add(d);
  });
  return [...keys];
}

/**
 * يبحث عن متجر بنفس الجوال (كل صيغ 05 / 9665) مع مطابقة فعلية في JS.
 * لا يعتمد على eq خام وحده حتى لا يُرفض رقم جديد بالخطأ.
 */
async function resolveStorePhoneForRegister(sb, phoneDigits) {
  const p = normalizePhone(phoneDigits);
  if (!p || p.length < 10) return { approved: null, pending: null };
  const keys = storePhoneLookupKeys(p);
  if (!keys.length) return { approved: null, pending: null };

  const { data, error } = await sb
    .from("stores")
    .select("id, status, phone")
    .in("phone", keys)
    .in("status", ["pending", "approved"])
    .limit(20);
  if (error) throw new Error(error.message);

  const hits = (data || []).filter((r) => phonesEquivalent(r.phone, p));
  const approved = hits.find((r) => String(r.status || "").toLowerCase() === "approved") || null;
  const pending = hits.find((r) => String(r.status || "").toLowerCase() === "pending") || null;
  return { approved, pending };
}

/** يمنع فقط متجراً معتمداً بنفس الجوال. طلب قيد المراجعة يُعاد استخدامه (تحديث) لا رفض. */
async function assertStorePhoneNotDuplicateForRegister(sb, phoneDigits) {
  const found = await resolveStorePhoneForRegister(sb, phoneDigits);
  if (found.approved) {
    throw new Error("رقم الجوال مسجّل مسبقاً لمتجر معتمد — لا يمكن تكرار رقم الجوال");
  }
  return found;
}

module.exports = {
  ibanFingerprintFromPlain,
  iqamaDigitsNormalized,
  digitsOnly,
  assertPayoutIbanGloballyAvailable,
  assertStorePhoneNotDuplicateForRegister,
  resolveStorePhoneForRegister,
  stripIban,
};
