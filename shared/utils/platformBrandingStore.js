const fs = require("fs");
const path = require("path");

const BRANDING_KEYS = [
  "logo_url",
  "primary_color",
  "secondary_color",
  "accent_color",
  "background_color",
  "text_color",
];

const DEFAULT_BRANDING = {
  logo_url: "",
  primary_color: "#5b371d",
  secondary_color: "#8b5e34",
  accent_color: "#d4a76a",
  background_color: "#f8f5f0",
  text_color: "#2b1f16",
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
 * يحفظ الشعار تحت public/uploads/platform/ ويعيد مسار URL عام.
 * @param {string} publicRoot - مسار مجلد public
 */
async function saveLogoBase64({ publicRoot, dataUrl, fileName, maxBytes = 2 * 1024 * 1024 }) {
  const { mime, buffer } = decodeBase64ImageDataUrl(dataUrl);
  if (!buffer || !buffer.length) throw new Error("ملف الشعار غير صالح");

  if (buffer.length > maxBytes) throw new Error("حجم الشعار يتجاوز 2 ميجابايت");

  let ext = extFromMimeOrName(mime || "", fileName);
  const sniffed = sniffImageType(buffer);
  if (!ext) ext = sniffed;
  if (!ext) throw new Error("صيغة الصورة غير مدعومة — استخدم PNG أو JPG أو SVG أو WEBP");
  if (sniffed && ext !== sniffed && ext !== "jpg" && sniffed !== "jpg") {
    ext = sniffed;
  }
  if (!["png", "jpg", "svg", "webp"].includes(ext)) throw new Error("صيغة الصورة غير مدعومة");

  const dir = path.join(publicRoot, "uploads", "platform");
  await fs.promises.mkdir(dir, { recursive: true });

  const safeBase = "logo." + ext;
  const diskPath = path.join(dir, safeBase);
  await fs.promises.writeFile(diskPath, buffer);

  const v = Date.now();
  return `/uploads/platform/${safeBase}?v=${v}`;
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
    return out;
  } catch (e) {
    console.warn("[platformBranding] load:", e && (e.message || String(e)));
    return { ...DEFAULT_BRANDING };
  }
}

async function upsertSetting(sb, key, value) {
  const row = {
    key,
    value: String(value != null ? value : ""),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("platform_settings").upsert(row, { onConflict: "key" });
  if (error && isMissingPlatformSettingsTable(error)) {
    throw new Error("جدول platform_settings غير موجود — نفّذ shared/migration_platform_settings.sql");
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
  saveLogoBase64,
};
