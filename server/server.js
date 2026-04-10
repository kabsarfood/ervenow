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

const PORT = Number(process.env.PORT) || 4000;
const publicPath = path.join(__dirname, "..", "public");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

/* ——— API Gateway ——— */
app.use("/api/core", coreRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/services", servicesRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    name: "ERWENOW Platform Core",
    routes: ["/api/core", "/api/delivery", "/api/food", "/api/market", "/api/services", "/api/finance"],
  });
});

/* ——— واجهة ثابتة ——— */
app.use(express.static(publicPath));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(publicPath, "login.html"));
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

app.listen(PORT, () => {
  console.log(`ERWENOW Platform Core → http://localhost:${PORT}`);
  console.log(`Gateway: /api/core | /api/delivery | /api/food | /api/market | /api/services | /api/finance`);
});
