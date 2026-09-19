const fs = require("fs");
const path = require("path");

const BRANDING_KEYS = [
  "logo_url",
  "primary_color",
  "secondary_color",
  "accent_color",
  "background_color",
  "text_color",
  "map_color_restaurant",
  "map_color_store",
  "map_color_pharmacy",
  "map_color_service",
];

const { DEFAULT_MAP_COLORS } = require("./mapCategoryColors");

const DEFAULT_BRANDING = {
  logo_url: "",
  primary_color: "#146c43",
  secondary_color: "#0f5a37",
  accent_color: "#ff7a00",
  background_color: "#f7f4ef",
  text_color: "#111827",
  map_color_restaurant: DEFAULT_MAP_COLORS.map_color_restaurant,
  map_color_store: DEFAULT_MAP_COLORS.map_color_store,
  map_color_pharmacy: DEFAULT_MAP_COLORS.map_color_pharmacy,
  map_color_service: DEFAULT_MAP_COLORS.map_color_service,
};

function isMissingPlatformSettingsTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /42P01|platform_settings|does not exist|schema cache/i.test(msg);
}

function isValidHexColor(v) {
  const s = String(v || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(s);
}

function decodeBase64ImageDataUrl(dataUrl) {
  const s = String(dataUrl || "").trim();
  const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (!m) return { mime: null, buffer: null };
  const mime = String(m[1] || "").toLowerCase();
  const b64 = m[2].replace(/\s/g, "");
  try {
    const buffer = Buffer.from(b64, "base64");
    return { mime, buffer };
  } catch {
    return { mime, buffer: null };
  }
}

function extFromMimeOrName(mime, fileName) {
  const fn = String(fileName || "").toLowerCase();
  const extDot = fn.match(/\.([a-z0-9]+)$/i);
  if (extDot) {
    const e = extDot[1].toLowerCase();
    if (["png", "jpg", "jpeg", "svg", "webp"].includes(e)) return e === "jpeg" ? "jpg" : e;
  }
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("webp")) return "webp";
  return null;
}

function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  const head = buf.slice(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return null;
}

/**
 * يحفظ صورة base64 تحت public/uploads/{uploadSubdir}/{outputFileName}.{ext}
 * @param {string} publicRoot - مسار مجلد public
 */
async function saveUploadImageBase64({
  publicRoot,
  dataUrl,
  fileName,
  maxBytes = 2 * 1024 * 1024,
  uploadSubdir = "platform",
  outputFileName = "logo",
}) {
  const { mime, buffer } = decodeBase64ImageDataUrl(dataUrl);
  if (!buffer || !buffer.length) throw new Error("ملف الصورة غير صالح");

  if (buffer.length > maxBytes) {
    throw new Error(`حجم الصورة يتجاوز ${Math.round(maxBytes / (1024 * 1024))} ميجابايت`);
  }

  let ext = extFromMimeOrName(mime || "", fileName);
  const sniffed = sniffImageType(buffer);
  if (!ext) ext = sniffed;
  if (!ext) throw new Error("صيغة الصورة غير مدعومة — استخدم PNG أو JPG أو SVG أو WEBP");
  if (sniffed && ext !== sniffed && ext !== "jpg" && sniffed !== "jpg") {
    ext = sniffed;
  }
  if (!["png", "jpg", "svg", "webp"].includes(ext)) throw new Error("صيغة الصورة غير مدعومة");

  const safeName = String(outputFileName || "asset").replace(/[^a-zA-Z0-9_-]/g, "") || "asset";
  const subParts = String(uploadSubdir || "platform")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const dir = path.join(publicRoot, "uploads", ...subParts);
  await fs.promises.mkdir(dir, { recursive: true });

  const diskPath = path.join(dir, `${safeName}.${ext}`);
  await fs.promises.writeFile(diskPath, buffer);

  const urlPath = "/uploads/" + subParts.join("/") + `/${safeName}.${ext}`;
  return `${urlPath}?v=${Date.now()}`;
}

/**
 * يحفظ شعار المنصة فقط — لا يُستخدم لبنرات العرض أو غيرها.
 * @param {string} publicRoot - مسار مجلد public
 */
async function saveLogoBase64({ publicRoot, dataUrl, fileName, maxBytes = 2 * 1024 * 1024 }) {
  return saveUploadImageBase64({
    publicRoot,
    dataUrl,
    fileName,
    maxBytes,
    uploadSubdir: "platform",
    outputFileName: "logo",
  });
}

