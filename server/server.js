require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const path = require("path");
const fs = require("fs");
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
const { startRetryNotificationsWorker } = require("../apps/driver/retryNotifications");
const { createServiceClient } = require("../shared/config/supabase");
const { register, metrics } = require("../shared/utils/metrics");
const { logger } = require("../shared/utils/logger");
const { pingRedis } = require("../queues/deliveryQueue");

const PORT = process.env.PORT || 4000;
const publicPath = path.join(__dirname, "..", "public");
const isProd = process.env.NODE_ENV === "production";
/** SERVE_STATIC=1 يفرض تقديم الواجهة. عند SERVE_STATIC=0 يُقدَّم public/ تلقائياً إن وُجد index.html (حل نطاق يشير للـ API مثل ervenow.com). عطّل الواجهة بـ HIDE_PUBLIC_UI=1 */
const serveStatic = process.env.SERVE_STATIC === "1";
let hasPublicIndex = false;
try {
  hasPublicIndex = fs.existsSync(path.join(publicPath, "index.html"));
} catch (_) {
  hasPublicIndex = false;
}
const hidePublicUi = String(process.env.HIDE_PUBLIC_UI || "").trim() === "1";
const servePublicUi = serveStatic || (hasPublicIndex && !hidePublicUi);

function getCorsAllowedOrigins() {
  const raw = String(process.env.CORS_ORIGINS || "").trim();
  if (!raw) {
    return [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ];
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const corsAllowedOrigins = getCorsAllowedOrigins();

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

function isMissingUsersStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

async function assertRequiredSchema() {
  const sb = createServiceClient();
  if (!sb) return;
  const probe = await sb.from("users").select("id, status").limit(1);
  if (probe.error && isMissingUsersStatusColumnError(probe.error)) {
    throw new Error(
      "Missing required column public.users.status. Run shared/migration_users_status.sql before starting server."
    );
  }
  if (probe.error) {
    const err = probe.error;
    const msg = err.message || String(err);
    const cause = err.cause;
    const causeMsg = cause && (cause.message || cause.code || String(cause));
    if (/fetch failed/i.test(msg) || causeMsg) {
      console.warn(
        "[schema-check] تعذّر الاتصال بـ Supabase أثناء الفحص:",
        msg,
        causeMsg ? `(سبب: ${causeMsg})` : "",
        "— تحقق من SUPABASE_URL والإنترنت؛ على Windows جرّب أيضاً تعطيل VPN/جدار ناري للاختبار."
      );
    } else {
      console.warn("[schema-check] users status probe warning:", msg);
    }
  }
}

app.use(blockSensitiveAccess);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsAllowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Source", "Idempotency-Key"],
  })
);
app.use(express.json({ limit: "12mb" }));
app.use(isProd ? morgan("tiny") : morgan("dev"));

app.use((req, res, next) => {
  const p = req.path || "";
  if (p === "/api/internal/metrics") return next();
  const t0 = Date.now();
  res.on("finish", () => {
    try {
      metrics.observeApiRequest(req.method, req.path || req.url, res.statusCode, Date.now() - t0);
      logger.info(
        {
          route: (req.originalUrl || req.url || "").split("?")[0],
          method: req.method,
          status: res.statusCode,
          ms: Date.now() - t0,
          userId: req.appUser && req.appUser.id ? req.appUser.id : undefined,
        },
        "http_request"
      );
    } catch (_) {
      /* ignore */
    }
  });
  next();
});

/* ——— API Gateway ——— (قبل الملفات الثابتة وقبل معالج 404) */
/** تشخيص إنتاج: يتجاوز mounted router — إن نجح، التطبيق الصحيح يستمع و /api/core يصل */
app.get("/api/core/test", (_req, res) => {
  res.json({ ok: true, route: "core-test-working" });
});

