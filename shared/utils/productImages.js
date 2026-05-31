/**
 * تطبيع صور المنتج: image_url + image_urls (jsonb)
 */

function parseImageUrlsField(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((u) => String(u || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map((u) => String(u || "").trim()).filter(Boolean);
    } catch {
      return s.startsWith("http") ? [s] : [];
    }
  }
  return [];
}

function productImageUrlsFromRow(row) {
  if (!row || typeof row !== "object") return [];
  const fromJson = parseImageUrlsField(row.image_urls);
  const primary = row.image_url != null ? String(row.image_url).trim() : "";
  const merged = [];
  if (primary) merged.push(primary);
  fromJson.forEach((u) => {
    if (u && !merged.includes(u)) merged.push(u);
  });
  return merged.slice(0, 8);
}

function productRowWithImages(row) {
  if (!row || typeof row !== "object") return row;
  const urls = productImageUrlsFromRow(row);
  return {
    ...row,
    image_urls: urls,
    image_url: urls[0] || null,
  };
}

module.exports = {
  parseImageUrlsField,
  productImageUrlsFromRow,
  productRowWithImages,
};
