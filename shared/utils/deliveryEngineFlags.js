/**
 * ERVENOW DELIVERY ENGINE 1.0 — feature flags (env, default off in production until enabled).
 */

function envTruthy(name) {
  const v = String(process.env[name] || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isDeliveryEnginePolicyEnabled() {
  return envTruthy("DELIVERY_ENGINE_POLICY");
}

function isDeliveryEnginePrecartEnabled() {
  return envTruthy("DELIVERY_ENGINE_PRECART");
}

function isDeliveryEngineCheckoutEnabled() {
  return envTruthy("DELIVERY_ENGINE_CHECKOUT");
}

function isDeliveryEngineStoreOtpEnabled() {
  return envTruthy("DELIVERY_ENGINE_STORE_OTP");
}

/** أي جزء من المحرك مفعّل */
function isDeliveryEngineActive() {
  return (
    isDeliveryEnginePolicyEnabled() ||
    isDeliveryEnginePrecartEnabled() ||
    isDeliveryEngineCheckoutEnabled() ||
    isDeliveryEngineStoreOtpEnabled()
  );
}

module.exports = {
  isDeliveryEnginePolicyEnabled,
  isDeliveryEnginePrecartEnabled,
  isDeliveryEngineCheckoutEnabled,
  isDeliveryEngineStoreOtpEnabled,
  isDeliveryEngineActive,
};
