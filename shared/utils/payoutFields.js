/**
 * حقول الدفع عند التسجيل (آيبان، بنك، STC Pay، اهتمام بالعملات المشفرة)
 * للمندوبين والمتاجر: تُخزَّن bank_iban / bank_account_number / bank_swift_code مشفّرة على الخادم.
 */

const { encrypt, assertBankSecretConfigured } = require("../../server/utils/crypto");
const { ibanFingerprintFromPlain } = require("./payoutUniqueness");

function stripSpaces(s) {
  return String(s || "").replace(/\s+/g, "").trim();
}

function normalizeSaudiMobile05(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("9665")) d = "0" + d.slice(3);
  else if (d.startsWith("5") && d.length === 9) d = "0" + d;
  return d.slice(0, 10);
}

function isValidSaudiIban(iban) {
  const x = stripSpaces(iban).toUpperCase();
  return /^SA\d{22}$/.test(x);
}

function normalizeSwift(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!s) return null;
  if (s.length !== 8 && s.length !== 11) return null;
  return s;
}

/**
 * يقرأ جسم الطلب ويُرجع كائناً للحقول المسموحة فقط (كلها اختيارية).
 * يُرمى خطأ إذا وُجدت قيم غير صالحة رغم الإرسال.
 */
function parseOptionalPayoutPayload(body) {
  const b = body && typeof body === "object" ? body : {};
  const raw = b.payout || b.payout_details;
  if (!raw || typeof raw !== "object") return {};

  const bank_country_code = String(raw.bank_country_code || "SA")
    .trim()
    .toUpperCase()
    .slice(0, 2) || "SA";
  const bank_name = String(raw.bank_name || "").trim().slice(0, 200) || null;
  const bank_account_name = String(raw.bank_account_name || "").trim().slice(0, 200) || null;
  const iban = stripSpaces(raw.iban).toUpperCase() || null;
  const bank_account_number = stripSpaces(raw.bank_account_number) || null;
  const bank_swift_code = normalizeSwift(raw.bank_swift_code);
  const stc_pay_phone = normalizeSaudiMobile05(raw.stc_pay_phone);
  const payout_crypto_interest = raw.payout_crypto_interest === true || raw.payout_crypto_interest === "true";

  if (iban) {
    if (bank_country_code === "SA") {
      if (!isValidSaudiIban(iban)) {
        throw new Error("رقم الآيبان السعودي يجب أن يبدأ بـ SA متبوعاً بـ 22 رقماً");
      }
      if (!bank_name) throw new Error("اختر اسم البنك عند إدخال الآيبان السعودي");
    } else {
      const clean = stripSpaces(iban).toUpperCase();
      if (clean.length < 10 || clean.length > 34 || !/^[A-Z0-9]+$/.test(clean)) {
        throw new Error("صيغة الآيبان غير صالحة");
      }
      if (!bank_name) throw new Error("أدخل اسم البنك عند إدخال الآيبان");
    }
  }
  if (bank_swift_code === null && raw.bank_swift_code != null && String(raw.bank_swift_code).trim() !== "") {
    throw new Error("رمز SWIFT/BIC يجب أن يكون 8 أو 11 خانة (أحرف وأرقام فقط)");
  }
  if (bank_account_number && bank_account_number.length > 34) {
    throw new Error("رقم الحساب طويل جداً");
  }
  if (stc_pay_phone && !/^05\d{8}$/.test(stc_pay_phone)) {
    throw new Error("رقم STC Pay يجب أن يكون سعودياً يبدأ بـ 05 (10 أرقام)");
  }

  if (!iban && !bank_name && !stc_pay_phone && !payout_crypto_interest && !bank_account_number && !bank_swift_code && !bank_account_name) {
    return {};
  }

  const out = {
    bank_country_code,
    payout_crypto_interest: !!payout_crypto_interest,
  };
  if (bank_name) out.bank_name = bank_name;
  if (bank_account_name) out.bank_account_name = bank_account_name;
  if (iban) out.iban = iban;
  if (bank_account_number) out.bank_account_number = bank_account_number;
  if (bank_swift_code) out.bank_swift_code = bank_swift_code;
  if (stc_pay_phone) out.stc_pay_phone = stc_pay_phone;
  return out;
}

function lastFourForDisplay(parsed) {
  if (parsed.iban) {
    const plain = stripSpaces(parsed.iban).toUpperCase();
    return plain.slice(-4) || null;
  }
  if (parsed.bank_account_number) {
    const acct = stripSpaces(parsed.bank_account_number);
    const digits = acct.replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(-4);
    return acct.slice(-4) || null;
  }
  return null;
}

/**
 * صف إدراج/تحديث لـ drivers أو stores — قيم حساسة مشفّرة، بدون عمود iban القديم.
 */
function payoutRowForDriversOrStores(parsed) {
  if (!parsed || !Object.keys(parsed).length) return {};
  const row = {
    bank_country_code: parsed.bank_country_code || "SA",
    payout_crypto_interest: !!parsed.payout_crypto_interest,
  };
  if (parsed.bank_name != null) row.bank_name = parsed.bank_name;
  if (parsed.bank_account_name != null) row.bank_account_name = parsed.bank_account_name;
  if (parsed.stc_pay_phone != null) row.stc_pay_phone = parsed.stc_pay_phone;

  const needCrypto = !!(parsed.iban || parsed.bank_account_number || parsed.bank_swift_code);
  if (needCrypto) assertBankSecretConfigured();

  if (parsed.iban) {
    const plain = stripSpaces(parsed.iban).toUpperCase();
    row.bank_iban = encrypt(plain);
    row.payout_iban_fingerprint = ibanFingerprintFromPlain(plain);
  }
  if (parsed.bank_account_number) {
    row.bank_account_number = encrypt(stripSpaces(parsed.bank_account_number));
  }
  if (parsed.bank_swift_code) {
    row.bank_swift_code = encrypt(parsed.bank_swift_code);
  }

  const last4 = lastFourForDisplay(parsed);
  if (last4) row.bank_last4 = last4;

  if (needCrypto || parsed.bank_account_name) {
    row.bank_verified = false;
    row.bank_added_at = new Date().toISOString();
  }

  return row;
}

function payoutRowForUsers(parsed) {
  if (!parsed || !Object.keys(parsed).length) return {};
  const row = {
    bank_country_code: parsed.bank_country_code || "SA",
    payout_crypto_interest: !!parsed.payout_crypto_interest,
  };
  if (parsed.bank_name != null) row.bank_name = parsed.bank_name;
  if (parsed.iban != null) {
    row.iban = parsed.iban;
    row.payout_iban_fingerprint = ibanFingerprintFromPlain(parsed.iban);
  }
  if (parsed.stc_pay_phone != null) row.stc_pay_phone = parsed.stc_pay_phone;
  return row;
}

module.exports = {
  parseOptionalPayoutPayload,
  payoutRowForDriversOrStores,
  payoutRowForUsers,
  normalizeSaudiMobile05,
  isValidSaudiIban,
};
