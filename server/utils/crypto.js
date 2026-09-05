const crypto = require("crypto");

const ALGO = "aes-256-cbc";
const MIN_SECRET_LEN = 16;
/** فصل مادّة المفتاح عن JWT حتى لا تكون مفاتيح التشفير = مفتاح التوقيع */
const DEV_BANK_KEY_SUFFIX = "\x00ervenow:bank-data-encrypt-v1";

let warnedDevBankFallback = false;

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

/**
 * المادّة النصية قبل SHA-256: BANK_DATA_SECRET أولاً؛ في غير الإنتاج فقط يُشتق من ERVENOW_JWT_SECRET إن وُجد.
 */
function resolveBankSecretRaw() {
  const bank = String(process.env.BANK_DATA_SECRET || "").trim();
  if (bank.length >= MIN_SECRET_LEN) {
    return { material: bank, source: "BANK_DATA_SECRET" };
  }

  const tooShort = bank.length > 0 && bank.length < MIN_SECRET_LEN;

  if (!isProduction()) {
    const jwt = String(process.env.ERVENOW_JWT_SECRET || "").trim();
    if (jwt.length >= MIN_SECRET_LEN) {
      return {
        material: jwt + DEV_BANK_KEY_SUFFIX,
        source: "ERVENOW_JWT_SECRET_DEV_DERIVED",
        shortBankHint: tooShort ? bank.length : undefined,
      };
    }
  }

  if (tooShort) {
    return { material: null, source: "BANK_DATA_SECRET_TOO_SHORT", hint: bank.length };
  }

  return { material: null, source: "missing" };
}

function bankKeyMaterial() {
  const r = resolveBankSecretRaw();
  if (!r.material) return null;
  return crypto.createHash("sha256").update(r.material, "utf8").digest();
}

function assertBankSecretConfigured() {
  const r = resolveBankSecretRaw();
  if (r.material) {
    if (r.source === "ERVENOW_JWT_SECRET_DEV_DERIVED" && !warnedDevBankFallback) {
      warnedDevBankFallback = true;
      if (r.shortBankHint) {
        console.warn(
          `[bank-crypto] BANK_DATA_SECRET قصير (${r.shortBankHint} حرفاً) — غالباً قُطع عند # في .env (ضع القيمة بين علامات اقتباس). يُستخدم اشتقاق JWT للتطوير فقط.`
        );
      } else {
        console.warn(
          "[bank-crypto] BANK_DATA_SECRET غير معيّن — يُستخدم اشتقاق من ERVENOW_JWT_SECRET للتطوير فقط. عيّن BANK_DATA_SECRET في الإنتاج."
        );
      }
    }
    return;
  }
  if (r.source === "BANK_DATA_SECRET_TOO_SHORT") {
    throw new Error(`BANK_DATA_SECRET قصير جداً (${r.hint} حرفاً) — يجب أن يكون ${MIN_SECRET_LEN} حرفاً على الأقل`);
  }
  if (isProduction()) {
    throw new Error(
      "BANK_DATA_SECRET مطلوب في الإنتاج (16+ حرف) في ملف البيئة — لتخزين بيانات الحساب البنكي بشكل آمن ومستقل عن JWT"
    );
  }
  throw new Error(
    "لتخزين بيانات بنكية مشفّرة: عيّن BANK_DATA_SECRET (16+ حرف) في .env، أو في التطوير فقط عيّن ERVENOW_JWT_SECRET بنفس الطول كحد أدنى لاشتقاق مؤقت"
  );
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
