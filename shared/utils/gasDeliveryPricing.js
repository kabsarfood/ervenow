/** تسعير توصيل الغاز — أسطوانات وتعبئة مركزية */

const GAS_CYLINDER_PROVIDER_NET = 37;
const GAS_CYLINDER_PLATFORM_FEE = 2;
/** سعر العميل للأسطوانة = 37 مزود + 2 منصة */
const GAS_CYLINDER_CUSTOMER_UNIT = GAS_CYLINDER_PROVIDER_NET + GAS_CYLINDER_PLATFORM_FEE;

/** توافق قديم — سعر أسطوانة واحدة للعميل */
const CYLINDER_PRICE_ONE = GAS_CYLINDER_CUSTOMER_UNIT;
/** سعر أسطوانتين للعميل (بدون خصم — نفس الآلية خطية) */
const CYLINDER_PRICE_TWO = GAS_CYLINDER_CUSTOMER_UNIT * 2;

const CENTRAL_PRICE_PER_LITER = 0.9;
const CENTRAL_LITERS = [250, 500, 1000, 2000, 3000, 4000];

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function normalizeCylinderQty(qtyRaw) {
  return Math.max(1, Math.min(10, Math.floor(Number(qtyRaw) || 1)));
}

function priceCylinderSwap(qtyRaw) {
  const qty = normalizeCylinderQty(qtyRaw);
  return roundMoney(qty * GAS_CYLINDER_CUSTOMER_UNIT);
}

function priceCentralRefill(litersRaw) {
  const liters = Number(litersRaw);
  if (!CENTRAL_LITERS.includes(liters)) return 0;
  return roundMoney(liters * CENTRAL_PRICE_PER_LITER);
}

function computeGasCylinderPlatformFee(qtyRaw) {
  return roundMoney(normalizeCylinderQty(qtyRaw) * GAS_CYLINDER_PLATFORM_FEE);
}

function computeGasPlatformCommission(gasMode, qtyRaw, _litersRaw, totalAmount) {
  const mode = String(gasMode || "cylinder_swap").trim().toLowerCase();
  if (mode === "central_refill" || mode === "bulk") {
    const { computePlatformCommission } = require("./platformCommission");
    return computePlatformCommission(totalAmount);
  }
  return computeGasCylinderPlatformFee(qtyRaw);
}

function gasCylinderProviderNet(qtyRaw, _totalAmount) {
  return roundMoney(normalizeCylinderQty(qtyRaw) * GAS_CYLINDER_PROVIDER_NET);
}

function gasCommissionLabel(gasMode) {
  const mode = String(gasMode || "cylinder_swap").trim().toLowerCase();
  if (mode === "central_refill" || mode === "bulk") {
    const { commissionPercentLabel } = require("./platformCommission");
    return commissionPercentLabel();
  }
  return `${GAS_CYLINDER_PLATFORM_FEE} ر.س / أسطوانة`;
}

function gasServiceLabel(gasMode) {
  if (gasMode === "central_refill") return "تعبئة غاز مركزي";
  return "تبديل اسطوانة غاز";
}

function gasModeFromBody(b) {
  const mode = String((b && b.gas_mode) || "").trim().toLowerCase();
  if (mode === "central_refill" || mode === "2") return "central_refill";
  return "cylinder_swap";
}

function computeGasTotal(gasMode, qty, liters) {
  if (gasMode === "central_refill") return priceCentralRefill(liters);
  return priceCylinderSwap(qty);
}

function googleMapsUrl(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

module.exports = {
  GAS_CYLINDER_PROVIDER_NET,
  GAS_CYLINDER_PLATFORM_FEE,
  GAS_CYLINDER_CUSTOMER_UNIT,
  CYLINDER_PRICE_ONE,
  CYLINDER_PRICE_TWO,
  CENTRAL_PRICE_PER_LITER,
  CENTRAL_LITERS,
  roundMoney,
  normalizeCylinderQty,
  priceCylinderSwap,
  priceCentralRefill,
  computeGasCylinderPlatformFee,
  computeGasPlatformCommission,
  gasCylinderProviderNet,
  gasCommissionLabel,
  gasServiceLabel,
  gasModeFromBody,
  computeGasTotal,
  googleMapsUrl,
};
