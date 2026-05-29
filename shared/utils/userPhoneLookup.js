/**
 * البحث عن مستخدم بالجوال — يدعم التخزين بصيغتي 9665… و 05…
 */
const { toE164, toStorageDigits } = require("./phone");

function canonicalPhoneDigits(input) {
  const raw = String(input || "").replace(/\D/g, "");
  if (!raw) return "";
  const e164 = toE164(raw.startsWith("05") ? raw : raw.startsWith("966") ? `+${raw}` : raw);
  return e164 ? toStorageDigits(e164) : raw;
}

function phoneLookupVariants(input) {
  const raw = String(input || "").replace(/\D/g, "");
  const canonical = canonicalPhoneDigits(raw);
  const set = new Set();
  if (canonical) set.add(canonical);
  if (raw) set.add(raw);
  if (canonical.startsWith("9665") && canonical.length === 12) {
    set.add(`0${canonical.slice(3)}`);
  }
  if (raw.startsWith("05") && raw.length === 10) {
    set.add(`966${raw.slice(1)}`);
  }
  return [...set];
}

async function findUserByPhone(sb, phoneDigits, columns = "id, role, status, phone, service_type, updated_at, name") {
  if (!sb) return { data: null, error: new Error("no supabase") };
  const variants = phoneLookupVariants(phoneDigits);
  if (!variants.length) return { data: null, error: null };

  const { data, error } = await sb.from("users").select(columns).in("phone", variants).limit(1);
  if (error) return { data: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row || null, error: null };
}

module.exports = {
  canonicalPhoneDigits,
  phoneLookupVariants,
  findUserByPhone,
};