async function loadBranding(sb) {
  const out = { ...DEFAULT_BRANDING };
  if (!sb) return out;
  try {
    const { data, error } = await sb.from("platform_settings").select("key,value").in("key", BRANDING_KEYS);
    if (error) {
      if (isMissingPlatformSettingsTable(error)) return out;
      throw error;
    }
    for (const row of data || []) {
      const k = row && row.key;
      if (k && Object.prototype.hasOwnProperty.call(out, k) && row.value != null) {
        out[k] = String(row.value);
      }
    }
    return normalizeLegacyBranding(out);
  } catch (e) {
    console.warn("[platformBranding] load:", e && (e.message || String(e)));
    return { ...DEFAULT_BRANDING };
  }
}

/** Map brown/gold era colors stored in DB → official green marketplace identity */
function normalizeLegacyBranding(settings) {
  const s = { ...(settings || {}) };
  const legacyPrimary = new Set(["#5b371d", "#3d2213", "#2a1810", "#2b1f16"]);
  const legacyAccent = new Set(["#d4a76a", "#b9872f", "#c9a227", "#d4a84b"]);
  const legacyBg = new Set(["#f8f5f0", "#f8f4ee", "#faf4ee"]);
  const hex = (v) => String(v || "").trim().toLowerCase();
  if (legacyPrimary.has(hex(s.primary_color))) s.primary_color = DEFAULT_BRANDING.primary_color;
  if (legacyPrimary.has(hex(s.secondary_color)) || hex(s.secondary_color) === "#8b5e34") {
    s.secondary_color = DEFAULT_BRANDING.secondary_color;
  }
  if (legacyAccent.has(hex(s.accent_color))) s.accent_color = DEFAULT_BRANDING.accent_color;
  if (legacyBg.has(hex(s.background_color))) s.background_color = DEFAULT_BRANDING.background_color;
  if (legacyPrimary.has(hex(s.text_color))) s.text_color = DEFAULT_BRANDING.text_color;
  return s;
}

function platformSettingsHelpMessage(error) {
  const msg = String((error && (error.message || error.details || error.hint)) || "");
  const code = error && error.code;
  const cacheIssue = /schema cache|PGRST205/i.test(msg) || code === "PGRST205";
  if (cacheIssue) {
    return (
      "واجهة Supabase لم تُحدَّث بعد — نفّذ في SQL Editor: NOTIFY pgrst, 'reload schema'; أو نفّذ كامل ملف shared/migration_platform_settings.sql (يضم هذا الأمر في آخر الملف)، ثم انتظر ثوانٍ وأعد المحاولة."
    );
  }
  return (
    "جدول platform_settings غير جاهز — افتح Supabase → SQL Editor والصق محتوى الملف ثم Run: shared/migration_platform_settings.sql أو من الطرفية: npm run migrate:platform-settings بعد ضبط SUPABASE_DB_URL أو SUPABASE_DB_PASSWORD في .env"
  );
}

async function upsertSetting(sb, key, value) {
  const row = {
    key,
    value: String(value != null ? value : ""),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("platform_settings").upsert(row, { onConflict: "key" });
  if (error && isMissingPlatformSettingsTable(error)) {
    throw new Error(platformSettingsHelpMessage(error));
  }
  if (error) throw error;
}

async function applyBrandingPatch(sb, patch, { publicRoot } = {}) {
  const updates = { ...patch };
  if (updates.logoFileBase64) {
    if (!publicRoot) throw new Error("publicRoot مطلوب لرفع الشعار");
    const url = await saveLogoBase64({
      publicRoot,
      dataUrl: updates.logoFileBase64,
      fileName: updates.logoFileName || "logo.png",
    });
    updates.logo_url = url;
    delete updates.logoFileBase64;
    delete updates.logoFileName;
  }

  for (const k of Object.keys(updates)) {
    if (!BRANDING_KEYS.includes(k)) {
      delete updates[k];
    }
  }

  for (const k of Object.keys(updates)) {
    if (!BRANDING_KEYS.includes(k)) continue;
    if (k !== "logo_url") {
      const v = updates[k];
      if (v != null && String(v).trim() !== "" && !isValidHexColor(v)) {
        throw new Error(`لون غير صالح لـ ${k} — استخدم صيغة #RRGGBB`);
      }
    }
  }

  for (const k of Object.keys(updates)) {
    if (BRANDING_KEYS.includes(k)) await upsertSetting(sb, k, updates[k]);
  }

  return loadBranding(sb);
}

async function resetColorsToDefaults(sb) {
  for (const k of BRANDING_KEYS) {
    if (k === "logo_url") continue;
    await upsertSetting(sb, k, DEFAULT_BRANDING[k]);
  }
  return loadBranding(sb);
}

module.exports = {
  BRANDING_KEYS,
  DEFAULT_BRANDING,
  loadBranding,
  applyBrandingPatch,
  resetColorsToDefaults,
  isValidHexColor,
  saveUploadImageBase64,
  saveLogoBase64,
  isMissingPlatformSettingsTable,
  platformSettingsHelpMessage,
};
