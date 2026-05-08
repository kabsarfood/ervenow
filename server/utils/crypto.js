const crypto = require("crypto");

const ALGO = "aes-256-cbc";

function bankKeyMaterial() {
  const raw = process.env.BANK_DATA_SECRET;
  if (raw == null || String(raw).trim() === "") return null;
  return crypto.createHash("sha256").update(String(raw), "utf8").digest();
}

function assertBankSecretConfigured() {
  const raw = process.env.BANK_DATA_SECRET;
  if (raw == null || String(raw).trim() === "") {
    throw new Error("BANK_DATA_SECRET مطلوب في البيئة لتخزين بيانات الحساب البنكي بشكل آمن");
  }
  if (String(raw).length < 16) {
    throw new Error("BANK_DATA_SECRET يجب أن يكون 16 حرفاً على الأقل");
  }
}

function encrypt(text) {
  if (!text) return null;
  assertBankSecretConfigured();
  const KEY = bankKeyMaterial();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  let enc = cipher.update(String(text), "utf8", "hex");
  enc += cipher.final("hex");
  return iv.toString("hex") + ":" + enc;
}

function decrypt(payload) {
  if (!payload) return null;
  assertBankSecretConfigured();
  const KEY = bankKeyMaterial();
  const [ivHex, enc] = String(payload).split(":");
  if (!ivHex || enc == null) return null;
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

module.exports = { encrypt, decrypt, assertBankSecretConfigured };
