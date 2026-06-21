/** تسعير توصيل الغاز — أسطوانات وتعبئة مركزية */

/** سعر العميل للأسطوانة الواحدة (تبديل) */
const GAS_CYLINDER_CUSTOMER_UNIT = 38;

/** توافق قديم — سعر أسطوانة واحدة للعميل */
const CYLINDER_PRICE_ONE = GAS_CYLINDER_CUSTOMER_UNIT;
/** سعر أسطوانتين للعميل (بدون خصم — نفس الآلية خطية) */
const CYLINDER_PRICE_TWO = GAS_CYLINDER_CUSTOMER_UNIT * 2;

const CENTRAL_PRICE_PER_LITER = 1;
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

function computeGasPlatformCommission(_gasMode, _qtyRaw, _litersRaw, totalAmount) {
  const { computePlatformCommission } = require("./platformCommission");
  return computePlatformCommission(totalAmount);
}

/** عمولة المنصة لأسطوانة واحدة — 7% من 38 ر.س */
function computeGasCylinderPlatformFee(qtyRaw) {
  return computeGasPlatformCommission("cylinder_swap", qtyRaw, null, priceCylinderSwap(qtyRaw));
}

function gasCylinderProviderNet(qtyRaw, totalAmount) {
  const total = roundMoney(Number(totalAmount) > 0 ? Number(totalAmount) : priceCylinderSwap(qtyRaw));
  const commission = computeGasPlatformCommission("cylinder_swap", qtyRaw, null, total);
  return roundMoney(Math.max(0, total - commission));
}

function gasCommissionLabel(_gasMode) {
  const { commissionPercentLabel } = require("./platformCommission");
  return commissionPercentLabel();
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

/** حصة مزود أسطوانة واحدة بعد عمولة 7% — للتوافق مع API */
const GAS_CYLINDER_PLATFORM_FEE = computeGasCylinderPlatformFee(1);
const GAS_CYLINDER_PROVIDER_NET = gasCylinderProviderNet(1, GAS_CYLINDER_CUSTOMER_UNIT);

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
