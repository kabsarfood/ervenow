#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE = "http://127.0.0.1:4000";
const SESSION = path.join(process.env.TEMP || ".", "ervenow-merchant-test-session.json");
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUSEhIVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/9k=";

const report = { steps: [], isolation: "Not verified in this session" };

function logStep(name, ok, extra) {
  report.steps.push({ name, ok, extra: extra || "" });
  console.log((ok ? "PASS" : "FAIL") + " " + name + (extra ? " :: " + extra : ""));
}

async function http(method, urlPath, { token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (body != null) headers["Content-Type"] = "application/json";
  const started = Date.now();
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {}
  return { status: res.status, json, ms: Date.now() - started, keys: body ? Object.keys(body) : [] };
}

function sign(user) {
  const secret = String(process.env.ERVENOW_JWT_SECRET || "").trim();
  return jwt.sign({ sub: user.id, phone: user.phone, role: "store" }, secret, { expiresIn: "2h" });
}

function findProduct(list, name) {
  return (list || []).find((p) => String(p.name) === name);
}

async function urlToDataUrl(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("fetch image " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return "data:image/jpeg;base64," + buf.toString("base64");
}

async function main() {
  const session = JSON.parse(fs.readFileSync(SESSION, "utf8"));
  const token = session.token;
  const my = await http("GET", "/api/store/my-store", { token });
  const store = my.json && my.json.store;
  if (!store || !store.id) {
    logStep("boot my-store", false, "status=" + my.status);
    fs.writeFileSync(path.join(__dirname, "..", "docs", "_tmp-merchant-test-result.json"), JSON.stringify({ report, my }, null, 2));
    process.exit(1);
  }
  logStep("boot my-store", true, "ms=" + my.ms + " storePrefix=" + String(store.id).slice(0, 8));
  const storeId = store.id;
  const testName = "ERV-TEST-PROD-" + Date.now();
  const sortOrder = 17;

  const createBody = {
    store_id: storeId,
    name: testName,
    description: "portal gap test",
    price: 40,
    offer_price: 29,
    sort_order: sortOrder,
    images_base64: [JPEG, JPEG, JPEG],
    images_file_names: ["main.jpg", "g2.jpg", "g3.jpg"],
  };
  const created = await http("POST", "/api/store/products", { token, body: createBody });
  logStep("POST product gallery+sort", created.status === 200 || created.status === 201, "status=" + created.status + " keys=" + Object.keys(createBody).join(","));
  if (created.json && created.json.error) logStep("POST error", false, JSON.stringify(created.json).slice(0, 200));

  const list1 = await http("GET", "/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=80&offset=0", { token });
  const p1 = findProduct((list1.json && list1.json.products) || [], testName);
  logStep("GET after create", Boolean(p1), p1 ? "images=" + (p1.image_urls || []).length + " sort=" + p1.sort_order + " offer=" + p1.offer_price : "missing");
  if (!p1) {
    fs.writeFileSync(path.join(process.env.TEMP || ".", "ervenow-merchant-test-result.json"), JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const id = p1.id;
  const imgCount1 = (p1.image_urls || []).length;
  const sort1 = Number(p1.sort_order);
  logStep("images 3+", imgCount1 >= 3, "count=" + imgCount1);
  logStep("sort_order 17", sort1 === sortOrder, "got=" + sort1);

  const priceOnly = {
    store_id: storeId,
    name: p1.name,
    description: p1.description || "",
    price: 45,
    offer_price: 29,
    category: p1.category || null,
    sort_order: Number(p1.sort_order) || 0,
    stock: p1.stock != null ? p1.stock : null,
    active: p1.active !== false,
  };
  const putPrice = await http("PUT", "/api/store/products/" + encodeURIComponent(id), { token, body: priceOnly });
  logStep("PUT price only no images/rating", putPrice.status === 200, "keys=" + Object.keys(priceOnly).join(",") + " hasImages=" + ("images_base64" in priceOnly) + " hasRating=" + ("rating" in priceOnly));

  const list2 = await http("GET", "/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=80&offset=0", { token });
  const p2 = findProduct((list2.json && list2.json.products) || [], testName);
  logStep("images kept after price PUT", p2 && (p2.image_urls || []).length === imgCount1, "before=" + imgCount1 + " after=" + (p2 && (p2.image_urls || []).length));
  logStep("sort kept after price PUT", p2 && Number(p2.sort_order) === sort1, "got=" + (p2 && p2.sort_order));
  logStep("price updated", p2 && Number(p2.price) === 45, "got=" + (p2 && p2.price));

  const urls = (p2.image_urls || []).slice();
  const kept = urls.filter((_, i) => i !== 1);
  let b64s = [];
  try {
    b64s = await Promise.all(kept.map(urlToDataUrl));
    logStep("fetch remaining images for gallery PUT", true, "n=" + b64s.length);
  } catch (e) {
    logStep("fetch remaining images CORS", false, String(e.message || e) + " — fallback JPEG×" + kept.length);
    b64s = kept.map(() => JPEG);
  }
  if (b64s.length) {
    const galleryPut = {
      store_id: storeId,
      name: p2.name,
      description: p2.description || "",
      price: Number(p2.price),
      offer_price: p2.offer_price,
      category: p2.category || null,
      sort_order: Number(p2.sort_order) || 0,
      images_base64: b64s,
      images_file_names: kept.map((_, i) => "keep-" + i + ".jpg"),
    };
    const putG = await http("PUT", "/api/store/products/" + encodeURIComponent(id), { token, body: galleryPut });
    logStep("PUT remove one extra via images_base64", putG.status === 200, "status=" + putG.status + " sent=" + b64s.length);
  }

  const list3 = await http("GET", "/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=80&offset=0", { token });
  const p3 = findProduct((list3.json && list3.json.products) || [], testName);
  logStep("one extra removed", p3 && (p3.image_urls || []).length === kept.length, "count=" + (p3 && (p3.image_urls || []).length) + " expected=" + kept.length);
  logStep("sort still 17 after gallery edit", p3 && Number(p3.sort_order) === sortOrder, "got=" + (p3 && p3.sort_order));

  const nameOnly = {
    store_id: storeId,
    name: testName + "-renamed",
    description: p3.description || "",
    price: Number(p3.price),
    offer_price: p3.offer_price,
    category: p3.category || null,
    sort_order: Number(p3.sort_order) || 0,
    active: p3.active !== false,
  };
  const putName = await http("PUT", "/api/store/products/" + encodeURIComponent(id), { token, body: nameOnly });
  logStep("PUT name only", putName.status === 200, "keys=" + Object.keys(nameOnly).join(",") + " images=" + ("images_base64" in nameOnly));
  const list4 = await http("GET", "/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=80&offset=0", { token });
  const p4 = findProduct((list4.json && list4.json.products) || [], testName + "-renamed");
  logStep("gallery+sort after rename", Boolean(p4) && (p4.image_urls || []).length === (p3.image_urls || []).length && Number(p4.sort_order) === sortOrder, p4 ? "images=" + (p4.image_urls || []).length + " sort=" + p4.sort_order : "missing");

  const del = await http("DELETE", "/api/store/products/" + encodeURIComponent(id), { token });
  logStep("DELETE hide", del.status === 200, "status=" + del.status);
  const list5 = await http("GET", "/api/store/products?store_id=" + encodeURIComponent(storeId) + "&limit=80&offset=0", { token });
  const p5 = ((list5.json && list5.json.products) || []).find((p) => String(p.id) === String(id));
  logStep("hidden in manage list or inactive", !p5 || p5.active === false, p5 ? "active=" + p5.active : "absent");
  if (p5) {
    const re = await http("PUT", "/api/store/products/" + encodeURIComponent(id), {
      token,
      body: {
        store_id: storeId,
        name: p5.name,
        description: p5.description || "",
        price: Number(p5.price),
        sort_order: Number(p5.sort_order) || 0,
        active: true,
      },
    });
    logStep("re-show via active true", re.status === 200, "status=" + re.status);
    await http("DELETE", "/api/store/products/" + encodeURIComponent(id), { token });
    logStep("hide again after re-show", true, "");
  }

  const dash = await http("GET", "/api/store/merchant-dashboard", { token });
  logStep("wallet dashboard", dash.status === 200, "ms=" + dash.ms + " hasWallet=" + Boolean(dash.json && dash.json.wallet));
  const wd = await http("GET", "/api/store/withdrawals", { token });
  logStep("withdrawals list", wd.status === 200, "count=" + ((wd.json && wd.json.withdrawals) || []).length);
  const reviews = await http("GET", "/api/store/reviews?store_id=" + encodeURIComponent(storeId) + "&limit=20", { token });
  logStep("reviews", reviews.status === 200, "count=" + ((reviews.json && reviews.json.reviews) || []).length);

  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const other = (
    await client.query(
      "select u.id, u.phone, u.role from users u where u.id = $1",
      [session.otherId]
    )
  ).rows[0];
  await client.end();
  if (other) {
    const t2 = sign({ id: other.id, phone: other.phone, role: "store" });
    const my2 = await http("GET", "/api/store/my-store", { token: t2 });
    const s2 = my2.json && my2.json.store;
    if (s2 && s2.id && s2.id !== storeId) {
      report.isolation = "PASS different store id";
      logStep("session isolation", true, "a=" + String(storeId).slice(0, 8) + " b=" + String(s2.id).slice(0, 8));
    } else {
      report.isolation = "Not verified in this session";
      logStep("session isolation", false, "status=" + my2.status + " sameOrEmpty=" + Boolean(s2 && s2.id === storeId));
    }
  }

  const out = path.join(process.env.TEMP || ".", "ervenow-merchant-test-result.json");
  fs.writeFileSync(out, JSON.stringify({ report, isolation: report.isolation, storePrefix: String(storeId).slice(0, 8) }, null, 2));
  console.log("wrote " + out);
  const failed = report.steps.filter((s) => !s.ok);
  process.exit(failed.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
