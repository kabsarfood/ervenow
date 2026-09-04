/**
 * أهداف الإطلاق التجاري الأول — ثوابت من الكود (لا يغيّرها العميل).
 * يمكن تجاوز السقف عبر بيئة LAUNCH_TARGET_* دون API عام.
 */

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getLaunchTargets() {
  return {
    customers_verified: numEnv("LAUNCH_TARGET_CUSTOMERS", 200),
    drivers_registered: numEnv("LAUNCH_TARGET_DRIVERS_REGISTERED", 27),
    drivers_ready: numEnv("LAUNCH_TARGET_DRIVERS_READY", 13),
    restaurants_ready: numEnv("LAUNCH_TARGET_RESTAURANTS", 9),
    supermarkets_ready: numEnv("LAUNCH_TARGET_SUPERMARKETS", 2),
    pharmacies_ready: numEnv("LAUNCH_TARGET_PHARMACIES", 2),
    tow_trucks_ready: numEnv("LAUNCH_TARGET_TOW", 5),
    gas_ready: numEnv("LAUNCH_TARGET_GAS", 3),
  };
}

/** أوزان المؤشر (المجموع 1.0) — موثّقة في تقرير Prelaunch */
const LAUNCH_WEIGHTS = {
  customers_verified: 0.3,
  drivers_registered: 0.08,
  drivers_ready: 0.12,
  restaurants_ready: 0.15,
  supermarkets_ready: 0.1,
  pharmacies_ready: 0.05,
  tow_trucks_ready: 0.1,
  gas_ready: 0.05,
  technical: 0.05,
};

module.exports = { getLaunchTargets, LAUNCH_WEIGHTS };
