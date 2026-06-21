/** أسعار الخدمات المنزلية (ريال سعودي) — مصدر موحّد للواجهة والـ API */
const INSPECTION_FEE_SAR = 60;

const SERVICE_IMG_BASE = "/assets/services";

const HOME_SERVICE_CATALOG = {
  car_polishing: {
    label: "تلميع المركبات",
    image: "/assets/ervenow-car-sedan.png",
    price: 280,
    priceLabel: "من 280 ريال",
    payAfterDiagnosis: false,
    inspectionOnly: false,
    fixedPrice: true,
    agreement: false,
    desc: "تلميع وتنظيف المركبات في موقع العميل — السعر حسب نوع المركبة والإضافات.",
  },
  plumber: {
    label: "سباك",
    image: SERVICE_IMG_BASE + "/plumber.png",
    price: INSPECTION_FEE_SAR,
    priceLabel: "60 ريال معاينة وتقييم",
    payAfterDiagnosis: true,
    inspectionOnly: true,
    fixedPrice: false,
    agreement: false,
    desc: "معاينة وتقييم الأعطال — يُحسب الإصلاح لاحقاً عند رغبة العميل.",
  },
  electrician: {
    label: "كهربائي",
    image: SERVICE_IMG_BASE + "/electrician.png",
    price: INSPECTION_FEE_SAR,
    priceLabel: "60 ريال معاينة وتقييم",
    payAfterDiagnosis: true,
    inspectionOnly: true,
    fixedPrice: false,
    agreement: false,
    desc: "معاينة وتقييم الأعطال الكهربائية — الإصلاح يُحسب عند الموافقة.",
  },
  ac_technician: {
    label: "فني مكيفات",
    image: SERVICE_IMG_BASE + "/ac_technician.png",
    price: INSPECTION_FEE_SAR,
    priceLabel: "60 ريال معاينة وتقييم",
    payAfterDiagnosis: true,
    inspectionOnly: true,
    fixedPrice: false,
    agreement: false,
    desc: "معاينة وتقييم أعطال المكيف — الإصلاح يُحسب عند الموافقة.",
  },
  agricultural_engineer: {
    label: "مهندس زراعي",
    image: SERVICE_IMG_BASE + "/agricultural_engineer.png",
    price: INSPECTION_FEE_SAR,
    priceLabel: "60 ريال معاينة وتقييم",
    payAfterDiagnosis: true,
    inspectionOnly: true,
    fixedPrice: false,
    agreement: false,
    desc: "معاينة الموقع والنباتات — التنفيذ والتسعير حسب الاتفاق.",
  },
  laundry_estates: {
    label: "مغسل فلل وعمائر",
    image: SERVICE_IMG_BASE + "/cleaning_villa.png",
    price: INSPECTION_FEE_SAR,
    priceLabel: "حسب نوع العقار",
    payAfterDiagnosis: false,
    inspectionOnly: false,
    fixedPrice: false,
    agreement: true,
    desc: "غسيل فلل وعمائر — يُحدد السعر بعد المعاينة أو حسب نوع العقار.",
  },
  cleaning_villa: {
    label: "غسيل درج فيلا",
    image: SERVICE_IMG_BASE + "/cleaning_villa.png",
    price: 60,
    priceLabel: "60 ريال ثابت",
    payAfterDiagnosis: false,
    inspectionOnly: false,
    fixedPrice: true,
    agreement: false,
    desc: "غسيل درج فيلا — سعر ثابت.",
  },
  cleaning_building: {
    label: "غسيل درج عمارة",
    image: SERVICE_IMG_BASE + "/cleaning_building.png",
    price: 120,
    priceLabel: "120 ريال (3 أدوار)",
    payAfterDiagnosis: false,
    inspectionOnly: false,
    fixedPrice: true,
    agreement: false,
    desc: "غسيل درج عمارة حتى 3 أدوار — سعر ثابت.",
  },
};

/** توافق مع الروابط القديمة */
HOME_SERVICE_CATALOG.cleaning = HOME_SERVICE_CATALOG.cleaning_villa;

const HOME_SERVICE_TYPES = new Set(Object.keys(HOME_SERVICE_CATALOG));

function normalizeServiceType(t) {
  const key = String(t || "").trim().toLowerCase();
  if (key === "cleaning") return "cleaning_villa";
  if (key === "nursery") return "agricultural_engineer";
  return key;
}

function isHomeServiceType(t) {
  const key = normalizeServiceType(t);
  return HOME_SERVICE_TYPES.has(key);
}

function catalogEntry(type) {
  return HOME_SERVICE_CATALOG[normalizeServiceType(type)] || null;
}

function computeHomeServiceTotal(type) {
  const entry = catalogEntry(type);
  if (!entry) return 0;
  return Math.max(0, Number(entry.price) || 0);
}

function serviceDisplayName(type) {
  const e = catalogEntry(type);
  return e ? e.label : type || "خدمة";
}

module.exports = {
  INSPECTION_FEE_SAR,
  HOME_SERVICE_CATALOG,
  HOME_SERVICE_TYPES,
  normalizeServiceType,
  isHomeServiceType,
  catalogEntry,
  computeHomeServiceTotal,
  serviceDisplayName,
};
