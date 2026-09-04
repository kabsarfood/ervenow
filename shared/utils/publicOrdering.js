/**
 * Kill switch للطلبات التجارية العامة.
 *
 * SoT:
 * - PUBLIC_ORDERING_ENABLED=false|0|off  → دائماً مغلق (قطع طوارئ، يتفوق على ملف الأدمن)
 * - PUBLIC_ORDERING_ENABLED=true|1|on   → مفتوح (قفل تشغيلي مفتوح)
 * - غير معيّن: ملف data/public-ordering.json (افتراضي false) — تبديل أدمن مع تأكيد
 *
 * لا يفتح الطلبات تلقائياً عند اكتمال العداد.
 */

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "..", "data", "public-ordering.json");

function parseTriState(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return null;
}

function readAdminFile() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const j = JSON.parse(raw);
    return parseTriState(j && j.enabled);
  } catch {
    return null;
  }
}

function isPublicOrderingEnabled() {
  const env = parseTriState(process.env.PUBLIC_ORDERING_ENABLED);
  if (env === false) return false;
  if (env === true) return true;
  const file = readAdminFile();
  if (file === true) return true;
  return false;
}

function getPublicOrderingState() {
  const env = parseTriState(process.env.PUBLIC_ORDERING_ENABLED);
  const file = readAdminFile();
  const enabled = isPublicOrderingEnabled();
  return {
    enabled,
    source: env != null ? "env" : file != null ? "admin_file" : "default_off",
    env_lock: env,
    auto_launch: false,
  };
}

function writePublicOrderingFile(enabled, actor) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    enabled: !!enabled,
    updated_at: new Date().toISOString(),
    updated_by: actor ? String(actor).slice(0, 80) : null,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function isInternalOrderingAllowed(req) {
  const role = String((req && req.appUser && req.appUser.role) || "").toLowerCase();
  return role === "admin";
}

const SERVICE_NOT_LAUNCHED = "SERVICE_NOT_LAUNCHED";
const SERVICE_NOT_LAUNCHED_AR =
  "التسجيل مفتوح — الطلبات التجارية لم تُطلق بعد. سنبلغك عند بدء الخدمة.";

module.exports = {
  isPublicOrderingEnabled,
  getPublicOrderingState,
  writePublicOrderingFile,
  isInternalOrderingAllowed,
  SERVICE_NOT_LAUNCHED,
  SERVICE_NOT_LAUNCHED_AR,
  parseTriState,
};
