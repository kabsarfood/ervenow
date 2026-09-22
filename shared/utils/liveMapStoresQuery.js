/**
 * جلب صفوف المتاجر للخريطة الحية (عام: معتمد+نشط · إدارة: كل من له إحداثيات).
 */
const { mergeMapColorsIntoBranding } = require("./mapCategoryColors");
const { liveMapStorePayload } = require("./liveMapStorePayload");
const platformBranding = require("./platformBrandingStore");
const { storeRowIsListedActive, appendSelectCols } = require("./storePublication");

const LIVE_MAP_STORE_COLS = appendSelectCols(
  "id,name,type,category,lat,lng,maps_url,logo_url,address,location_text,is_active,status,average_rating,rating_count,delivery_radius_km",
  ["publication_status"]
);
const LIVE_MAP_STORE_COLS_NO_MAPS = appendSelectCols(
  "id,name,type,category,lat,lng,logo_url,address,location_text,is_active,status,average_rating,rating_count,delivery_radius_km",
  ["publication_status"]
);
const LIVE_MAP_STORE_COLS_NO_PUB =
  "id,name,type,category,lat,lng,maps_url,logo_url,address,location_text,is_active,status,average_rating,rating_count,delivery_radius_km";

function parseLiveMapBounds(query) {
  const q = query && typeof query === "object" ? query : {};
  const north = Number(q.north);
  const south = Number(q.south);
  const east = Number(q.east);
  const west = Number(q.west);
  const hasBounds =
    Number.isFinite(north) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(west);
  if (!hasBounds) return { hasBounds: false };
  return {
    hasBounds: true,
    minLat: Math.min(north, south),
    maxLat: Math.max(north, south),
    minLng: Math.min(east, west),
    maxLng: Math.max(east, west),
  };
}

function isMapsUrlSchemaError(err) {
  if (!err) return false;
  return /maps_url|schema cache|Could not find the/i.test(String(err.message || err.details || ""));
}

function isPublicationColError(err) {
  if (!err) return false;
  return /publication_status|schema cache|Could not find the/i.test(String(err.message || err.details || ""));
}

function applyBounds(query, bounds) {
  if (!bounds || !bounds.hasBounds) return query;
  return query
    .gte("lat", bounds.minLat)
    .lte("lat", bounds.maxLat)
    .gte("lng", bounds.minLng)
    .lte("lng", bounds.maxLng);
}

async function queryLiveMapStoreRows(sb, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const listedOnly = o.listedOnly !== false;
  const bounds = o.bounds || { hasBounds: false };
  const limit = Math.min(Math.max(Number(o.limit) || 400, 1), 800);

  function build(cols) {
    let query = sb.from("stores").select(cols).not("lat", "is", null).not("lng", "is", null).limit(limit);
    if (listedOnly) {
      query = query.eq("status", "approved").eq("is_active", true);
    }
    return applyBounds(query, bounds);
  }

  let { data, error } = await build(LIVE_MAP_STORE_COLS);
  if (error && isPublicationColError(error)) {
    ({ data, error } = await build(LIVE_MAP_STORE_COLS_NO_PUB));
  }
  if (error && isMapsUrlSchemaError(error)) {
    ({ data, error } = await build(LIVE_MAP_STORE_COLS_NO_MAPS));
  }
  return { data: data || [], error };
}

async function loadLiveMapStoresPayload(sb, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const listedOnly = o.listedOnly !== false;
  const { data, error } = await queryLiveMapStoreRows(sb, o);
  if (error) return { error };

  const branding = mergeMapColorsIntoBranding(await platformBranding.loadBranding(sb));
  const stores = (data || [])
    .filter((row) => (listedOnly ? storeRowIsListedActive(row) : true))
    .map((row) => liveMapStorePayload(row, { branding: branding }))
    .filter(Boolean);

  return {
    stores: stores,
    branding: branding,
    map_colors: {
      restaurant: branding.map_color_restaurant,
      store: branding.map_color_store,
      pharmacy: branding.map_color_pharmacy,
      service: branding.map_color_service,
    },
  };
}

module.exports = {
  parseLiveMapBounds,
  queryLiveMapStoreRows,
  loadLiveMapStoresPayload,
  storeRowIsListedActive,
  LIVE_MAP_STORE_COLS,
};
