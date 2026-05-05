const { readState } = require("../utils/siteMaintenanceStore");

const ADMIN_UI_PREFIXES = ["/admin-login", "/admin-dashboard", "/admin-finance", "/admin-approvals"];

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>تحت التطوير | ERVENOW</title>
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
<h1>تحت التطوير</h1>
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
  if (!readState()) return false;
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

module.exports = { createSiteMaintenanceMiddleware };
