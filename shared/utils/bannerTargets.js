/**
 * سجل أهداف عرض البنرات — يُوسَّع بإضافة عناصر هنا دون تعديل قاعدة البيانات.
 * banner_targets في DB = مصفوفة من هذه المعرّفات.
 */
const BANNER_TARGETS = [
  {
    id: "home",
    label_ar: "الرئيسية",
    page: "/",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "visitor_dashboard",
    label_ar: "لوحة زائر المنصة",
    page: "/dashboard",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "services",
    label_ar: "خدمات",
    page: "/services",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "stores",
    label_ar: "متاجر",
    page: "/stores",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "restaurants",
    label_ar: "مطاعم",
    page: "/restaurants",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "delivery",
    label_ar: "توصيل",
    page: "/delivery-services.html",
    admin_selectable: true,
    slots: ["carousel", "card"],
  },
  {
    id: "driver_dashboard",
    label_ar: "لوحة المندوب",
    page: "/driver-app",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "store_dashboard",
    label_ar: "لوحة المتجر",
    page: "/store-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "service_provider_dashboard",
    label_ar: "لوحة مزود الخدمة",
    page: "/provider-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "live_map",
    label_ar: "الخريطة الحية",
    page: "/live-map",
    admin_selectable: false,
    slots: ["strip"],
  },
  {
    id: "orders_page",
    label_ar: "صفحة الطلبات",
    page: "/my-orders",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "wallet_page",
    label_ar: "صفحة المحفظة",
    page: "/wallet.html",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "pharmacy_dashboard",
    label_ar: "لوحة الصيدليات",
    page: "/pharmacy-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "gas_station_dashboard",
    label_ar: "لوحة محطات الوقود",
    page: "/gas-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "flatbed_dashboard",
    label_ar: "لوحة السطحات",
    page: "/flatbed-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "laundry_dashboard",
    label_ar: "لوحة المغاسل",
    page: "/laundry-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
  {
    id: "kabsar_dashboard",
    label_ar: "لوحة كبسار",
    page: "/kabsar-dashboard",
    admin_selectable: false,
    slots: ["card"],
  },
];

/** ترتيب أماكن البنر في لوحة الإدارة */
const ADMIN_BANNER_PLACEMENT_IDS = [
  "home",
  "visitor_dashboard",
  "services",
  "stores",
  "restaurants",
  "delivery",
];

const TARGET_BY_ID = Object.fromEntries(
  BANNER_TARGETS.map(function (t) {
    return [t.id, t];
  })
);

const LEGACY_PLACEMENT_TO_TARGETS = {
  home_promo: ["home"],
  home_hero: ["home"],
  guest_dashboard: ["visitor_dashboard"],
  delivery: ["delivery"],
  driver_app: ["driver_dashboard"],
  store_dashboard: ["store_dashboard"],
};

const BANNER_STATUSES = [
  { id: "active", label_ar: "نشط" },
  { id: "paused", label_ar: "موقوف" },
  { id: "scheduled", label_ar: "مجدول" },
];

const BANNER_TYPES = [
  { id: "promotional", label_ar: "إعلاني" },
  { id: "awareness", label_ar: "توعوي" },
  { id: "operational", label_ar: "تشغيلي" },
  { id: "alert", label_ar: "إشعار مهم" },
];

const DISPLAY_MODES = ["auto", "carousel", "card", "strip"];

function normalizeTargetId(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!raw) return null;
  if (TARGET_BY_ID[raw]) return raw;
  if (raw === "guest_dashboard") return "visitor_dashboard";
  return null;
}

function normalizeBannerTargets(raw, legacyPlacement, legacyKind) {
  if (Array.isArray(raw)) {
    const out = [];
    raw.forEach(function (item) {
      const id = normalizeTargetId(item);
      if (id && out.indexOf(id) < 0) out.push(id);
    });
    if (out.length) return out;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return normalizeBannerTargets(Object.keys(raw).filter(function (k) {
      return raw[k];
    }));
  }
  const pl = String(legacyPlacement || "").trim();
  if (pl && LEGACY_PLACEMENT_TO_TARGETS[pl]) {
    return LEGACY_PLACEMENT_TO_TARGETS[pl].slice();
  }
  const kind = String(legacyKind || "").trim().toLowerCase();
  if (kind === "platform") return ["visitor_dashboard"];
  return ["home"];
}

function bannerHasTarget(banner, targetId) {
  const tid = normalizeTargetId(targetId);
  if (!tid || !banner) return false;
  const list = banner.banner_targets || [];
  return list.indexOf(tid) >= 0;
}

function getAdminSelectableTargets() {
  return ADMIN_BANNER_PLACEMENT_IDS.map(function (id) {
    return TARGET_BY_ID[id];
  }).filter(Boolean);
}

function getTargetMeta(id) {
  return TARGET_BY_ID[normalizeTargetId(id)] || null;
}

function normalizeBannerStatus(value) {
  const s = String(value || "active").trim().toLowerCase();
  if (s === "paused" || s === "scheduled") return s;
  return "active";
}

function normalizeBannerType(value) {
  const t = String(value || "promotional").trim().toLowerCase();
  if (t === "awareness" || t === "operational" || t === "alert") return t;
  return "promotional";
}

function normalizeDisplayMode(value) {
  const m = String(value || "auto").trim().toLowerCase();
  return DISPLAY_MODES.indexOf(m) >= 0 ? m : "auto";
}

function resolveDisplayMode(banner) {
  const mode = normalizeDisplayMode(banner && banner.display_mode);
  if (mode !== "auto") return mode;
  if (banner && String(banner.image_url || "").trim()) return "carousel";
  return "card";
}

function computeCtr(impressions, clicks) {
  const imp = Number(impressions) || 0;
  const clk = Number(clicks) || 0;
  if (imp <= 0) return 0;
  return Math.round((clk / imp) * 10000) / 100;
}

/** ترحيل placement قديم → display_mode */
function legacyPlacementToDisplayMode(placement) {
  const pl = String(placement || "").trim();
  if (pl === "home_promo") return "carousel";
  if (pl === "home_hero") return "card";
  return "auto";
}

module.exports = {
  BANNER_TARGETS,
  ADMIN_BANNER_PLACEMENT_IDS,
  BANNER_STATUSES,
  BANNER_TYPES,
  DISPLAY_MODES,
  normalizeTargetId,
  normalizeBannerTargets,
  bannerHasTarget,
  getAdminSelectableTargets,
  getTargetMeta,
  normalizeBannerStatus,
  normalizeBannerType,
  normalizeDisplayMode,
  resolveDisplayMode,
  computeCtr,
  legacyPlacementToDisplayMode,
};