if (String(process.env.METRICS_ENABLED || "").trim() === "1") {
  app.get("/api/internal/metrics", async (_req, res) => {
    try {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch (_e) {
      res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    }
  });
}

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

/** فحص عميق للمراقبة والنشر — لا يعرّي أسرارًا */
app.get("/api/health/full", async (_req, res) => {
  const result = { ok: true, services: {} };

  const sb = createServiceClient();
  if (!sb) {
    result.services.supabase = "fail";
    result.ok = false;
  } else {
    const probe = await sb.from("users").select("id").limit(1);
    result.services.supabase = probe.error ? "fail" : "ok";
    if (probe.error) result.ok = false;
  }

  const redisPing = await pingRedis();
  if (redisPing.skipped) {
    result.services.redis = "skipped";
  } else {
    result.services.redis = redisPing.ok ? "ok" : "fail";
    if (!redisPing.ok) result.ok = false;
  }

  res.status(result.ok ? 200 : 503).json(result);
});

/** عند عدم تقديم الواجهة يبقى الجذر JSON لمراقبة Railway دون كسر الفحص */
if (!servePublicUi) {
  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "ervenow-api",
      health: "/api/health",
      note: "API-only — لا يوجد public/index.html أو مفعّل HIDE_PUBLIC_UI=1",
    });
  });
}

/* ——— واجهة ثابتة ——— عند SERVE_STATIC=1 أو عند وجود public/ وعدم HIDE_PUBLIC_UI ——— */
if (servePublicUi) {
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  app.use(
    express.static(publicPath, {
      dotfiles: "deny",
      index: false,
    })
  );

  app.get("/login", (_req, res) => {
    res.sendFile(path.join(publicPath, "login.html"));
  });

  app.get("/register-store", (_req, res) => {
    res.sendFile(path.join(publicPath, "register-store.html"));
  });

  app.get("/careers", (_req, res) => {
    res.sendFile(path.join(publicPath, "careers.html"));
  });

  app.get("/driver", (_req, res) => {
    res.sendFile(path.join(publicPath, "driver.html"));
  });

  app.get("/driver-login", (_req, res) => {
    res.sendFile(path.join(publicPath, "driver-login.html"));
  });

  app.get("/driver-register", (_req, res) => {
    res.sendFile(path.join(publicPath, "driver-register.html"));
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

  app.get("/admin-login", (_req, res) => {
    res.sendFile(path.join(publicPath, "admin-login.html"));
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

  app.get("/store", (_req, res) => {
    res.sendFile(path.join(publicPath, "store.html"));
  });

  app.get("/store-dashboard", (_req, res) => {
    res.sendFile(path.join(publicPath, "store-dashboard.html"));
  });

  app.get("/cart", (_req, res) => {
    res.sendFile(path.join(publicPath, "cart.html"));
  });

  app.get("/services-provider", (_req, res) => {
    res.sendFile(path.join(publicPath, "services-provider.html"));
  });

  app.get("/blocked-complaints", (_req, res) => {
    res.sendFile(path.join(publicPath, "blocked-complaints.html"));
  });
  app.get("/wallet", (_req, res) => {
    res.sendFile(path.join(publicPath, "wallet.html"));
  });
} else {
  if (hasPublicIndex && hidePublicUi) {
    console.warn("[boot] HIDE_PUBLIC_UI=1 — الجذر / يعيد JSON فقط (وضع API)");
  } else {
    console.warn("[boot] لا يوجد public/index.html — وضع API فقط");
  }
}

app.use((_req, res) => {
  res.status(404).end();
});

app.use((err, _req, res, _next) => {
  if (err && String(err.message || "") === "CORS blocked") {
    return res.status(403).json({ ok: false, error: "CORS_BLOCKED" });
  }
  logger.error({ err: err && (err.message || String(err)) }, "express_error");
  if (isProd) {
    return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
  }
  res.status(500).json({ ok: false, error: err.message || "error" });
});

(async function boot() {
  try {
    await assertRequiredSchema();
    app.listen(PORT, "0.0.0.0", () => {
      console.log("🚀 ERVENOW RUNNING ON", PORT);
      if (servePublicUi && !serveStatic) {
        console.log(
          "[boot] تقديم الواجهة من public/ رغم SERVE_STATIC≠1 — للـ API فقط على / عيّن HIDE_PUBLIC_UI=1"
        );
      }
      if (!serveStatic && isProd && !String(process.env.CORS_ORIGINS || "").trim()) {
        console.warn(
          "[boot] أنصح بتعريف CORS_ORIGINS على Railway (نطاق Vercel مفصول بفواصل) وإلا المتصفح قد يمنع طلبات API."
        );
      }
    });
    startRetryNotificationsWorker();
  } catch (e) {
    console.error("[boot] schema check failed:", e && (e.message || e));
    process.exit(1);
  }
})();

module.exports = { pushToErvenow };
