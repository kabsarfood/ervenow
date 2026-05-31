/**
 * رفع ملفات المتجر إلى Supabase Storage
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
  const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return pub && pub.publicUrl ? pub.publicUrl : null;
}

module.exports = {
  parseBase64File,
  uploadToStoreBucket,
};
