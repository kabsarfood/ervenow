require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const path = require("path");
const morgan = require("morgan");
const cors = require("cors");

const coreRoutes = require("../apps/core/routes");
const deliveryRoutes = require("../apps/delivery/routes");
const foodRoutes = require("../apps/food/routes");
const marketRoutes = require("../apps/market/routes");
const servicesRoutes = require("../apps/services/routes");
const financeRoutes = require("../apps/finance/routes");
const storeRoutes = require("../apps/store/routes");

const PORT = process.env.PORT || 4000;
const publicPath = path.join(__dirname, "..", "public");
const isProd = process.env.NODE_ENV === "production";

/** أسماء مقاطع مسموحة تبدأ بنقطة (معايير عامة مثل ACME) */
const DOT_SEGMENT_ALLOW = new Set([".well-known"]);

/**
 * منع محاولات الوصول إلى ملفات/مجلدات حساسة (.env، .git، مسارات تبدأ بنقطة، ..)
 */
function blockSensitiveAccess(req, res, next) {
  let urlPath = (req.originalUrl || req.url || "").split("?")[0];
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    return res.status(404).end();
  }
  const lower = urlPath.toLowerCase();
  if (lower.includes(".env") || lower.includes(".git")) {
    return res.status(404).end();
  }
  const segments = urlPath.split("/");
  for (const seg of segments) {
    if (seg === "..") return res.status(404).end();
    if (!seg) continue;
    if (seg.startsWith(".") && !DOT_SEGMENT_ALLOW.has(seg.toLowerCase())) {
      return res.status(404).end();
    }
  }
  next();
}

const app = express();
app.disable("x-powered-by");

app.use(blockSensitiveAccess);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "12mb" }));
app.use(isProd ? morgan("tiny") : morgan("dev"));

/* ——— API Gateway ——— */
app.use("/api/core", coreRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/store", storeRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "ERWENOW Platform Core",
    routes: ["/api/core", "/api/delivery", "/api/food", "/api/market", "/api/services", "/api/finance", "/api/store"],
  });
});

/* ——— واجهة ثابتة ——— المجلد public فقط؛ لا تُقدَّم الملفات المخفية ——— */
app.use(
  express.static(publicPath, {
    dotfiles: "deny",
    index: false,
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(publicPath, "login.html"));
});

app.get("/register-store", (_req, res) => {
  res.sendFile(path.join(publicPath, "register-store.html"));
});

app.get("/driver", (_req, res) => {
  res.sendFile(path.join(publicPath, "driver.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});

app.get("/track", (_req, res) => {
  res.sendFile(path.join(publicPath, "track.html"));
});

app.get("/order", (_req, res) => {
  res.sendFile(path.join(publicPath, "order.html"));
});

app.use((_req, res) => {
  res.status(404).end();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (isProd) {
    return res.status(500).end();
  }
  res.status(500).json({ ok: false, error: err.message || "error" });
});

const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log("🚀 ERVENOW LIVE ON RAILWAY");
  console.log("ERVENOW RUNNING ON", PORT);
  console.log(`ERWENOW Platform Core → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(
    "Gateway: /api/core | /api/delivery | /api/food | /api/market | /api/services | /api/finance"
  );
});
