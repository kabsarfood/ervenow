/**
 * البحث عن مستخدم بالجوال — يدعم التخزين بصيغ متعددة (05… / 9665… / +966…)
 */
const { toE164, toStorageDigits } = require("./phone");

function canonicalPhoneDigits(input) {
  const raw = String(input || "").replace(/\D/g, "");
  if (!raw) return "";
  let probe = raw;
  if (probe.startsWith("05")) {
    /* as-is */
  } else if (probe.startsWith("966")) {
    probe = `+${probe}`;
  } else if (probe.startsWith("5") && probe.length === 9) {
    probe = `0${probe}`;
  }
  const e164 = toE164(probe);
  return e164 ? toStorageDigits(e164) : raw;
}

function addPhoneVariant(set, value) {
  const d = String(value || "").replace(/\D/g, "");
  if (!d) return;
  set.add(d);
  set.add(`+${d}`);
  if (d.startsWith("9665") && d.length === 12) {
    const local = `0${d.slice(3)}`;
    const national = d.slice(3);
    set.add(local);
    set.add(`+966${national}`);
    set.add(national);
  }
  if (d.startsWith("05") && d.length === 10) {
    const national = d.slice(1);
    set.add(`966${national}`);
    set.add(`+966${national}`);
    set.add(national);
  }
  if (d.startsWith("5") && d.length === 9) {
    set.add(`0${d}`);
    set.add(`966${d}`);
    set.add(`+966${d}`);
  }
}

function phoneLookupVariants(input) {
  const raw = String(input || "").replace(/\D/g, "");
  const canonical = canonicalPhoneDigits(raw);
  const set = new Set();
  addPhoneVariant(set, canonical);
  addPhoneVariant(set, raw);
  return [...set].filter(Boolean);
}

function phonesEquivalent(a, b) {
  const ca = canonicalPhoneDigits(a);
  const cb = canonicalPhoneDigits(b);
  return !!ca && ca === cb;
}

function isMissingUsersColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.(status|name|service_type|service_district)|column .* does not exist|Could not find the .*column/i.test(msg);
}

async function findUserByPhone(sb, phoneDigits, columns = "id, role, status, phone, service_type, updated_at") {
  if (!sb) return { data: null, error: new Error("no supabase") };
  const variants = phoneLookupVariants(phoneDigits);
  if (!variants.length) return { data: null, error: null };

  const { data, error } = await sb.from("users").select(columns).in("phone", variants).limit(1);
  if (error) return { data: null, error };
  const row = Array.isArray(data) ? data[0] : data;
  if (row) return { data: row, error: null };

  return findUserByPhoneFuzzy(sb, phoneDigits, columns);
}

async function findUserByPhoneFuzzy(sb, phoneDigits, columns) {
  const canonical = canonicalPhoneDigits(phoneDigits);
  if (!/^9665\d{8}$/.test(canonical)) return { data: null, error: null };
  const tail = canonical.slice(-9);
  const { data, error } = await sb.from("users").select(columns).ilike("phone", `%${tail}`).limit(20);
  if (error) return { data: null, error };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const match = rows.find((row) => phonesEquivalent(row.phone, canonical));
  return { data: match || null, error: null };
}

async function findUserByPhoneResilient(sb, phoneDigits) {
  const columnSets = [
    "id, role, status, phone, name, service_type, service_district",
    "id, role, status, phone, name, service_type",
    "id, role, status, phone, service_type",
    "id, role, phone, service_type, updated_at, name, service_district",
    "id, role, phone, service_type, updated_at, name",
    "id, role, phone, service_type, updated_at",
    "id, role, phone",
  ];
  let lastError = null;
  for (const cols of columnSets) {
    const found = await findUserByPhone(sb, phoneDigits, cols);
    if (found.data) return found;
    if (found.error) {
      lastError = found.error;
      if (!isMissingUsersColumnError(found.error)) return found;
    }
  }
  return { data: null, error: lastError };
}

module.exports = {
  canonicalPhoneDigits,
  phoneLookupVariants,
  phonesEquivalent,
  isMissingUsersColumnError,
  findUserByPhone,
  findUserByPhoneResilient,
};
