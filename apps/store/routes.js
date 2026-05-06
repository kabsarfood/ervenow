const express = require("express");
const { optionalAuth, requireAuth } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizePhone } = require("../../shared/utils/phone");
const { roughDistanceKm } = require("../../shared/utils/geo");
const { routeKmWithRoughFallback, deliveryEtaMinutesFromKm } = require("../../shared/utils/routeDistance");
const { cacheGetJson, cacheSetJson } = require("../../shared/utils/redisCache");

let twilioFactory = null;
try {
  twilioFactory = require("twilio");
} catch {
  twilioFactory = null;
}

const STORE_TYPES = new Set([
  "restaurant",
  "pharmacy",
  "supermarket",
  "minimarket",
  "vegetables",
  "butcher",
  "fish",
  "home_business",
  "services",
  "other",
]);

const TYPE_LABEL_AR = {
  restaurant: "مطعم",
  pharmacy: "صيدلية",
  supermarket: "سوبرماركت",
  minimarket: "ميني ماركت",
  vegetables: "محل خضار",
  butcher: "ملحمة",
  fish: "بيع الأسماك",
  home_business: "أسرة منتجة",
  services: "خدمات",
  other: "غيره",
};

const LIST_CACHE_TTL_MS = 30 * 1000;
let listCache = { key: "", at: 0, payload: null };

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !twilioFactory) return null;
  return twilioFactory(sid, token);
}

function waFrom() {
  let n = String(process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!n) return null;
  if (!n.startsWith("whatsapp:")) n = "whatsapp:" + n.replace(/^\+/, "+");
  return n;
}

function parseBase64File(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) {
    try {
      return { mime: m[1].trim() || "image/jpeg", buffer: Buffer.from(m[2], "base64") };
    } catch {
      return null;
    }
  }
  try {
    return { mime: "application/octet-stream", buffer: Buffer.from(s, "base64") };
  } catch {
    return null;
  }
}

function safeFilePart(name) {
  const n = String(name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return n || "upload";
}

function storeFilesBucket() {
  return String(
    process.env.ERVENOW_STORE_FILES_BUCKET || process.env.ERWENOW_STORE_FILES_BUCKET || "erwenow-store-registrations"
  ).trim();
}

async function uploadToStoreBucket(sb, storeId, subfolder, base64, originalName) {
  const bucket = storeFilesBucket();
  const parsed = parseBase64File(base64);
  if (!parsed || !parsed.buffer.length) return null;
  const ext = parsed.mime.includes("png") ? "png" : parsed.mime.includes("webp") ? "webp" : "jpg";
  const objectPath = `${storeId}/${subfolder}/${Date.now()}_${safeFilePart(originalName)}.${ext}`;
  const { error: upErr } = await sb.storage.from(bucket).upload(objectPath, parsed.buffer, {
    contentType: parsed.mime,
    upsert: false,
  });
  if (upErr) {
    console.error("[store/storage] upload:", upErr.message || upErr);
    return null;
  }
  const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return pub && pub.publicUrl ? pub.publicUrl : null;
}

async function notifyAdminWhatsApp({ name, phoneDisplay, typeLabel, mapsUrl, requestId }) {
  const client = getTwilioClient();
  const from = waFrom();
  const adminRaw = String(process.env.ERVENOW_ADMIN_WHATSAPP || process.env.ERWENOW_ADMIN_WHATSAPP || "").trim();
  const adminDigits = adminRaw.replace(/\D/g, "");
  if (!client || !from || adminDigits.length < 10) {
    console.warn("[store/register] WhatsApp: Twilio أو ERVENOW_ADMIN_WHATSAPP غير مضبوط");
    return false;
  }
  const to = "whatsapp:+" + adminDigits;
  const body =
    `طلب تسجيل متجر جديد\n` +
    `الاسم: ${name}\n` +
    `الجوال: ${phoneDisplay}\n` +
    `النوع: ${typeLabel}\n` +
    `الموقع: ${mapsUrl}\n` +
    `رقم الطلب: ${requestId}`;
  await client.messages.create({ from, to, body });
  return true;
}

function isStoresTableMissing(err) {
  if (!err) return false;
  if (String(err.code || "") === "42P01") return true;
  const msg = String(err.message || err.details || "");
  return /relation .*stores/i.test(msg);
}

function isStoreProductsMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /store_products|schema cache|relation .*store_products/i.test(msg);
}

function isStoreReviewsMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /store_reviews|schema cache|relation .*store_reviews/i.test(msg);
}

/** يظهر في قوائم المتاجر العامة: معتمد وغير معطّل صراحةً */
function storeRowIsListedActive(r) {
  if (!r) return false;
  if (String(r.status || "").toLowerCase() !== "approved") return false;
  if (Object.prototype.hasOwnProperty.call(r, "is_active") && r.is_active === false) return false;
  return true;
}

function simpleHash(s) {
  const str = String(s || "");
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

const GUEST_PROMOS = [
  "خصومات على أصناف مختارة",
  "عروض اليوم — أسعار مناسبة",
  "توصيل سريع للأحياء المغطاة",
  "وجبات وعروض موسمية",
  "تخفيضات على الطلبات المحددة",
];

function browseTypesForStoreQuery(browseType) {
  const t = String(browseType || "").trim().toLowerCase();
  const map = {
    restaurant: ["restaurant"],
    pharmacy: ["pharmacy"],
    supermarket: ["supermarket", "minimarket"],
    minimarket: ["minimarket", "supermarket"],
    vegetables: ["vegetables", "supermarket"],
    butcher: ["butcher"],
    fish: ["fish"],
    home_business: ["home_business"],
    flowers_gifts: ["supermarket", "restaurant"],
    sweets: ["supermarket", "restaurant"],
    services: ["services"],
    other: ["other"],
  };
  return map[t] || (t ? [t] : []);
}

function parseUserGeoQuery(q) {
  const lat = Number(q && (q.user_lat ?? q.userLat));
  const lng = Number(q && (q.user_lng ?? q.userLng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function sortStoresForBrowse(rows, sortMode) {
  const mode = String(sortMode || "rating").toLowerCase();
  const copy = [...rows];
  copy.sort((a, b) => {
    if (mode === "orders") {
      const o = (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
      if (o !== 0) return o;
    }
    const ord = (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
    if (ord !== 0) return ord;
    const ra = Number(b.average_rating) || 0;
    const rb = Number(b.average_rating) || 0;
    return rb - ra;
  });
  return copy;
}

/** مسافة العميل من المتجر → فلترة بنطاق التوصيل → ترتيب: مسافة ثم تقييم ثم طلبات */
function filterAndSortStoresByUser(rows, userLat, userLng) {
  const withDist = rows
    .filter((r) => r.lat != null && r.lng != null && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
    .map((r) => {
      const km = roughDistanceKm(userLat, userLng, Number(r.lat), Number(r.lng));
      return { ...r, distance_km: Number.isFinite(km) ? Math.round(km * 100) / 100 : null };
    })
    .filter((r) => {
      if (r.distance_km == null || !Number.isFinite(r.distance_km)) return false;
      const radius = Number(r.delivery_radius_km) > 0 ? Number(r.delivery_radius_km) : 5;
      return r.distance_km <= radius;
    });
  withDist.sort((a, b) => {
    const da = Number(a.distance_km);
    const db = Number(b.distance_km);
    if (da !== db) return da - db;
    const o = (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
    if (o !== 0) return o;
    const ra = Number(b.average_rating) || 0;
    const rb = Number(a.average_rating) || 0;
    return ra - rb;
  });
  return withDist;
}

function maskStoreRowForGuest(row, index) {
  const h = simpleHash(row.id || index);
  const num = 1000 + (h % 9000);
  return {
    masked: true,
    label: `محل مشارك — ${num}`,
    promo: GUEST_PROMOS[h % GUEST_PROMOS.length],
    type: row.type || null,
  };
}

function publicStoreRow(row) {
  const o = {
    masked: false,
    id: row.id,
    name: row.name,
    phone: row.phone,
    type: row.type,
    category: row.category || row.type || null,
    lat: row.lat,
    lng: row.lng,
    address: row.address || row.location_text || null,
    delivery_radius_km: Number(row.delivery_radius_km) > 0 ? Number(row.delivery_radius_km) : 5,
    logo_url: row.logo_url || null,
    location_text: row.location_text || null,
    average_rating: Number(row.average_rating) || 0,
    rating_count: Number(row.rating_count) || 0,
    total_orders: Number(row.total_orders) || 0,
  };
  if (row.is_active != null) o.is_active = !!row.is_active;
  if (row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
    o.distance_km = Number(row.distance_km);
  }
  return o;
}

function requireMerchantRole(req, res, next) {
  const r = String(req.appUser?.role || "").toLowerCase();
  if (["merchant", "restaurant", "admin"].includes(r)) return next();
  return fail(res, "يتطلب حساب تاجر مرتبط بالمتجر", 403);
}

async function loadApprovedStore(sb, storeId) {
  const { data, error } = await sb.from("stores").select("*").eq("id", storeId).maybeSingle();
  if (error) return { error: error.message || "خطأ قاعدة البيانات" };
  if (!data) return { error: "المتجر غير موجود" };
  if (String(data.status || "").toLowerCase() !== "approved") return { error: "المتجر غير معتمد" };
  if (Object.prototype.hasOwnProperty.call(data, "is_active") && data.is_active === false) {
    return { error: "المتجر غير نشط حالياً" };
  }
  return { store: data };
}

async function assertMerchantOwnsStore(sb, storeId, appUser) {
  const got = await loadApprovedStore(sb, storeId);
  if (got.error) return { error: got.error };
  const store = got.store;
  const userDigits = normalizePhone(appUser.phone);
  const storeDigits = String(store.phone || "").replace(/\D/g, "");
  if (!userDigits || userDigits !== storeDigits) {
    return { error: "رقم حسابك لا يطابق جوال المتجر المسجّل" };
  }
  return { store };
}

async function ensureOwnerLinked(sb, store, userId) {
  if (!store?.id || !userId) return;
  if (store.owner_user_id) return;
  await sb
    .from("stores")
    .update({ owner_user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", store.id);
}

async function recalcStoreRating(sb, storeId) {
  const { data: rows, error } = await sb.from("store_reviews").select("rating").eq("store_id", storeId);
  if (error) {
    if (isStoreReviewsMissing(error)) return;
    console.warn("[store/recalcRating]", error.message || error);
    return;
  }
  const list = rows || [];
  const n = list.length;
  const sum = list.reduce((a, r) => a + Number(r.rating || 0), 0);
  const avg = n ? Math.round((sum / n) * 100) / 100 : 0;
  await sb
    .from("stores")
    .update({
      average_rating: avg,
      rating_count: n,
      updated_at: new Date().toISOString(),
    })
    .eq("id", storeId);
}

const router = express.Router();

router.get("/my-store", requireAuth, requireMerchantRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const extendedSel =
      "id,name,phone,type,status,is_active,logo_url,lat,lng,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders";
    let row = null;
    let err = null;
    ({ data: row, error: err } = await sb.from("stores").select(extendedSel).eq("phone", digits).eq("status", "approved").maybeSingle());
    if (err && /column|does not exist|schema cache/i.test(String(err.message || ""))) {
      ({ data: row, error: err } = await sb
        .from("stores")
        .select("id,name,phone,type,status,lat,lng")
        .eq("phone", digits)
        .eq("status", "approved")
        .maybeSingle());
    }
    if (err) return fail(res, err.message, 400);
    if (!row) return fail(res, "لا يوجد متجر معتمد مرتبط بجوالك. سجّل الدخول كتاجر (تاجر/متجر) بنفس رقم التسجيل.", 404);
    if (Object.prototype.hasOwnProperty.call(row, "is_active") && row.is_active === false) {
      return fail(res, "المتجر معتمد لكن غير مفعّل للظهور — تواصل مع الإدارة.", 403);
    }
    return ok(res, { store: publicStoreRow(row) });
  } catch (e) {
    console.error("[store/my-store]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.get("/", optionalAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);

    const storesListRoot = req.baseUrl === "/api/stores";
    const browseType = String(req.query.type || "").trim().toLowerCase();
    const sortParam = String(req.query.sort || "rating").trim().toLowerCase();
    const userPos = parseUserGeoQuery(req.query);
    const wantTypes = browseTypesForStoreQuery(browseType);

    if (storesListRoot) {
      const mask = !req.appUser;
      const geoKey = userPos ? `${userPos.lat.toFixed(4)}:${userPos.lng.toFixed(4)}` : "nogeo";
      const cacheKey = `storelist-all:${sortParam}|${mask ? "g" : "u"}|${geoKey}`;
      const redisListKey = `storelist:v1:${cacheKey}`;
      const redisHit = await cacheGetJson(redisListKey);
      if (redisHit && redisHit.stores) {
        res.set("Cache-Control", "public, max-age=30");
        return ok(res, redisHit);
      }
      const now = Date.now();
      if (listCache.payload && listCache.key === cacheKey && now - listCache.at < LIST_CACHE_TTL_MS) {
        res.set("Cache-Control", "public, max-age=30");
        return ok(res, listCache.payload);
      }
      const extendedSelAll =
        "id,name,phone,type,category,lat,lng,status,is_active,logo_url,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders,created_at";
      const baseSelAll = "id,name,phone,type,lat,lng,status,created_at";
      let rowsAll = [];
      let errAll = null;
      ({ data: rowsAll, error: errAll } = await sb
        .from("stores")
        .select(extendedSelAll)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(200));
      if (errAll && /column|does not exist|schema cache/i.test(String(errAll.message || ""))) {
        ({ data: rowsAll, error: errAll } = await sb
          .from("stores")
          .select(baseSelAll)
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(200));
      }
      if (errAll) {
        if (isStoresTableMissing(errAll)) return ok(res, { ok: true, stores: [], browse_masked: mask });
        return fail(res, errAll.message, 400);
      }
      let rows = (rowsAll || []).filter((r) => storeRowIsListedActive(r));
      if (userPos) {
        rows = filterAndSortStoresByUser(rows, userPos.lat, userPos.lng);
      } else {
        rows = sortStoresForBrowse(rows, sortParam);
      }
      const stores = rows.map((row, i) => {
        if (mask) {
          const m = maskStoreRowForGuest(row, i);
          m.id = row.id;
          m.category = row.category || row.type || null;
          if (userPos && row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
            m.distance_km = Number(row.distance_km);
          }
          return m;
        }
        return publicStoreRow(row);
      });
      const payload = {
        ok: true,
        stores,
        browse_masked: mask,
        sort: sortParam,
        geo_filtered: !!userPos,
        list_mode: "active_only",
      };
      listCache = { key: cacheKey, at: now, payload };
      await cacheSetJson(redisListKey, payload, LIST_CACHE_TTL_MS);
      res.set("Cache-Control", "public, max-age=30");
      return ok(res, payload);
    }

    if (!browseType || !wantTypes.length) {
      return ok(res, { ok: true, stores: [] });
    }

    const mask = !req.appUser;
    const geoKey = userPos ? `${userPos.lat.toFixed(4)}:${userPos.lng.toFixed(4)}` : "nogeo";
    const cacheKey = `${browseType}|${sortParam}|${mask ? "g" : "u"}|${geoKey}`;
    const redisListKey = `storelist:v1:${cacheKey}`;
    const redisHit = await cacheGetJson(redisListKey);
    if (redisHit && redisHit.stores) {
      res.set("Cache-Control", "public, max-age=30");
      return ok(res, redisHit);
    }

    const now = Date.now();
    if (listCache.payload && listCache.key === cacheKey && now - listCache.at < LIST_CACHE_TTL_MS) {
      res.set("Cache-Control", "public, max-age=30");
      return ok(res, listCache.payload);
    }

    const extendedSel =
      "id,name,phone,type,category,lat,lng,status,is_active,logo_url,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders,created_at";
    const baseSel = "id,name,phone,type,lat,lng,status,created_at";

    let rows = [];
    for (const t of wantTypes) {
      let chunkErr;
      let chunk;
      ({ data: chunk, error: chunkErr } = await sb
        .from("stores")
        .select(extendedSel)
        .eq("status", "approved")
        .eq("type", t)
        .limit(80));
      if (chunkErr && /column|does not exist|schema cache/i.test(String(chunkErr.message || ""))) {
        ({ data: chunk, error: chunkErr } = await sb
          .from("stores")
          .select(baseSel)
          .eq("status", "approved")
          .eq("type", t)
          .limit(80));
      }
      if (chunkErr) {
        if (isStoresTableMissing(chunkErr)) return ok(res, { stores: [] });
        continue;
      }
      if (chunk && chunk.length) rows = rows.concat(chunk);
    }

    const seen = new Set();
    rows = rows.filter((r) => {
      const id = String(r.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return storeRowIsListedActive(r);
    });

    if (userPos) {
      rows = filterAndSortStoresByUser(rows, userPos.lat, userPos.lng);
    } else {
      rows = sortStoresForBrowse(rows, sortParam);
    }

    const stores = rows.map((row, i) => {
      if (mask) {
        const m = maskStoreRowForGuest(row, i);
        if (userPos && row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
          m.distance_km = Number(row.distance_km);
        }
        return m;
      }
      return publicStoreRow(row);
    });
    const payload = {
      stores,
      browse_masked: mask,
      sort: sortParam,
      geo_filtered: !!userPos,
    };
    listCache = { key: cacheKey, at: now, payload };
    await cacheSetJson(redisListKey, payload, LIST_CACHE_TTL_MS);
    res.set("Cache-Control", "public, max-age=30");
    return ok(res, payload);
  } catch (e) {
    console.error("[store/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

async function getPublicStoreById(req, res) {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "معرّف المتجر مطلوب", 400);

    const extendedSel =
      "id,name,phone,type,category,lat,lng,status,is_active,logo_url,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders";
    let row = null;
    let err = null;
    ({ data: row, error: err } = await sb.from("stores").select(extendedSel).eq("id", id).maybeSingle());
    if (err && /column|does not exist|schema cache/i.test(String(err.message || ""))) {
      ({ data: row, error: err } = await sb.from("stores").select("id,name,phone,type,lat,lng,status").eq("id", id).maybeSingle());
    }
    if (err && !isStoresTableMissing(err)) return fail(res, err.message, 400);
    if (!row || String(row.status || "").toLowerCase() !== "approved") {
      return fail(res, "المتجر غير متاح", 404);
    }
    if (Object.prototype.hasOwnProperty.call(row, "is_active") && row.is_active === false) {
      return fail(res, "المتجر غير متاح", 404);
    }

    const mask = !req.appUser;
    const qLat = Number(req.query.user_lat ?? req.query.userLat);
    const qLng = Number(req.query.user_lng ?? req.query.userLng);

    let productCount = 0;
    const pc = await sb.from("store_products").select("id", { count: "exact", head: true }).eq("store_id", id).eq("active", true);
    if (!pc.error && typeof pc.count === "number") productCount = pc.count;
    else if (pc.error && !isStoreProductsMissing(pc.error)) {
      console.warn("[store/public] product count:", pc.error.message);
    }

    if (!mask) {
      const out = {
        ...publicStoreRow(row),
        product_count: productCount,
      };
      if (Number.isFinite(qLat) && Number.isFinite(qLng) && row.lat != null && row.lng != null) {
        const slat = Number(row.lat);
        const slng = Number(row.lng);
        const km = await routeKmWithRoughFallback(slat, slng, qLat, qLng);
        if (Number.isFinite(km)) {
          out.distance_km = Math.round(km * 100) / 100;
          const radius = Number(row.delivery_radius_km) > 0 ? Number(row.delivery_radius_km) : 5;
          out.within_delivery_radius = km <= radius;
          const etaMin = deliveryEtaMinutesFromKm(km);
          if (etaMin != null) out.delivery_eta_minutes = etaMin;
        }
      }
      return ok(res, {
        store: out,
        browse_masked: false,
      });
    }

    const fake = maskStoreRowForGuest(row, 0);
    const maskedPayload = { store: { ...fake, id: row.id, product_count: productCount }, browse_masked: true };
    if (Number.isFinite(qLat) && Number.isFinite(qLng) && row.lat != null && row.lng != null) {
      const slat = Number(row.lat);
      const slng = Number(row.lng);
      const km = await routeKmWithRoughFallback(slat, slng, qLat, qLng);
      if (Number.isFinite(km)) {
        maskedPayload.store.distance_km = Math.round(km * 100) / 100;
        const radius = Number(row.delivery_radius_km) > 0 ? Number(row.delivery_radius_km) : 5;
        maskedPayload.store.within_delivery_radius = km <= radius;
        const etaMin = deliveryEtaMinutesFromKm(km);
        if (etaMin != null) maskedPayload.store.delivery_eta_minutes = etaMin;
      }
    }
    return ok(res, maskedPayload);
  } catch (e) {
    console.error("[store/public]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
}

router.get("/public/:id", optionalAuth, getPublicStoreById);

router.get("/products", optionalAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const storeId = String(req.query.store_id || "").trim();
    if (!storeId) return fail(res, "store_id مطلوب", 400);

    const got = await loadApprovedStore(sb, storeId);
    if (got.error) return fail(res, got.error, 404);

    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const { data, error, count } = await sb
      .from("store_products")
      .select("*", { count: "exact" })
      .eq("store_id", storeId)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      if (isStoreProductsMissing(error)) return ok(res, { products: [], total: 0, note: "نفّذ migration_store_marketplace.sql" });
      return fail(res, error.message, 400);
    }
    return ok(res, { products: data || [], total: count ?? (data || []).length, limit, offset });
  } catch (e) {
    console.error("[store/products/get]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.post("/products", requireAuth, requireMerchantRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const storeId = String(req.body?.store_id || "").trim();
    const name = String(req.body?.name || "").trim();
    const price = Number(req.body?.price);
    const description = String(req.body?.description || "").trim() || null;
    const sortOrder = Number(req.body?.sort_order);
    if (!storeId || !name) return fail(res, "store_id والاسم مطلوبان", 400);
    if (!Number.isFinite(price) || price < 0) return fail(res, "السعر غير صالح", 400);

    const own = await assertMerchantOwnsStore(sb, storeId, req.appUser);
    if (own.error) return fail(res, own.error, 403);
    await ensureOwnerLinked(sb, own.store, req.appUser.id);

    let imageUrl = null;
    if (req.body?.image_base64) {
      imageUrl = await uploadToStoreBucket(sb, storeId, "products", req.body.image_base64, req.body.image_file_name || "product.jpg");
    }

    const row = {
      store_id: storeId,
      name,
      description,
      price,
      image_url: imageUrl,
      active: true,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb.from("store_products").insert(row).select("*").single();
    if (error) {
      if (isStoreProductsMissing(error)) return fail(res, "جدول المنتجات غير جاهز — نفّذ migration_store_marketplace.sql", 400);
      return fail(res, error.message, 400);
    }
    listCache = { key: "", at: 0, payload: null };
    return ok(res, { product: data });
  } catch (e) {
    console.error("[store/products/post]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.put("/products/:id", requireAuth, requireMerchantRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const productId = String(req.params.id || "").trim();
    if (!productId) return fail(res, "معرّف المنتج مطلوب", 400);

    const { data: existing, error: exErr } = await sb.from("store_products").select("store_id").eq("id", productId).maybeSingle();
    if (exErr || !existing) return fail(res, "المنتج غير موجود", 404);

    const own = await assertMerchantOwnsStore(sb, existing.store_id, req.appUser);
    if (own.error) return fail(res, own.error, 403);

    const patch = { updated_at: new Date().toISOString() };
    if (req.body?.name != null) {
      const nm = String(req.body.name).trim();
      if (!nm) return fail(res, "اسم المنتج لا يمكن أن يكون فارغاً", 400);
      patch.name = nm;
    }
    if (req.body?.description !== undefined) patch.description = String(req.body.description || "").trim() || null;
    if (req.body?.price != null) {
      const p = Number(req.body.price);
      if (!Number.isFinite(p) || p < 0) return fail(res, "السعر غير صالح", 400);
      patch.price = p;
    }
    if (req.body?.sort_order != null) {
      const s = Number(req.body.sort_order);
      if (Number.isFinite(s)) patch.sort_order = s;
    }
    if (req.body?.active != null) patch.active = !!req.body.active;
    if (req.body?.image_base64) {
      const url = await uploadToStoreBucket(
        sb,
        existing.store_id,
        "products",
        req.body.image_base64,
        req.body.image_file_name || "product.jpg"
      );
      if (url) patch.image_url = url;
    }

    const { data, error } = await sb.from("store_products").update(patch).eq("id", productId).select("*").single();
    if (error) return fail(res, error.message, 400);
    listCache = { key: "", at: 0, payload: null };
    return ok(res, { product: data });
  } catch (e) {
    console.error("[store/products/put]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.delete("/products/:id", requireAuth, requireMerchantRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const productId = String(req.params.id || "").trim();
    const { data: existing, error: exErr } = await sb.from("store_products").select("store_id").eq("id", productId).maybeSingle();
    if (exErr || !existing) return fail(res, "المنتج غير موجود", 404);

    const own = await assertMerchantOwnsStore(sb, existing.store_id, req.appUser);
    if (own.error) return fail(res, own.error, 403);

    const { error } = await sb
      .from("store_products")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (error) return fail(res, error.message, 400);
    listCache = { key: "", at: 0, payload: null };
    return ok(res, { ok: true });
  } catch (e) {
    console.error("[store/products/delete]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.post("/reviews", requireAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const role = String(req.appUser.role || "").toLowerCase();
    if (!["customer", "user", "admin"].includes(role)) {
      return fail(res, "التقييم متاح لعملاء المنصة فقط", 403);
    }

    const storeId = String(req.body?.store_id || "").trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim() || null;
    if (!storeId) return fail(res, "store_id مطلوب", 400);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return fail(res, "التقييم من 1 إلى 5", 400);

    const got = await loadApprovedStore(sb, storeId);
    if (got.error) return fail(res, got.error, 404);

    const { data: inserted, error } = await sb
      .from("store_reviews")
      .insert({
        store_id: storeId,
        user_id: req.appUser.id,
        rating: Math.round(rating),
        comment,
      })
      .select()
      .single();

    if (error) {
      if (isStoreReviewsMissing(error)) return fail(res, "جدول التقييمات غير جاهز — نفّذ migration_store_marketplace.sql", 400);
      return fail(res, error.message, 400);
    }

    await recalcStoreRating(sb, storeId);
    listCache = { key: "", at: 0, payload: null };
    return ok(res, { review: inserted });
  } catch (e) {
    console.error("[store/reviews]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.get("/reviews", optionalAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const storeId = String(req.query.store_id || "").trim();
    if (!storeId) return fail(res, "store_id مطلوب", 400);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const got = await loadApprovedStore(sb, storeId);
    if (got.error) return fail(res, got.error, 404);

    const { data, error } = await sb
      .from("store_reviews")
      .select("id,rating,comment,created_at,user_id")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      if (isStoreReviewsMissing(error)) return ok(res, { reviews: [] });
      return fail(res, error.message, 400);
    }
    return ok(res, { reviews: data || [] });
  } catch (e) {
    console.error("[store/reviews/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.post("/register", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) {
      return fail(res, "الخادم غير مهيأ لقاعدة البيانات (SUPABASE_SERVICE_ROLE_KEY)", 503);
    }

    const b = req.body || {};
    const name = String(b.name || "").trim();
    const phoneRaw = String(b.phone || "").trim();
    const email = String(b.email || "").trim() || null;
    const commercial_registration = String(b.commercial_registration || "").trim() || null;
    const location_text = String(b.location_text || "").trim() || null;
    const address = String(b.address || "").trim();
    const type = String(b.type || b.category || "").trim().toLowerCase();

    let lat = b.lat;
    let lng = b.lng;
    if (lat != null && lat !== "") lat = Number(lat);
    else lat = null;
    if (lng != null && lng !== "") lng = Number(lng);
    else lng = null;

    if (!name || name.length < 2) return fail(res, "اسم المتجر مطلوب", 400);
    if (!address || address.length < 4) return fail(res, "عنوان المتجر مطلوب", 400);
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      return fail(res, "يجب تحديد موقع المتجر على الخريطة", 400);
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return fail(res, "إحداثيات الموقع غير صالحة", 400);
    }

    let delivery_radius_km = Number(b.delivery_radius_km);
    if (!Number.isFinite(delivery_radius_km) || delivery_radius_km <= 0) delivery_radius_km = 5;
    delivery_radius_km = Math.min(80, Math.max(1, delivery_radius_km));

    const phoneDigits = normalizePhone(phoneRaw);
    if (!phoneDigits || phoneDigits.length < 10) return fail(res, "رقم الجوال غير صالح", 400);
    if (!STORE_TYPES.has(type)) return fail(res, "نوع النشاط غير صالح", 400);

    const phoneDisplay = phoneRaw || phoneDigits;

    const row = {
      name,
      phone: phoneDigits,
      email,
      commercial_registration,
      file_url: null,
      lat,
      lng,
      address,
      delivery_radius_km,
      type,
      category: type,
      is_active: false,
      status: "pending",
    };

    if (location_text) row.location_text = location_text;

    let insertedRow = null;
    let insErr = null;
    ({ data: insertedRow, error: insErr } = await sb.from("stores").insert(row).select("id").single());
    if (
      insErr &&
      /location_text|address|delivery_radius_km|is_active|category|commercial_registration|column .* does not exist|schema cache/i.test(
        String(insErr.message || "")
      )
    ) {
      delete row.location_text;
      delete row.address;
      delete row.delivery_radius_km;
      delete row.is_active;
      delete row.category;
      delete row.commercial_registration;
      ({ data: insertedRow, error: insErr } = await sb.from("stores").insert(row).select("id").single());
    }
    if (insErr) {
      console.error("[store/register] insert:", insErr);
      if (isStoresTableMissing(insErr)) {
        return fail(res, insErr.message || String(insErr), 400);
      }
      return fail(res, insErr.message || "تعذر حفظ الطلب — راجع قيود قاعدة البيانات", 400);
    }

    const requestId = insertedRow.id;

    if (b.commercialRegistrationFileBase64) {
      const fileUrl = await uploadToStoreBucket(
        sb,
        requestId,
        "cr",
        b.commercialRegistrationFileBase64,
        b.commercialRegistrationFileName
      );
      if (fileUrl) await sb.from("stores").update({ file_url: fileUrl }).eq("id", requestId);
    }

    if (b.logoFileBase64) {
      const logoUrl = await uploadToStoreBucket(sb, requestId, "logo", b.logoFileBase64, b.logoFileName || "logo.jpg");
      if (logoUrl) {
        const up = await sb.from("stores").update({ logo_url: logoUrl }).eq("id", requestId);
        if (up.error && /logo_url|column/i.test(String(up.error.message || ""))) {
          console.warn("[store/register] logo_url column missing — migration_store_marketplace.sql");
        }
      }
    }

    const mapsUrl =
      lat != null && lng != null
        ? `${address} — https://maps.google.com/?q=${encodeURIComponent(String(lat) + "," + String(lng))}`
        : address;

    const typeLabel = TYPE_LABEL_AR[type] || type;

    try {
      await notifyAdminWhatsApp({
        name,
        phoneDisplay,
        typeLabel,
        mapsUrl,
        requestId,
      });
    } catch (waErr) {
      console.error("[store/register] WhatsApp:", waErr.message || waErr);
    }

    return ok(res, {
      ok: true,
      success: true,
      id: requestId,
      status: "pending",
      is_active: false,
      headline: "تم تسجيل المتجر",
      subline: "بانتظار الموافقة",
      message: "✅ تم تسجيل المتجر\n⏳ بانتظار الموافقة",
    });
  } catch (e) {
    console.error("[store/register]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

/** GET /api/store/:id — نفس استجابة /public/:id (يُسجّل آخراً حتى لا يتعارض مع /products وغيره) */
const STORE_GET_BY_ID_RESERVED = new Set(["products", "reviews", "register", "public", "my-store"]);
router.get("/:id", optionalAuth, async (req, res, next) => {
  const raw = String(req.params.id || "").trim();
  if (!raw || STORE_GET_BY_ID_RESERVED.has(raw.toLowerCase())) return next();
  return getPublicStoreById(req, res);
});

module.exports = router;
