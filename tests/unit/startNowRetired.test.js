const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");

const ROOT = path.join(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");
const SERVER_JS = path.join(ROOT, "server/server.js");

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location || "" });
      })
      .on("error", reject);
  });
}

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        const out = await fn(port);
        server.close(() => resolve(out));
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

describe("customer /start-now retired", () => {
  test("start-now.html and exclusive CSS are gone", () => {
    expect(fs.existsSync(path.join(PUBLIC, "start-now.html"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "ervenow-frontend", "start-now.html"))).toBe(false);
    expect(fs.existsSync(path.join(PUBLIC, "assets/start-now-page.css"))).toBe(false);
    expect(fs.existsSync(path.join(PUBLIC, "assets/start-now-landing.css"))).toBe(true);
  });

  test("customer-preview is not a live customer home", () => {
    const server = fs.readFileSync(SERVER_JS, "utf8");
    expect(server).toMatch(/app\.get\(\["\/customer-preview",\s*"\/customer-preview\.html"\]/);
    const block = server.slice(
      server.indexOf('app.get(["/customer-preview"'),
      server.indexOf('app.get(["/customer-preview"') + 280
    );
    expect(block).toMatch(/redirect\(302,\s*["']\/["']\)/);
    expect(block).not.toMatch(/start-now/);
  });

  test("portal-launch customer home is /", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "data/portal-launch.json"), "utf8"));
    expect(cfg.customer_platform_home).toBe("/");
    expect(String(cfg.customer_platform_home)).not.toMatch(/start-now/);
  });

  test("server registers 302 / before static", () => {
    const server = fs.readFileSync(SERVER_JS, "utf8");
    const startNowAt = server.indexOf('app.get(["/start-now", "/start-now.html"]');
    const previewAt = server.indexOf('app.get(["/customer-preview", "/customer-preview.html"]');
    const staticAt = server.indexOf("express.static(publicPath");
    expect(startNowAt).toBeGreaterThan(-1);
    expect(previewAt).toBeGreaterThan(-1);
    expect(staticAt).toBeGreaterThan(startNowAt);
    expect(staticAt).toBeGreaterThan(previewAt);
    expect(server).not.toMatch(/sendFile\(path\.join\(publicPath,\s*"start-now\.html"\)\)/);
    expect(server).not.toMatch(/redirect\(301,\s*["']\/start-now\.html["']\)/);
  });

  test("bottom nav Explore points at /#snHomeHub", () => {
    const js = fs.readFileSync(path.join(PUBLIC, "assets/mobile-foundation.js"), "utf8");
    expect(js).toMatch(/href:\s*"\/#snHomeHub"/);
    expect(js).not.toMatch(/href:\s*"\/start-now"/);
    const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
    expect(index).toMatch(/id="snHomeHub"/);
  });

  test("live customer HTML/JS does not href /start-now", () => {
    const files = walk(PUBLIC, []).filter((f) => /\.(html|js)$/i.test(f));
    const hits = [];
    for (const file of files) {
      const rel = path.relative(PUBLIC, file).replace(/\\/g, "/");
      if (/account-destinations\.js$|store-preview-mode\.js$/.test(rel)) continue;
      const s = fs.readFileSync(file, "utf8");
      const re = /href=["']\/start-now(?:\.html)?(?:#[^"']*)?["']/;
      if (re.test(s)) hits.push(rel);
      if (/href:\s*["']\/start-now(?:\.html)?/.test(s)) hits.push(rel + " href:");
    }
    expect(hits).toEqual([]);
  });

  test("HTTP / is 200 and retired paths 302 to /", async () => {
    const app = express();
    app.get("/", (_req, res) => {
      res.status(200).sendFile(path.join(PUBLIC, "index.html"));
    });
    app.get(["/start-now", "/start-now.html"], (_req, res) => {
      res.redirect(302, "/");
    });
    app.get(["/customer-preview", "/customer-preview.html"], (_req, res) => {
      res.redirect(302, "/");
    });
    app.use(express.static(PUBLIC, { index: false }));

    await withServer(app, async (port) => {
      const home = await request(port, "/");
      expect(home.status).toBe(200);

      for (const p of ["/start-now", "/start-now.html", "/customer-preview", "/customer-preview.html"]) {
        const r = await request(port, p);
        expect({ path: p, ...r }).toEqual({ path: p, status: 302, location: "/" });
      }
    });
  });
});
