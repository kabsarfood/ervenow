/**
 * حقول الدفع عند التسجيل (آيبان، بنك، STC Pay، اهتمام بالعملات المشفرة)
 */

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
  const iban = stripSpaces(raw.iban).toUpperCase() || null;
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
  if (stc_pay_phone && !/^05\d{8}$/.test(stc_pay_phone)) {
    throw new Error("رقم STC Pay يجب أن يكون سعودياً يبدأ بـ 05 (10 أرقام)");
  }

  if (!iban && !bank_name && !stc_pay_phone && !payout_crypto_interest) return {};

  const out = {
    bank_country_code,
    payout_crypto_interest: !!payout_crypto_interest,
  };
  if (bank_name) out.bank_name = bank_name;
  if (iban) out.iban = iban;
  if (stc_pay_phone) out.stc_pay_phone = stc_pay_phone;
  return out;
}

function payoutRowForDriversOrStores(parsed) {
  if (!parsed || !Object.keys(parsed).length) return {};
  const row = {
    bank_country_code: parsed.bank_country_code || "SA",
    payout_crypto_interest: !!parsed.payout_crypto_interest,
  };
  if (parsed.bank_name != null) row.bank_name = parsed.bank_name;
  if (parsed.iban != null) row.iban = parsed.iban;
  if (parsed.stc_pay_phone != null) row.stc_pay_phone = parsed.stc_pay_phone;
  return row;
}

function payoutRowForUsers(parsed) {
  if (!parsed || !Object.keys(parsed).length) return {};
  const row = {
    bank_country_code: parsed.bank_country_code || "SA",
    payout_crypto_interest: !!parsed.payout_crypto_interest,
  };
  if (parsed.bank_name != null) row.bank_name = parsed.bank_name;
  if (parsed.iban != null) row.iban = parsed.iban;
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
