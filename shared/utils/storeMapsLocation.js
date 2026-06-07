/**
 * اعتماد موقع المتجر الرسمي من رابط Google Maps / Apple / lat,lng
 */
const { resolveMapsLink, buildGoogleMapsUrl } = require("./mapsUrlParser");

function storeHasOfficialLocation(row) {
  if (!row || typeof row !== "object") return false;
  if (row.lat == null || row.lng == null || row.lat === "" || row.lng === "") return false;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * @param {object} patch — كائن التحديث (يُعدَّل in-place)
 * @param {string} mapsUrlInput
 * @returns {Promise<{ ok: boolean, applied?: boolean, lat?: number, lng?: number, maps_url?: string, message?: string }>}
 */
async function applyMapsUrlToStorePatch(patch, mapsUrlInput) {
  const url = String(mapsUrlInput || "").trim();
  if (!url) return { ok: true, applied: false };
  const resolved = await resolveMapsLink(url);
  if (!resolved || !Number.isFinite(resolved.lat) || !Number.isFinite(resolved.lng)) {
    return {
      ok: false,
      message: "تعذر استخراج الإحداثيات من رابط الموقع — الصق رابط Google Maps صالح أو lat,lng",
    };
  }
  patch.lat = resolved.lat;
  patch.lng = resolved.lng;
  patch.maps_url = resolved.resolved_url || buildGoogleMapsUrl(resolved.lat, resolved.lng);
  return {
    ok: true,
    applied: true,
    lat: resolved.lat,
    lng: resolved.lng,
    maps_url: patch.maps_url,
  };
}

module.exports = {
  storeHasOfficialLocation,
  applyMapsUrlToStorePatch,
};
