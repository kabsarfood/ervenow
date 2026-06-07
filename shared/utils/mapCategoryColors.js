/**
 * ألوان نقاط الخريطة حسب نوع النشاط — من إعدادات platform_settings فقط.
 */
const MAP_COLOR_KEYS = {
  restaurant: "map_color_restaurant",
  store: "map_color_store",
  pharmacy: "map_color_pharmacy",
  service: "map_color_service",
};

const DEFAULT_MAP_COLORS = {
  map_color_restaurant: "#eab308",
  map_color_store: "#22c55e",
  map_color_pharmacy: "#06b6d4",
  map_color_service: "#8b5cf6",
};

const MAP_COLOR_SETTING_KEYS = Object.values(MAP_COLOR_KEYS);

function mapCategoryFromStoreType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "restaurant") return "restaurant";
  if (t === "pharmacy") return "pharmacy";
  if (
    t === "supermarket" ||
    t === "minimarket" ||
    t === "market" ||
    t === "vegetables" ||
    t === "butcher" ||
    t === "fish" ||
    t === "home_business" ||
    t === "other"
  ) {
    return "store";
  }
  if (t === "services" || t === "service") return "service";
  return "store";
}

function resolveMapColorForStoreType(type, settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const cat = mapCategoryFromStoreType(type);
  const key = MAP_COLOR_KEYS[cat] || MAP_COLOR_KEYS.store;
  const fromSettings = s[key];
  if (fromSettings && /^#[0-9A-Fa-f]{6}$/.test(String(fromSettings).trim())) {
    return String(fromSettings).trim();
  }
  return DEFAULT_MAP_COLORS[key] || DEFAULT_MAP_COLORS.map_color_store;
}

function mergeMapColorsIntoBranding(branding) {
  const out = Object.assign({}, branding || {});
  MAP_COLOR_SETTING_KEYS.forEach(function (k) {
    if (!out[k] || !/^#[0-9A-Fa-f]{6}$/.test(String(out[k]).trim())) {
      out[k] = DEFAULT_MAP_COLORS[k];
    }
  });
  return out;
}

module.exports = {
  MAP_COLOR_KEYS,
  MAP_COLOR_SETTING_KEYS,
  DEFAULT_MAP_COLORS,
  mapCategoryFromStoreType,
  resolveMapColorForStoreType,
  mergeMapColorsIntoBranding,
};
