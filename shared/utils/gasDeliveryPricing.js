/** تسعير توصيل الغاز — أسطوانات وتعبئة مركزية */

const CYLINDER_PRICE_ONE = 39;
const CYLINDER_PRICE_TWO = 75;
const CENTRAL_PRICE_PER_LITER = 0.9;
const CENTRAL_LITERS = [250, 500, 1000, 2000, 3000, 4000];

function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function priceCylinderSwap(qtyRaw) {
  const qty = Math.max(1, Math.min(10, Math.floor(Number(qtyRaw) || 1)));
  if (qty === 1) return roundMoney(CYLINDER_PRICE_ONE);
  if (qty === 2) return roundMoney(CYLINDER_PRICE_TWO);
  return roundMoney(qty * CYLINDER_PRICE_ONE);
}

function priceCentralRefill(litersRaw) {
  const liters = Number(litersRaw);
  if (!CENTRAL_LITERS.includes(liters)) return 0;
  return roundMoney(liters * CENTRAL_PRICE_PER_LITER);
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
  CYLINDER_PRICE_ONE,
  CYLINDER_PRICE_TWO,
  CENTRAL_PRICE_PER_LITER,
  CENTRAL_LITERS,
  roundMoney,
  priceCylinderSwap,
  priceCentralRefill,
  gasServiceLabel,
  gasModeFromBody,
  computeGasTotal,
  googleMapsUrl,
};
