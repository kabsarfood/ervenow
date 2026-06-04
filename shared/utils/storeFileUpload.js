/**
 * رفع ملفات المتجر إلى Supabase Storage + روابط قابلة للعرض (عامة أو موقّعة).
 */

function parseBase64File(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) {
    try {
      return { mime: m[1].trim() || "image/jpeg", buffer: Buffer.from(m[2], "base64") };
    } catch {
      return null;
    }
  }
  try {
    return { mime: "application/octet-stream", buffer: Buffer.from(s, "base64") };
  } catch {
    return null;
  }
}

function safeFilePart(name) {
  const n = String(name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return n || "upload";
}

function storeFilesBucket() {
  return String(
    process.env.ERVENOW_STORE_FILES_BUCKET || process.env.ERWENOW_STORE_FILES_BUCKET || "erwenow-store-registrations"
  ).trim();
}

/** استخراج مسار الكائن داخل الدلو من رابط Supabase Storage */
function storageObjectPathFromUrl(url, bucket) {
  const s = String(url || "").trim();
  if (!s) return null;
  const b = String(bucket || storeFilesBucket()).trim();
  try {
    const u = new URL(s);
    const parts = u.pathname.split("/").filter(Boolean);
    const bi = parts.indexOf(b);
    if (bi >= 0 && bi < parts.length - 1) return parts.slice(bi + 1).join("/");
    for (const marker of ["public", "sign", "authenticated"]) {
      const mi = parts.indexOf(marker);
      if (mi >= 0 && parts[mi + 1] === b && mi + 2 < parts.length) {
        return parts.slice(mi + 2).join("/");
      }
    }
  } catch (_) {}
  return null;
}

const SIGNED_TTL_SEC = Math.min(
  60 * 60 * 24 * 7,
  Math.max(3600, Number(process.env.ERVENOW_STORE_IMAGE_SIGNED_TTL_SEC || 604800) || 604800)
);

/**
 * يُعيد رابطاً يعمل في المتصفح: موقّعاً عند الحاجة، أو العام إن وُجد.
 */
async function resolveStoreImageUrl(sb, url) {
  const raw = String(url || "").trim();
  if (!raw || !sb) return raw || null;
  const bucket = storeFilesBucket();
  const objectPath = storageObjectPathFromUrl(raw, bucket);
  if (!objectPath) return raw;
  try {
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(objectPath, SIGNED_TTL_SEC);
    if (!error && data && data.signedUrl) return data.signedUrl;
  } catch (e) {
    console.warn("[storeFileUpload] signedUrl:", e && (e.message || String(e)));
  }
  return raw;
}

async function resolveStoreImageUrls(sb, urls) {
  if (!urls || typeof urls !== "object") return urls;
  const out = { ...urls };
  if (out.logo_url) out.logo_url = await resolveStoreImageUrl(sb, out.logo_url);
  if (out.banner_url) out.banner_url = await resolveStoreImageUrl(sb, out.banner_url);
  return out;
}

async function uploadToStoreBucket(sb, storeId, subfolder, base64, originalName) {
  const bucket = storeFilesBucket();
  const parsed = parseBase64File(base64);
  if (!parsed || !parsed.buffer.length) return null;
  const ext = parsed.mime.includes("png") ? "png" : parsed.mime.includes("webp") ? "webp" : "jpg";
  const objectPath = `${storeId}/${subfolder}/${Date.now()}_${safeFilePart(originalName)}.${ext}`;
  const { error: upErr } = await sb.storage.from(bucket).upload(objectPath, parsed.buffer, {
    contentType: parsed.mime,
    upsert: false,
  });
  if (upErr) {
    console.error("[storeFileUpload] upload:", upErr.message || upErr);
    return null;
  }
  const { data: signed, error: signErr } = await sb.storage.from(bucket).createSignedUrl(objectPath, SIGNED_TTL_SEC);
  if (!signErr && signed && signed.signedUrl) return signed.signedUrl;
  const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return pub && pub.publicUrl ? pub.publicUrl : null;
}

module.exports = {
  parseBase64File,
  safeFilePart,
  storeFilesBucket,
  storageObjectPathFromUrl,
  uploadToStoreBucket,
  resolveStoreImageUrl,
  resolveStoreImageUrls,
};
