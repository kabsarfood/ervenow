require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const path = require("path");
const morgan = require("morgan");
const cors = require("cors");

/** من مجلد server/: المسار إلى التطبيقات هو ../apps/… (وليس ./apps لأنه تحت server/) */
const coreRoutes = require("../apps/core/routes");
const deliveryRoutes = require("../apps/delivery/routes");
const foodRoutes = require("../apps/food/routes");
const marketRoutes = require("../apps/market/routes");
const servicesRoutes = require("../apps/services/routes");
const financeRoutes = require("../apps/finance/routes");
const checkoutRoutes = require("../apps/checkout/routes");
const storeRoutes = require("../apps/store/routes");
const driverRoutes = require("../apps/driver/routes");
const walletRoutes = require("../apps/wallet/routes");
const adminRoutes = require("../apps/admin/routes");
const invoiceRoutes = require("../apps/invoice/routes");
const { pushToErvenow } = require("../shared/utils/ervenowPush");

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

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Source"],
  })
);
app.use(express.json({ limit: "12mb" }));
app.use(isProd ? morgan("tiny") : morgan("dev"));

/* ——— API Gateway ——— (قبل الملفات الثابتة وقبل معالج 404) */
/** تشخيص إنتاج: يتجاوز mounted router — إن نجح، التطبيق الصحيح يستمع و /api/core يصل */
app.get("/api/core/test", (_req, res) => {
  res.json({ ok: true, route: "core-test-working" });
});

app.use("/api/core", coreRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/store", storeRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/invoice", invoiceRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "ERVENOW Platform Core",
    routes: [
      "/api/core",
      "/api/delivery",
      "/api/driver",
      "/api/wallet",
      "/api/admin",
      "/api/food",
      "/api/market",
      "/api/services",
      "/api/finance",
      "/api/checkout",
      "/api/store",
      "/api/invoice",
    ],
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

app.get("/driver-login", (_req, res) => {
  res.sendFile(path.join(publicPath, "driver-login.html"));
});

app.get("/driver-dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "driver-dashboard.html"));
});

app.get("/driver-wallet", (_req, res) => {
  res.sendFile(path.join(publicPath, "driver-wallet.html"));
});

app.get("/orders", (_req, res) => {
  res.sendFile(path.join(publicPath, "orders.html"));
});

app.get("/admin-finance", (_req, res) => {
  res.sendFile(path.join(publicPath, "admin-finance.html"));
});

app.get("/admin-approvals", (_req, res) => {
  res.sendFile(path.join(publicPath, "admin-approvals.html"));
});

app.get("/admin-dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "admin-dashboard.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});

app.get("/start-now", (_req, res) => {
  res.sendFile(path.join(publicPath, "start-now.html"));
});

app.get("/track", (_req, res) => {
  res.sendFile(path.join(publicPath, "track.html"));
});

app.get("/order", (_req, res) => {
  res.sendFile(path.join(publicPath, "order.html"));
});

app.get("/browse", (_req, res) => {
  res.sendFile(path.join(publicPath, "browse.html"));
});

app.get("/cart", (_req, res) => {
  res.sendFile(path.join(publicPath, "cart.html"));
});

app.get("/services-provider", (_req, res) => {
  res.sendFile(path.join(publicPath, "services-provider.html"));
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

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 ERVENOW RUNNING ON", PORT);
});

module.exports.pushToErvenow = pushToErvenow;
