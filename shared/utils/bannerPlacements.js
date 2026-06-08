/**
 * أماكن عرض البنرات — قابلة للتوسع (صفحات جديدة لاحقاً).
 * كل placement مستقل شكلاً ومضموناً عن غيره.
 */
const BANNER_PLACEMENTS = [
  {
    id: "home_promo",
    label_ar: "الصفحة الرئيسية — شريط المناسبات والعروض",
    page: "/",
    render_mode: "carousel",
    admin_selectable: true,
    image_required: false,
    hint_ar: "شريط شرائح تحت الهيدر — للمناسبات والعروض الموسمية.",
  },
  {
    id: "home_hero",
    label_ar: "الصفحة الرئيسية — بطاقة الترحيب",
    page: "/",
    render_mode: "card",
    admin_selectable: true,
    image_required: false,
    hint_ar: "البطاقة تحت الشريط — رسالة المنصة للزائر على الرئيسية.",
  },
  {
    id: "guest_dashboard",
    label_ar: "لوحة الزائر",
    page: "/dashboard",
    render_mode: "card",
    admin_selectable: true,
    image_required: false,
    hint_ar: "بنر مستقل في /dashboard — لا يتأثر ببنرات الرئيسية.",
  },
  {
    id: "delivery",
    label_ar: "صفحة التوصيل",
    page: "/delivery-map",
    render_mode: "card",
    admin_selectable: false,
    image_required: false,
    hint_ar: "قريباً — بنر صفحة التوصيل.",
  },
  {
    id: "driver_app",
    label_ar: "تطبيق المناديب",
    page: "/driver-app",
    render_mode: "card",
    admin_selectable: false,
    image_required: false,
    hint_ar: "قريباً — بنر لوحة المندوب.",
  },
  {
    id: "store_dashboard",
    label_ar: "لوحة المتجر",
    page: "/store-dashboard",
    render_mode: "card",
    admin_selectable: false,
    image_required: false,
    hint_ar: "قريباً — بنر لوحة التاجر.",
  },
];

const PLACEMENT_BY_ID = Object.fromEntries(BANNER_PLACEMENTS.map(function (p) {
  return [p.id, p];
}));

const DEFAULT_PLACEMENT = "home_promo";

/** ترحيل banner_kind القديم */
const LEGACY_KIND_TO_PLACEMENT = {
  promo: "home_promo",
  platform: "guest_dashboard",
};

function normalizePlacement(value, legacyKind) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw && PLACEMENT_BY_ID[raw]) return raw;
  const fromLegacy = LEGACY_KIND_TO_PLACEMENT[String(legacyKind || "").trim().toLowerCase()];
  if (fromLegacy) return fromLegacy;
  return DEFAULT_PLACEMENT;
}

function placementToLegacyKind(placement) {
  return placement === "home_promo" ? "promo" : "platform";
}

function getAdminSelectablePlacements() {
  return BANNER_PLACEMENTS.filter(function (p) {
    return p.admin_selectable === true;
  });
}

function getPlacementMeta(id) {
  return PLACEMENT_BY_ID[id] || null;
}

module.exports = {
  BANNER_PLACEMENTS,
  DEFAULT_PLACEMENT,
  normalizePlacement,
  placementToLegacyKind,
  getAdminSelectablePlacements,
  getPlacementMeta,
};
