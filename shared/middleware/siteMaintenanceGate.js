const siteMaintenanceStore = require("../utils/siteMaintenanceStore");

const ADMIN_UI_PREFIXES = ["/admin-login", "/admin-dashboard", "/admin-finance", "/admin-approvals", "/admin/branding"];

function parseHostnameFromHeader(value) {
  const raw = String(value || "")
    .trim()
    .split(",")[0]
    .trim();
  if (!raw) return "";
  const bracket = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return bracket[1].toLowerCase();
  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) {
    const idx = raw.lastIndexOf(":");
    const hostPart = raw.slice(0, idx);
    const portPart = raw.slice(idx + 1);
    if (/^\d+$/.test(portPart)) return hostPart.toLowerCase();
  }
  if (colonCount > 1) return raw.toLowerCase();
  return raw.toLowerCase();
}

/** مضيفات الطلب (Host / X-Forwarded-Host / req.hostname) */
function getRequestHostnames(req) {
  const names = new Set();
  const host = parseHostnameFromHeader(req && req.headers && req.headers.host);
  const xfHost = parseHostnameFromHeader(req && req.headers && req.headers["x-forwarded-host"]);
  const fromReq = parseHostnameFromHeader(req && req.hostname);
  [host, xfHost, fromReq].filter(Boolean).forEach((h) => names.add(h));
  return [...names];
}

/** بيئة تطوير محلية — لا يُطبَّق عليها وضع الصيانة أبداً */
function isDevelopmentHost(hostname) {
  const h = parseHostnameFromHeader(hostname);
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  if (h.endsWith(".local")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/** نطاقات الإنتاج التي يُطبَّق عليها «تعطيل الموقع» — localhost مستثنى دائماً */
function getMaintenanceHostnames() {
  const raw = String(process.env.SITE_MAINTENANCE_HOSTS || "").trim().toLowerCase();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().split(":")[0])
      .filter(Boolean);
  }
  try {
    const u = new URL(String(process.env.ERVENOW_PUBLIC_URL || "").trim());
    const h = u.hostname.toLowerCase();
    if (h && h !== "localhost" && h !== "127.0.0.1") {
      const apex = h.startsWith("www.") ? h.slice(4) : h;
      const www = h.startsWith("www.") ? h : `www.${h}`;
      return [...new Set([h, apex, www].filter(Boolean))];
    }
  } catch (_) {
    /* ignore */
  }
  return ["ervenow.com", "www.ervenow.com"];
}

function isMaintenanceHostname(hostname) {
  const h = parseHostnameFromHeader(hostname);
  if (!h || isDevelopmentHost(h)) return false;
  const list = getMaintenanceHostnames();
  return list.some((x) => x === h);
}

/** الطلب يستهدف نطاق إنتاج (وليس بيئة تطوير محلية) */
function maintenanceActiveForRequest(req) {
  const hosts = getRequestHostnames(req);
  if (!hosts.length) return false;
  if (hosts.some(isDevelopmentHost)) return false;
  return hosts.some(isMaintenanceHostname);
}

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>المنصة تحت التطوير والصيانة | ERVENOW</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
font-family:Cairo,sans-serif;background:linear-gradient(160deg,#f8f4ef 0%,#e8ddd2 100%);color:#2b1f16}
.box{text-align:center;padding:32px 28px;max-width:420px}
h1{font-size:1.75rem;font-weight:800;color:#5b371d;margin:0 0 12px}
p{margin:0;font-size:1.05rem;color:#6f5441;line-height:1.6}
mark{background:transparent;color:#5b371d;font-weight:700}
</style>
</head>
<body>
<div class="box">
<h1>المنصة تحت التطوير والصيانة</h1>
<p>نعمل على تحسين المنصة. نعتذر عن الإزعاج ونعود قريباً.</p>
</div>
</body>
</html>`;

function pathAllowedDuringMaintenance(p) {
  const lower = String(p || "").split("?")[0].toLowerCase();
  for (const prefix of ADMIN_UI_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + "/")) return true;
  }
  if (/\.[a-z0-9]{2,8}$/i.test(lower)) return true;
  return false;
}

function shouldBlockPublicPage(req) {
  const m = req.method;
  if (m !== "GET" && m !== "HEAD") return false;
  if (!siteMaintenanceStore.readState()) return false;
  if (!maintenanceActiveForRequest(req)) return false;
  const rawPath = String(req.path || "").split("?")[0];
  const lower = rawPath.toLowerCase();
  if (lower.startsWith("/api/")) return false;
  if (lower.startsWith("/socket.io")) return false;
  if (pathAllowedDuringMaintenance(rawPath)) return false;
  return true;
}

function createSiteMaintenanceMiddleware(servePublicUi) {
  return function siteMaintenanceMiddleware(req, res, next) {
    if (!servePublicUi) return next();
    if (!shouldBlockPublicPage(req)) return next();
    res.status(503);
    res.setHeader("Retry-After", "3600");
    res.type("html").send(MAINTENANCE_HTML);
  };
}

module.exports = {
  createSiteMaintenanceMiddleware,
  getMaintenanceHostnames,
  getRequestHostnames,
  isDevelopmentHost,
  isMaintenanceHostname,
  maintenanceActiveForRequest,
  shouldBlockPublicPage,
};
