/**
 * إخفاء حقول التخزين البنكي الحساسة في استجابات JSON (لا تُرجع ciphertext ولا عمود iban القديم).
 */

const SENSITIVE_BANK_KEYS = new Set([
  "iban",
  "bank_iban",
  "bank_account_number",
  "bank_swift_code",
]);

function bankIbanMaskedFromRow(row) {
  const last = row && row.bank_last4 != null ? String(row.bank_last4).trim() : "";
  if (!last) return null;
  return `**** **** **** ${last}`;
}

/**
 * نسخة آمنة لسجل مندوب/متجر يُعاد للعميل أو للوحة إدارة (بدون فك تشفير — فقط عرض مقنع).
 */
function sanitizeDriverOrStoreRowForApi(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const k of SENSITIVE_BANK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, k)) delete out[k];
  }
  const masked = bankIbanMaskedFromRow(row);
  if (masked) out.bank_iban_masked = masked;
  else if ("bank_iban_masked" in out) delete out.bank_iban_masked;
  return out;
}

function sanitizeDriverOrStoreListForApi(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => sanitizeDriverOrStoreRowForApi(r));
}

module.exports = {
  sanitizeDriverOrStoreRowForApi,
  sanitizeDriverOrStoreListForApi,
  bankIbanMaskedFromRow,
  SENSITIVE_BANK_KEYS,
};
