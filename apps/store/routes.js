const express = require("express");
const { optionalAuth, requireAuth, requireStoreRole } = require("../../shared/middleware/auth");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizePhone } = require("../../shared/utils/phone");
const { roughDistanceKm } = require("../../shared/utils/geo");
const { routeKmWithRoughFallback, deliveryEtaMinutesFromKm } = require("../../shared/utils/routeDistance");
const { isDeliveryEnginePolicyEnabled } = require("../../shared/utils/deliveryEngineFlags");
const { publicDeliveryPolicyLabels, storePolicyRowToConfig } = require("../../shared/services/deliveryPolicyEngine");
const { deliveryEngineRouter } = require("./deliveryEngineRoutes");
const { cacheGetJson, cacheSetJson } = require("../../shared/utils/redisCache");
const { parseOptionalPayoutPayload, payoutRowForDriversOrStores } = require("../../shared/utils/payoutFields");
const { sanitizeDriverOrStoreRowForApi } = require("../../shared/utils/bankApiSafe");
const {
  assertPayoutIbanGloballyAvailable,
  assertStorePhoneNotDuplicateForRegister,
  stripIban,
  ibanFingerprintFromPlain,
} = require("../../shared/utils/payoutUniqueness");
const { decrypt } = require("../../server/utils/crypto");
const {
  restaurantCategoryLabelAr,
  restaurantCategoryDisplayAr,
  restaurantRowMatchesCuisineFilter,
  storeRowCountsAsRestaurant,
  resolveRestaurantBrowseCategory,
} = require("../../shared/restaurantCategories");
const {
  isMarketStoreType,
  productCategoryLabelAr,
  PRODUCT_CATEGORY_ICONS,
  normalizeProductCategory,
} = require("../../shared/marketProductCategories");
const {
  productCatalogTypeForStoreType,
  labelForProductSlug,
  iconForProductSlug,
  storeSupportsProductCategoryBrowse,
} = require("../../shared/productCategoryTypes");
const {
  fetchProductCategoryCatalog,
  resolveProductCategorySlug,
  fetchMergedProductCategorySlugs,
} = require("../../shared/categoriesDb");
const { productRowWithImages, productImageUrlsFromRow } = require("../../shared/utils/productImages");
const {
  resolvePublicCategorySlug,
  fetchMergedRestaurantCategorySlugs,
  fetchCategoryLabelMap,
} = require("../../shared/categoriesDb");
const { incrementCategoryUsage } = require("../../shared/categoryUsage");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const { getStoreWalletPayloadWithFallback } = require("../../shared/utils/ledgerWallet");
const {
  uploadToStoreBucket,
  resolveStoreImageUrl,
} = require("../../shared/utils/storeFileUpload");

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
const STORE_PUBLIC_CACHE_TTL_MS = 45 * 1000;
let listCache = { key: "", at: 0, payload: null };
const storePublicCache = new Map();

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

const MAX_PRODUCT_IMAGES = 6;

async function upsertStoreMerchantHubBranding(sb, storeId, { banner_url, bio }) {
  if (!storeId) return;
  const merged = {
    store_id: storeId,
    updated_at: new Date().toISOString(),
  };
  if (banner_url) merged.banner_url = banner_url;
  if (bio !== undefined) merged.bio = bio;
  const { error } = await sb.from("store_merchant_hub").upsert(merged, { onConflict: "store_id" });
  if (error && !isStoreMerchantHubMissing(error)) {
    console.warn("[store/hub] upsert branding:", error.message || error);
  }
}

async function attachPublicBranding(sb, storePayload, row, hubPublic) {
  const logo_url = row && row.logo_url ? await resolveStoreImageUrl(sb, row.logo_url) : null;
  const banner_url = hubPublic && hubPublic.banner_url ? await resolveStoreImageUrl(sb, hubPublic.banner_url) : null;
  return {
    ...storePayload,
    logo_url,
    banner_url,
    bio: hubPublic && hubPublic.bio != null ? hubPublic.bio : null,
  };
}

async function uploadProductImagesFromBody(sb, storeId, body) {
  const urls = [];
  if (body?.image_base64) {
    const u = await uploadToStoreBucket(
      sb,
      storeId,
      "products",
      body.image_base64,
      body.image_file_name || "product.jpg"
    );
    if (u) urls.push(u);
  }
  const extras = Array.isArray(body?.images_base64) ? body.images_base64 : [];
  const names = Array.isArray(body?.images_file_names) ? body.images_file_names : [];
  for (let i = 0; i < extras.length && urls.length < MAX_PRODUCT_IMAGES; i++) {
    const b64 = extras[i];
    if (!b64 || typeof b64 !== "string" || b64.length < 40) continue;
    const u = await uploadToStoreBucket(sb, storeId, "products", b64, names[i] || "product-" + (i + 1) + ".jpg");
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

async function fetchMerchantHubPublic(sb, storeId) {
  let banner_url = null;
  let bio = null;
  const hubRes = await sb.from("store_merchant_hub").select("banner_url,bio").eq("store_id", storeId).maybeSingle();
  if (!hubRes.error && hubRes.data) {
    banner_url = hubRes.data.banner_url || null;
    bio = hubRes.data.bio != null ? String(hubRes.data.bio).trim() || null : null;
  }
  return { banner_url, bio };
}

function mapProductsForApi(rows) {
  return (rows || []).map((r) => productRowWithImages(r));
}

async function notifyAdminWhatsApp({ name, phoneDisplay, typeLabel, mapsUrl, requestId, payoutSummary, cuisineLine }) {
  const client = getTwilioClient();
  const from = waFrom();
  const adminRaw = String(process.env.ERVENOW_ADMIN_WHATSAPP || process.env.ERWENOW_ADMIN_WHATSAPP || "").trim();
  const adminDigits = adminRaw.replace(/\D/g, "");
  if (!client || !from || adminDigits.length < 10) {
    console.warn("[store/register] WhatsApp: Twilio أو ERVENOW_ADMIN_WHATSAPP غير مضبوط");
    return false;
  }
  const to = "whatsapp:+" + adminDigits;
  let body =
    `طلب تسجيل متجر جديد\n` +
    `الاسم: ${name}\n` +
    `الجوال: ${phoneDisplay}\n` +
    `النوع: ${typeLabel}\n` +
    (cuisineLine ? `${cuisineLine}\n` : "") +
    `الموقع: ${mapsUrl}\n` +
    `رقم الطلب: ${requestId}`;
  if (payoutSummary) body += `\n\nبيانات دفع (ملخص):\n${payoutSummary}`;
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

/** مسافة العميل من المتجر → ترتيب بالقرب (لا نخفي المتاجر خارج نطاق التوصيل في قوائم التصفح) */
function filterAndSortStoresByUser(rows, userLat, userLng) {
  const withCoords = [];
  const noCoords = [];
  (rows || []).forEach((r) => {
    const has =
      r.lat != null && r.lng != null && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));
    if (!has) {
      noCoords.push({ ...r, distance_km: null, within_delivery_radius: null });
      return;
    }
    const km = roughDistanceKm(userLat, userLng, Number(r.lat), Number(r.lng));
    const distance_km = Number.isFinite(km) ? Math.round(km * 100) / 100 : null;
    const radius = Number(r.delivery_radius_km) > 0 ? Number(r.delivery_radius_km) : 5;
    withCoords.push({
      ...r,
      distance_km,
      within_delivery_radius:
        distance_km != null && Number.isFinite(distance_km) ? distance_km <= radius : null,
    });
  });
  withCoords.sort((a, b) => {
    const da = Number(a.distance_km);
    const db = Number(b.distance_km);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    if (Number.isFinite(da) && !Number.isFinite(db)) return -1;
    if (!Number.isFinite(da) && Number.isFinite(db)) return 1;
    const o = (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
    if (o !== 0) return o;
    return (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0);
  });
  return withCoords.concat(noCoords);
}

function categoryLabelForStoreRow(row, labelOpts) {
  const browseCat = resolveRestaurantBrowseCategory(row);
  const catRaw = browseCat || (row.category != null ? String(row.category).trim() : "");
  const t = String(row.type || "")
    .trim()
    .toLowerCase();
  const restMap = labelOpts && labelOpts.restaurantLabels;
  const marketMap = labelOpts && labelOpts.marketLabels;
  if (t === "restaurant") {
    const k = catRaw.toLowerCase();
    if (restMap && restMap.has(k)) return restMap.get(k);
    return restaurantCategoryDisplayAr(catRaw, row.type);
  }
  if (isMarketStoreType(row.type)) {
    const k = catRaw.toLowerCase();
    if (marketMap && marketMap.has(k)) return marketMap.get(k);
    const pc = normalizeProductCategory(catRaw);
    if (pc) return productCategoryLabelAr(pc);
    return TYPE_LABEL_AR[t] || null;
  }
  return restaurantCategoryDisplayAr(catRaw, row.type) || TYPE_LABEL_AR[t] || null;
}

function maskStoreRowForGuest(row, index, labelOpts) {
  const h = simpleHash(row.id || index);
  const num = 1000 + (h % 9000);
  const browseCat = resolveRestaurantBrowseCategory(row);
  const catRaw = browseCat || (row.category != null ? String(row.category).trim() : "");
  const cuisine = categoryLabelForStoreRow(row, labelOpts);
  const displayName = row.name != null ? String(row.name).trim() : "";
  return {
    masked: true,
    name: displayName || null,
    label: displayName || `محل مشارك — ${num}`,
    promo: GUEST_PROMOS[h % GUEST_PROMOS.length],
    type: row.type || null,
    category: catRaw || row.type || null,
    category_label_ar: cuisine || TYPE_LABEL_AR[row.type] || null,
    logo_url: row.logo_url || null,
    average_rating: Number(row.average_rating) || 0,
    rating_count: Number(row.rating_count) || 0,
    total_orders: Number(row.total_orders) || 0,
    ...(storeSupportsProductCategoryBrowse(row.type) ? { supports_product_categories: true } : {}),
  };
}

function publicStoreRow(row, labelOpts) {
  const browseCat = resolveRestaurantBrowseCategory(row);
  const catRaw = browseCat || (row.category != null ? String(row.category).trim() : "");
  const categoryDisplay = categoryLabelForStoreRow(row, labelOpts);
  const o = {
    masked: false,
    id: row.id,
    name: row.name,
    phone: row.phone,
    type: row.type,
    category: catRaw || row.type || null,
    category_label_ar: categoryDisplay || TYPE_LABEL_AR[row.type] || null,
    lat: row.lat,
    lng: row.lng,
    address: row.address || row.location_text || null,
    delivery_radius_km: Number(row.delivery_radius_km) > 0 ? Number(row.delivery_radius_km) : 5,
    logo_url: row.logo_url || null,
    location_text: row.location_text || null,
    average_rating: Number(row.average_rating) || 0,
    rating_count: Number(row.rating_count) || 0,
    total_orders: Number(row.total_orders) || 0,
    profile_views: Number(row.profile_views) || 0,
  };
  if (row.is_active != null) o.is_active = !!row.is_active;
  if (row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
    o.distance_km = Number(row.distance_km);
  }
  if (storeSupportsProductCategoryBrowse(row.type)) o.supports_product_categories = true;
  if (isDeliveryEnginePolicyEnabled()) {
    o.delivery_engine = publicDeliveryPolicyLabels(storePolicyRowToConfig(row));
  }
  return o;
}

async function resolveMerchantStoreByPhone(sb, appUser) {
  const digits = normalizePhone(appUser.phone);
  const { data: row, error } = await sb
    .from("stores")
    .select("*")
    .eq("phone", digits)
    .eq("status", "approved")
    .maybeSingle();
  if (error) return { error: error.message || "خطأ قاعدة البيانات" };
  if (!row) return { error: "لا يوجد متجر معتمد مرتبط بجوالك" };
  return { store: row };
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

router.get("/my-store", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const extendedSel =
      "id,name,phone,type,category,status,is_active,logo_url,lat,lng,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders,profile_views,bank_name,bank_country_code,bank_last4,bank_verified,stc_pay_phone,payout_crypto_interest";
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
    const base = publicStoreRow(row);
    const bankSafe = sanitizeDriverOrStoreRowForApi(row);

    let merchant_hub = null;
    let hubRes = await sb
      .from("store_merchant_hub")
      .select("bio,banner_url,checkout_payment_methods,updated_at")
      .eq("store_id", row.id)
      .maybeSingle();
    if (hubRes.error && /column|does not exist|schema cache/i.test(String(hubRes.error.message || ""))) {
      hubRes = await sb.from("store_merchant_hub").select("bio,banner_url,updated_at").eq("store_id", row.id).maybeSingle();
    }
    if (!hubRes.error && hubRes.data) {
      merchant_hub = {
        ...hubRes.data,
        banner_url: hubRes.data.banner_url ? await resolveStoreImageUrl(sb, hubRes.data.banner_url) : null,
      };
    } else if (hubRes.error && !isStoreMerchantHubMissing(hubRes.error)) {
      console.warn("[store/my-store] merchant_hub", hubRes.error.message || hubRes.error);
    }

    if (base.logo_url) base.logo_url = await resolveStoreImageUrl(sb, base.logo_url);

    return ok(res, {
      store: {
        ...base,
        payout_bank: {
          bank_name: bankSafe.bank_name || null,
          bank_last4: bankSafe.bank_last4 || null,
          bank_country_code: bankSafe.bank_country_code || null,
          bank_iban_masked: bankSafe.bank_iban_masked || null,
          stc_pay_phone: bankSafe.stc_pay_phone || null,
          payout_crypto_interest: !!bankSafe.payout_crypto_interest,
          bank_verified: !!bankSafe.bank_verified,
        },
      },
      merchant_hub,
    });
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
      const rawCatFilter = String(req.query.category || "")
        .trim()
        .toLowerCase();
      const listTypeRaw = String(req.query.type || "").trim().toLowerCase();
      const cacheKey = `storelist-all:v4:${sortParam}|${mask ? "g" : "u"}|${geoKey}|c:${rawCatFilter || "none"}|t:${listTypeRaw || "all"}`;
      const redisListKey = `storelist:v2:${cacheKey}`;
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
      const mergedRestaurant = await fetchMergedRestaurantCategorySlugs(sb);
      const categoryFilter = rawCatFilter && mergedRestaurant.has(rawCatFilter) ? rawCatFilter : null;
      const marketTypesList = [
        "supermarket",
        "minimarket",
        "vegetables",
        "butcher",
        "fish",
        "home_business",
        "sweets",
        "flowers_gifts",
      ];
      const extendedSelAll =
        "id,name,phone,type,category,lat,lng,status,is_active,logo_url,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders,created_at";
      const baseSelAll = "id,name,phone,type,lat,lng,status,created_at";
      let rowsAll = [];
      let errAll = null;
      let qList = sb.from("stores").select(extendedSelAll).eq("status", "approved");
      if (categoryFilter) {
        qList = qList.eq("status", "approved");
      } else if (listTypeRaw === "restaurant") {
        /* يُصفّى لاحقاً — يشمل type=restaurant وتصنيف مطبخ (مثل كبسة) حتى لو type قديم */
      } else if (listTypeRaw === "market") {
        qList = qList.in("type", marketTypesList);
      } else if (listTypeRaw === "service") {
        qList = qList.in("type", ["services", "other"]);
      } else if (listTypeRaw && STORE_TYPES.has(listTypeRaw)) {
        qList = qList.eq("type", listTypeRaw);
      }
      ({ data: rowsAll, error: errAll } = await qList.order("created_at", { ascending: false }).limit(200));
      if (errAll && /column|does not exist|schema cache/i.test(String(errAll.message || ""))) {
        let qMin = sb.from("stores").select(baseSelAll).eq("status", "approved");
        if (categoryFilter) {
          /* يُصفّى في الذاكرة */
        } else if (listTypeRaw === "restaurant") {
        } else if (listTypeRaw === "market") {
          qMin = qMin.in("type", marketTypesList);
        } else if (listTypeRaw === "service") {
          qMin = qMin.in("type", ["services", "other"]);
        } else if (listTypeRaw && STORE_TYPES.has(listTypeRaw)) {
          qMin = qMin.eq("type", listTypeRaw);
        }
        ({ data: rowsAll, error: errAll } = await qMin.order("created_at", { ascending: false }).limit(200));
      }
      if (errAll) {
        if (isStoresTableMissing(errAll)) return ok(res, { ok: true, stores: [], browse_masked: mask });
        return fail(res, errAll.message, 400);
      }
      let rows = (rowsAll || []).filter((r) => storeRowIsListedActive(r));
      if (listTypeRaw === "restaurant" && !categoryFilter) {
        rows = rows.filter((r) => storeRowCountsAsRestaurant(r));
      }
      if (categoryFilter) {
        rows = rows.filter(
          (r) => storeRowCountsAsRestaurant(r) && restaurantRowMatchesCuisineFilter(r, categoryFilter, mergedRestaurant)
        );
      }
      if (userPos) {
        rows = filterAndSortStoresByUser(rows, userPos.lat, userPos.lng);
      } else {
        rows = sortStoresForBrowse(rows, sortParam);
      }
      const restSlugs = [
        ...new Set(
          rows
            .filter((r) => String(r.type || "").trim().toLowerCase() === "restaurant")
            .map((r) => String(r.category || "").trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      const marketSlugs = [
        ...new Set(
          rows
            .filter((r) => isMarketStoreType(r.type))
            .map((r) => String(r.category || "").trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      const [restaurantLabels, marketLabels] = await Promise.all([
        fetchCategoryLabelMap(sb, "restaurant", restSlugs),
        fetchCategoryLabelMap(sb, "market", marketSlugs),
      ]);
      const labelOpts = { restaurantLabels, marketLabels };
      const stores = rows.map((row, i) => {
        if (mask) {
          const m = maskStoreRowForGuest(row, i, labelOpts);
          m.id = row.id;
          if (userPos && row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
            m.distance_km = Number(row.distance_km);
          }
          return m;
        }
        return publicStoreRow(row, labelOpts);
      });
      const payload = {
        ok: true,
        stores,
        browse_masked: mask,
        sort: sortParam,
        geo_filtered: !!userPos,
        list_mode: "active_only",
        category_applied: categoryFilter || null,
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
    const cacheKey = `${browseType}|v3|${sortParam}|${mask ? "g" : "u"}|${geoKey}`;
    const redisListKey = `storelist:v2:${cacheKey}`;
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

    const restSlugs2 = [
      ...new Set(
        rows
          .filter((r) => String(r.type || "").trim().toLowerCase() === "restaurant")
          .map((r) => String(r.category || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    const marketSlugs2 = [
      ...new Set(
        rows
          .filter((r) => isMarketStoreType(r.type))
          .map((r) => String(r.category || "").trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    const [restaurantLabels2, marketLabels2] = await Promise.all([
      fetchCategoryLabelMap(sb, "restaurant", restSlugs2),
      fetchCategoryLabelMap(sb, "market", marketSlugs2),
    ]);
    const labelOpts2 = { restaurantLabels: restaurantLabels2, marketLabels: marketLabels2 };

    const stores = rows.map((row, i) => {
      if (mask) {
        const m = maskStoreRowForGuest(row, i, labelOpts2);
        m.id = row.id;
        if (userPos && row.distance_km != null && Number.isFinite(Number(row.distance_km))) {
          m.distance_km = Number(row.distance_km);
          if (row.within_delivery_radius != null) m.within_delivery_radius = row.within_delivery_radius;
        }
        return m;
      }
      return publicStoreRow(row, labelOpts2);
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

async function computeStoreCheckoutPaymentMethodsForPublic(sb, storeId) {
  const platform = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
  let hubPart = null;
  const hubRes = await sb.from("store_merchant_hub").select("checkout_payment_methods").eq("store_id", storeId).maybeSingle();
  if (!hubRes.error && hubRes.data && hubRes.data.checkout_payment_methods != null) {
    hubPart = hubRes.data.checkout_payment_methods;
  } else if (
    hubRes.error &&
    !isStoreMerchantHubMissing(hubRes.error) &&
    !/column|does not exist/i.test(String(hubRes.error.message || ""))
  ) {
    console.warn("[store] hub checkout_payment_methods", hubRes.error.message || hubRes.error);
  }
  return checkoutPaymentMethods.intersectMethods(platform, hubPart);
}

async function getPublicStoreById(req, res) {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "معرّف المتجر مطلوب", 400);

    const maskEarly = !req.appUser;
    const qLatEarly = Number(req.query.user_lat ?? req.query.userLat);
    const qLngEarly = Number(req.query.user_lng ?? req.query.userLng);
    const geoKeyEarly =
      Number.isFinite(qLatEarly) && Number.isFinite(qLngEarly)
        ? `${qLatEarly.toFixed(3)}:${qLngEarly.toFixed(3)}`
        : "nogeo";
    const storeCacheKey = `storepub:v1:${id}:${maskEarly ? "g" : "u"}:${geoKeyEarly}`;
    const redisStoreKey = `store:public:${storeCacheKey}`;
    const redisStoreHit = await cacheGetJson(redisStoreKey);
    if (redisStoreHit && redisStoreHit.store) {
      res.set("Cache-Control", "public, max-age=20");
      return ok(res, redisStoreHit);
    }
    const memHit = storePublicCache.get(storeCacheKey);
    if (memHit && Date.now() - memHit.at < STORE_PUBLIC_CACHE_TTL_MS && memHit.payload && memHit.payload.store) {
      res.set("Cache-Control", "public, max-age=20");
      return ok(res, memHit.payload);
    }

    let checkoutPayResolved = checkoutPaymentMethods.cloneDefaults();
    try {
      checkoutPayResolved = await computeStoreCheckoutPaymentMethodsForPublic(sb, id);
    } catch (pe) {
      console.warn("[store/public] checkout_payment_methods", pe && (pe.message || String(pe)));
    }

    const extendedSel =
      "id,name,phone,type,category,lat,lng,status,is_active,logo_url,location_text,address,delivery_radius_km,average_rating,rating_count,total_orders,profile_views";
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
    void sb
      .from("stores")
      .update({ profile_views: (Number(row.profile_views) || 0) + 1 })
      .eq("id", id)
      .then(() => {})
      .catch(() => {});
    if (Object.prototype.hasOwnProperty.call(row, "is_active") && row.is_active === false) {
      return fail(res, "المتجر غير متاح", 404);
    }

    const restMap =
      String(row.type || "").toLowerCase() === "restaurant"
        ? await fetchCategoryLabelMap(sb, "restaurant", [row.category])
        : new Map();
    const marketMap = isMarketStoreType(row.type)
      ? await fetchCategoryLabelMap(sb, "market", [row.category])
      : new Map();
    const rowLabelOpts = { restaurantLabels: restMap, marketLabels: marketMap };

    const mask = !req.appUser;
    const qLat = Number(req.query.user_lat ?? req.query.userLat);
    const qLng = Number(req.query.user_lng ?? req.query.userLng);

    let productCount = 0;
    const pc = await sb.from("store_products").select("id", { count: "exact", head: true }).eq("store_id", id).eq("active", true);
    if (!pc.error && typeof pc.count === "number") productCount = pc.count;
    else if (pc.error && !isStoreProductsMissing(pc.error)) {
      console.warn("[store/public] product count:", pc.error.message);
    }

    const hubPublic = await fetchMerchantHubPublic(sb, id);

    if (!mask) {
      const out = await attachPublicBranding(
        sb,
        {
          ...publicStoreRow(row),
          product_count: productCount,
        },
        row,
        hubPublic
      );
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
      out.checkout_payment_methods = checkoutPayResolved;
      const authPayload = {
        store: out,
        browse_masked: false,
      };
      storePublicCache.set(storeCacheKey, { at: Date.now(), payload: authPayload });
      await cacheSetJson(redisStoreKey, authPayload, STORE_PUBLIC_CACHE_TTL_MS);
      res.set("Cache-Control", "public, max-age=20");
      return ok(res, authPayload);
    }

    const fake = maskStoreRowForGuest(row, 0, rowLabelOpts);
    const maskedStore = await attachPublicBranding(
      sb,
      { ...fake, id: row.id, product_count: productCount },
      row,
      hubPublic
    );
    const maskedPayload = { store: maskedStore, browse_masked: true };
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
    maskedPayload.store.checkout_payment_methods = checkoutPayResolved;
    storePublicCache.set(storeCacheKey, { at: Date.now(), payload: maskedPayload });
    await cacheSetJson(redisStoreKey, maskedPayload, STORE_PUBLIC_CACHE_TTL_MS);
    res.set("Cache-Control", "public, max-age=20");
    return ok(res, maskedPayload);
  } catch (e) {
    console.error("[store/public]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
}

router.get("/public/:id", optionalAuth, getPublicStoreById);

router.get("/product-category-options", optionalAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const storeId = String(req.query.store_id || "").trim();
    if (!storeId) return fail(res, "store_id مطلوب", 400);

    const got = await loadApprovedStore(sb, storeId);
    if (got.error) return fail(res, got.error, 404);

    const catalogType = productCatalogTypeForStoreType(got.store.type);
    const options = await fetchProductCategoryCatalog(sb, catalogType);

    return ok(res, {
      catalog_type: catalogType,
      store_type: got.store.type || null,
      options,
    });
  } catch (e) {
    console.error("[store/product-category-options]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.get("/product-categories", optionalAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const storeId = String(req.query.store_id || "").trim();
    if (!storeId) return fail(res, "store_id مطلوب", 400);

    const got = await loadApprovedStore(sb, storeId);
    if (got.error) return fail(res, got.error, 404);

    const catalogType = productCatalogTypeForStoreType(got.store.type);

    const { data, error } = await sb
      .from("store_products")
      .select("category")
      .eq("store_id", storeId)
      .eq("active", true)
      .not("category", "is", null);

    if (error) {
      if (isStoreProductsMissing(error)) return ok(res, { categories: [], catalog_type: catalogType });
      return fail(res, error.message, 400);
    }

    const mergedSlugs = await fetchMergedProductCategorySlugs(sb, catalogType);
    const counts = new Map();
    for (const r of data || []) {
      const raw = String(r.category || "")
        .trim()
        .toLowerCase();
      if (!raw) continue;
      const slug = mergedSlugs.has(raw) ? raw : null;
      if (!slug) continue;
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }

    const categories = [...counts.entries()]
      .map(([slug, count]) => ({
        slug,
        label: labelForProductSlug(catalogType, slug, null) || productCategoryLabelAr(slug) || slug,
        icon: iconForProductSlug(catalogType, slug, null) || PRODUCT_CATEGORY_ICONS[slug] || "📦",
        count,
      }))
      .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), "ar"));

    return ok(res, {
      categories,
      catalog_type: catalogType,
      total_products_with_category: (data || []).length,
    });
  } catch (e) {
    console.error("[store/product-categories]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

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
    const catalogType = productCatalogTypeForStoreType(got.store.type);
    const catFilter = req.query.category
      ? await resolveProductCategorySlug(sb, catalogType, req.query.category)
      : null;
    if (req.query.category && !catFilter) {
      return fail(res, "قسم المنتج غير صالح لهذا النوع من المتاجر", 400);
    }

    const base = () =>
      sb
        .from("store_products")
        .select("*", { count: "exact" })
        .eq("store_id", storeId)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });

    let q = base();
    if (catFilter) q = q.eq("category", catFilter);
    let { data, error, count } = await q.range(offset, offset + limit - 1);

    if (error && catFilter && /category|column|does not exist|schema cache/i.test(String(error.message || ""))) {
      ({ data, error, count } = await base().range(offset, offset + limit - 1));
      if (!error && data) {
        const filtered = (data || []).filter((r) => String(r.category || "").trim().toLowerCase() === catFilter);
        data = filtered;
        count = filtered.length;
      }
    }

    if (error) {
      if (isStoreProductsMissing(error)) return ok(res, { products: [], total: 0, note: "نفّذ migration_store_marketplace.sql" });
      return fail(res, error.message, 400);
    }
    return ok(res, {
      products: mapProductsForApi(data || []),
      total: count ?? (data || []).length,
      limit,
      offset,
      category: catFilter || null,
    });
  } catch (e) {
    console.error("[store/products/get]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.post("/products", requireAuth, requireStoreRole, async (req, res) => {
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

    const imageUrls = await uploadProductImagesFromBody(sb, storeId, req.body);
    const imageUrl = imageUrls[0] || null;

    let offer_price =
      req.body?.offer_price != null && req.body.offer_price !== "" ? Number(req.body.offer_price) : null;
    if (offer_price != null) {
      if (!Number.isFinite(offer_price) || offer_price < 0) return fail(res, "سعر العرض غير صالح", 400);
      if (offer_price > price) return fail(res, "سعر العرض يجب أن يكون أقل أو يساوي السعر الأساسي", 400);
      if (offer_price === 0) offer_price = null;
    }

    const catalogType = productCatalogTypeForStoreType(own.store.type);
    let productCategory = null;
    if (req.body?.category != null && String(req.body.category).trim() !== "") {
      productCategory = await resolveProductCategorySlug(sb, catalogType, req.body.category);
      if (!productCategory) return fail(res, "قسم المنتج غير صالح لهذا النوع من المتجر", 400);
    }

    let stockVal = null;
    if (req.body?.stock !== undefined && req.body?.stock !== null && req.body?.stock !== "") {
      stockVal = Math.floor(Number(req.body.stock));
      if (!Number.isFinite(stockVal) || stockVal < 0) return fail(res, "المخزون غير صالح", 400);
    }

    let ratingVal = null;
    if (req.body?.rating !== undefined && req.body?.rating !== null && req.body?.rating !== "") {
      ratingVal = Number(req.body.rating);
      if (!Number.isFinite(ratingVal) || ratingVal < 0 || ratingVal > 5) return fail(res, "التقييم بين 0 و 5", 400);
      ratingVal = Math.round(ratingVal * 100) / 100;
    }

    const row = {
      store_id: storeId,
      name,
      description,
      price,
      ...(offer_price != null ? { offer_price } : {}),
      ...(productCategory ? { category: productCategory } : {}),
      ...(stockVal != null ? { stock: stockVal } : {}),
      ...(ratingVal != null ? { rating: ratingVal } : {}),
      image_url: imageUrl,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      active: true,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      updated_at: new Date().toISOString(),
    };
    if (req.body?.includes_delivery != null) row.includes_delivery = !!req.body.includes_delivery;

    let { data, error } = await sb.from("store_products").insert(row).select("*").single();
    if (
      error &&
      /category|stock|rating|image_urls|includes_delivery|column .* does not exist|schema cache/i.test(String(error.message || ""))
    ) {
      const rowMin = { ...row };
      delete rowMin.category;
      delete rowMin.stock;
      delete rowMin.rating;
      delete rowMin.image_urls;
      delete rowMin.includes_delivery;
      ({ data, error } = await sb.from("store_products").insert(rowMin).select("*").single());
    }
    if (error) {
      if (isStoreProductsMissing(error)) return fail(res, "جدول المنتجات غير جاهز — نفّذ migration_store_marketplace.sql", 400);
      return fail(res, error.message, 400);
    }
    if (productCategory) void incrementCategoryUsage(catalogType, productCategory);
    listCache = { key: "", at: 0, payload: null };
    return ok(res, { product: productRowWithImages(data) });
  } catch (e) {
    console.error("[store/products/post]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.put("/products/:id", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const productId = String(req.params.id || "").trim();
    if (!productId) return fail(res, "معرّف المنتج مطلوب", 400);

    const { data: existing, error: exErr } = await sb
      .from("store_products")
      .select("store_id,price,offer_price,category,image_url,image_urls")
      .eq("id", productId)
      .maybeSingle();
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
    if (req.body?.includes_delivery != null) patch.includes_delivery = !!req.body.includes_delivery;
    const catalogType = productCatalogTypeForStoreType(own.store.type);
    if (req.body?.category !== undefined) {
      if (req.body.category === null || req.body.category === "") {
        patch.category = null;
      } else {
        const c = await resolveProductCategorySlug(sb, catalogType, req.body.category);
        if (!c) return fail(res, "قسم المنتج غير صالح لهذا النوع من المتجر", 400);
        patch.category = c;
      }
    }
    if (req.body?.stock !== undefined) {
      if (req.body.stock === null || req.body.stock === "") {
        patch.stock = null;
      } else {
        const st = Math.floor(Number(req.body.stock));
        if (!Number.isFinite(st) || st < 0) return fail(res, "المخزون غير صالح", 400);
        patch.stock = st;
      }
    }
    if (req.body?.rating !== undefined) {
      if (req.body.rating === null || req.body.rating === "") {
        patch.rating = null;
      } else {
        const rt = Number(req.body.rating);
        if (!Number.isFinite(rt) || rt < 0 || rt > 5) return fail(res, "التقييم بين 0 و 5", 400);
        patch.rating = Math.round(rt * 100) / 100;
      }
    }
    if (req.body?.offer_price !== undefined) {
      if (req.body.offer_price === null || req.body.offer_price === "") {
        patch.offer_price = null;
      } else {
        const op = Number(req.body.offer_price);
        if (!Number.isFinite(op) || op < 0) return fail(res, "سعر العرض غير صالح", 400);
        const base = patch.price != null ? Number(patch.price) : Number(existing?.price);
        if (Number.isFinite(base) && op > base) {
          return fail(res, "سعر العرض يجب أن يكون أقل أو يساوي السعر الأساسي", 400);
        }
        patch.offer_price = op === 0 ? null : op;
      }
    }
    if (Array.isArray(req.body?.images_base64) && req.body.images_base64.length) {
      const urls = await uploadProductImagesFromBody(sb, existing.store_id, req.body);
      if (urls.length) {
        patch.image_urls = urls;
        patch.image_url = urls[0];
      }
    } else if (req.body?.image_base64) {
      const url = await uploadToStoreBucket(
        sb,
        existing.store_id,
        "products",
        req.body.image_base64,
        req.body.image_file_name || "product.jpg"
      );
      if (url) {
        const prev = productImageUrlsFromRow(existing);
        const merged = [url];
        prev.forEach((u) => {
          if (u && u !== url && !merged.includes(u)) merged.push(u);
        });
        patch.image_url = url;
        patch.image_urls = merged.slice(0, MAX_PRODUCT_IMAGES);
      }
    }

    const resolvedPrice = patch.price != null ? Number(patch.price) : Number(existing.price) || 0;
    const resolvedOffer =
      patch.offer_price !== undefined
        ? patch.offer_price
        : existing.offer_price != null
          ? Number(existing.offer_price)
          : null;
    if (
      resolvedOffer != null &&
      Number.isFinite(resolvedOffer) &&
      resolvedOffer > 0 &&
      Number.isFinite(resolvedPrice) &&
      resolvedOffer > resolvedPrice
    ) {
      patch.offer_price = null;
    }

    let { data, error } = await sb.from("store_products").update(patch).eq("id", productId).select("*").single();
    if (
      error &&
      /category|stock|rating|image_urls|includes_delivery|column .* does not exist|schema cache/i.test(String(error.message || ""))
    ) {
      const patchMin = { ...patch };
      delete patchMin.category;
      delete patchMin.stock;
      delete patchMin.rating;
      delete patchMin.image_urls;
      delete patchMin.includes_delivery;
      ({ data, error } = await sb.from("store_products").update(patchMin).eq("id", productId).select("*").single());
    }
    if (error) return fail(res, error.message, 400);
    listCache = { key: "", at: 0, payload: null };
    if (patch.category !== undefined) {
      const prevCat = existing.category != null ? String(existing.category).trim().toLowerCase() : "";
      const newCat =
        patch.category === null || patch.category === ""
          ? ""
          : String(patch.category).trim().toLowerCase();
      if (newCat && newCat !== prevCat) void incrementCategoryUsage(catalogType, newCat);
    }
    return ok(res, { product: productRowWithImages(data) });
  } catch (e) {
    console.error("[store/products/put]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.delete("/products/:id", requireAuth, requireStoreRole, async (req, res) => {
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
    /* store / merchant / restaurant — Store Account بدون تقييم كعميل */

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

/** نقاط المتاجر المعتمدة لخريطة تسجيل المتجر (بدون بيانات حساسة) */
router.get("/register-map-context", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return ok(res, { ok: true, stores: [] });

    const sel = "lat,lng,type";
    let rows = [];
    let err = null;
    ({ data: rows, error: err } = await sb
      .from("stores")
      .select(sel)
      .eq("status", "approved")
      .not("lat", "is", null)
      .not("lng", "is", null)
      .limit(300));
    if (err && /column|does not exist|schema cache/i.test(String(err.message || ""))) {
      return ok(res, { ok: true, stores: [] });
    }
    if (err) return fail(res, err.message, 400);

    const stores = (rows || [])
      .filter((r) => storeRowIsListedActive(r))
      .map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        type: r.type || null,
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

    res.set("Cache-Control", "public, max-age=120");
    return ok(res, { ok: true, stores });
  } catch (e) {
    console.error("[store/register-map-context]", e);
    return ok(res, { ok: true, stores: [] });
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
    const type = String(b.type || "").trim().toLowerCase();
    const restaurantCategoryRaw = String(b.restaurant_category || b.restaurantCategory || "").trim().toLowerCase();
    const storeCategorySlug = String(b.category || b.store_category || "").trim().toLowerCase();

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

    let categoryValue = type;
    if (type === "restaurant") {
      const slugSrc = restaurantCategoryRaw || storeCategorySlug;
      const resolved = await resolvePublicCategorySlug(sb, "restaurant", slugSrc);
      if (!resolved) {
        return fail(res, "اختر نوع المطعم (تصنيف المأكولات) من القائمة المعتمدة", 400);
      }
      categoryValue = resolved;
    } else if (type === "supermarket") {
      const resolved = await resolvePublicCategorySlug(sb, "market", storeCategorySlug);
      if (!resolved) {
        return fail(res, "اختر قسم البقالة من القائمة المعتمدة", 400);
      }
      categoryValue = resolved;
    }

    const phoneDisplay = phoneRaw || phoneDigits;

    let payoutCols = {};
    let parsedPayout = {};
    try {
      parsedPayout = parseOptionalPayoutPayload({ payout: b.payout });
      await assertStorePhoneNotDuplicateForRegister(sb, phoneDigits);
      if (parsedPayout.iban) {
        await assertPayoutIbanGloballyAvailable(sb, parsedPayout.iban, {
          ownerPhonesDigits: [phoneDigits],
        });
      }
      payoutCols = payoutRowForDriversOrStores(parsedPayout);
    } catch (pe) {
      return fail(res, pe.message || "بيانات الدفع غير صالحة", 400);
    }

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
      category: categoryValue,
      is_active: false,
      status: "pending",
      ...payoutCols,
    };

    if (location_text) row.location_text = location_text;

    let insertedRow = null;
    let insErr = null;
    ({ data: insertedRow, error: insErr } = await sb.from("stores").insert(row).select("id").single());
    if (
      insErr &&
      /location_text|address|delivery_radius_km|is_active|category|commercial_registration|\bemail\b|file_url|\blat\b|\blng\b|bank_country|bank_name|bank_iban|bank_account|bank_swift|bank_last4|bank_verified|bank_added|bank_account_name|\biban\b|stc_pay|payout_crypto|column .* does not exist|schema cache/i.test(
        String(insErr.message || "")
      )
    ) {
      delete row.location_text;
      delete row.address;
      delete row.delivery_radius_km;
      delete row.is_active;
      delete row.category;
      delete row.commercial_registration;
      delete row.email;
      delete row.file_url;
      delete row.lat;
      delete row.lng;
      delete row.bank_country_code;
      delete row.bank_name;
      delete row.iban;
      delete row.bank_iban;
      delete row.bank_account_number;
      delete row.bank_swift_code;
      delete row.bank_account_name;
      delete row.bank_last4;
      delete row.bank_verified;
      delete row.bank_added_at;
      delete row.stc_pay_phone;
      delete row.payout_iban_fingerprint;
      delete row.payout_crypto_interest;
      ({ data: insertedRow, error: insErr } = await sb.from("stores").insert(row).select("id").single());
    }
    if (insErr) {
      console.error("[store/register] insert FULL:", {
        message: insErr?.message,
        details: insErr?.details,
        code: insErr?.code,
        hint: insErr?.hint,
      });
      const em = String(insErr.message || insErr.details || "");
      if (/unique|duplicate|23505|uq_stores_phone|stores_phone/i.test(em)) {
        return fail(res, "رقم الجوال مسجّل مسبقاً لمتجر قيد المراجعة أو معتمد", 400);
      }
      if (/unique|duplicate|23505|payout_iban|fingerprint/i.test(em)) {
        return fail(res, "هذا الآيبان مسجّل لمتجر أو حساب آخر", 400);
      }
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

    let logoUploaded = false;
    let bannerUploaded = false;
    if (b.logoFileBase64) {
      const logoUrl = await uploadToStoreBucket(sb, requestId, "logo", b.logoFileBase64, b.logoFileName || "logo.jpg");
      if (logoUrl) {
        logoUploaded = true;
        const up = await sb.from("stores").update({ logo_url: logoUrl }).eq("id", requestId);
        if (up.error && /logo_url|column/i.test(String(up.error.message || ""))) {
          console.warn("[store/register] logo_url column missing — migration_store_marketplace.sql");
          logoUploaded = false;
        }
      }
    }
    const bannerB64 = b.bannerFileBase64 || b.coverFileBase64;
    if (bannerB64 && String(bannerB64).length > 40) {
      const bannerUrl = await uploadToStoreBucket(
        sb,
        requestId,
        "banner",
        bannerB64,
        b.bannerFileName || b.coverFileName || "banner.jpg"
      );
      if (bannerUrl) {
        bannerUploaded = true;
        await upsertStoreMerchantHubBranding(sb, requestId, { banner_url: bannerUrl });
      }
    }

    const mapsUrl =
      lat != null && lng != null
        ? `${address} — https://maps.google.com/?q=${encodeURIComponent(String(lat) + "," + String(lng))}`
        : address;

    const typeLabel = TYPE_LABEL_AR[type] || type;
    let cuisineLine = "";
    if (type === "restaurant" && categoryValue) {
      const lab = restaurantCategoryLabelAr(categoryValue) || categoryValue;
      cuisineLine = `تصنيف المطعم: ${lab}`;
    } else if (type === "supermarket" && categoryValue) {
      cuisineLine = `قسم البقالة: ${categoryValue}`;
    }

    const payoutSummaryParts = [];
    if (parsedPayout.iban) payoutSummaryParts.push("آيبان: تم الإرفاق");
    if (parsedPayout.stc_pay_phone) payoutSummaryParts.push("STC Pay: تم الإرفاق");
    if (parsedPayout.payout_crypto_interest) payoutSummaryParts.push("اهتمام بالعملات المشفرة: نعم");
    const payoutSummary = payoutSummaryParts.length ? payoutSummaryParts.join("\n") : "";

    try {
      await notifyAdminWhatsApp({
        name,
        phoneDisplay,
        typeLabel,
        mapsUrl,
        requestId,
        payoutSummary,
        cuisineLine: cuisineLine || undefined,
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
      logo_uploaded: logoUploaded,
      banner_uploaded: bannerUploaded,
      headline: "تم تسجيل المتجر",
      subline: "بانتظار الموافقة",
      message: "✅ تم تسجيل المتجر\n⏳ بانتظار الموافقة",
    });
  } catch (e) {
    console.error("[store/register]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

function isStoreFinancialMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /store_wallets|store_transactions|schema cache|function.*store_wallet_credit|relation .*store_wallets|relation .*store_transactions/i.test(
    msg
  );
}

function isStoreMerchantHubMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /store_merchant_hub|schema cache|relation .*store_merchant_hub/i.test(msg);
}

router.get("/wallet", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const { data: st, error: sErr } = await sb
      .from("stores")
      .select("id")
      .eq("phone", digits)
      .eq("status", "approved")
      .maybeSingle();
    if (sErr) return fail(res, sErr.message, 400);
    if (!st) return fail(res, "لا يوجد متجر معتمد لجوالك.", 404);

    const wallet = await getStoreWalletPayloadWithFallback(sb, req.appUser.id, st.id);
    return ok(res, { wallet });
  } catch (e) {
    console.error("[store/wallet]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.get("/merchant-dashboard", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const extStore = "id,name,phone,status,total_orders,type,category,logo_url,average_rating,rating_count,profile_views";
    let st = null;
    let sErr = null;
    ({ data: st, error: sErr } = await sb.from("stores").select(extStore).eq("phone", digits).eq("status", "approved").maybeSingle());
    if (sErr && /column|does not exist|schema cache/i.test(String(sErr.message || ""))) {
      ({ data: st, error: sErr } = await sb
        .from("stores")
        .select("id,name,phone,status,type,category,logo_url")
        .eq("phone", digits)
        .eq("status", "approved")
        .maybeSingle());
    }
    if (sErr) return fail(res, sErr.message, 400);
    if (!st) return fail(res, "لا يوجد متجر معتمد لجوالك.", 404);

    const sid = st.id;
    const [oRes, walletPayload, txRes, pCountRes] = await Promise.all([
      sb
        .from("orders")
        .select(
          "id,order_number,order_total,total_with_vat,delivery_fee,platform_fee,status,delivery_status,created_at,breakdown,customer_phone,drop_address,store_id,payment_status,payment_method"
        )
        .eq("store_id", sid)
        .order("created_at", { ascending: false })
        .limit(100),
      getStoreWalletPayloadWithFallback(sb, req.appUser.id, sid),
      sb
        .from("store_transactions")
        .select("id,amount,type,description,created_at,order_id")
        .eq("store_id", sid)
        .order("created_at", { ascending: false })
        .limit(40),
      sb.from("store_products").select("id", { count: "exact", head: true }).eq("store_id", sid).eq("active", true),
    ]);

    let orders = [];
    if (oRes.error) {
      if (!isStoresTableMissing(oRes.error)) console.warn("[merchant-dashboard] orders", oRes.error.message || oRes.error);
    } else {
      orders = oRes.data || [];
    }

    let wallet = {
      balance: walletPayload.balance,
      currency_code: walletPayload.currency_code || "SAR",
      total_earned: walletPayload.total_earned,
      total_commission: walletPayload.total_commission,
      source: walletPayload.source,
      wallet_mode: walletPayload.wallet_mode,
    };

    let transactions = [];
    if (!txRes.error && txRes.data) transactions = txRes.data;
    else if (txRes.error && !isStoreFinancialMissing(txRes.error)) {
      console.warn("[merchant-dashboard] tx", txRes.error.message || txRes.error);
    }

    let products_active_count = 0;
    if (!pCountRes.error && typeof pCountRes.count === "number") products_active_count = pCountRes.count;
    else if (pCountRes.error && !isStoreProductsMissing(pCountRes.error)) {
      console.warn("[merchant-dashboard] products count", pCountRes.error.message || pCountRes.error);
    }

    const revenue_orders_sum = orders.reduce((a, r) => a + (Number(r.order_total) || 0), 0);

    return ok(res, {
      store: {
        id: st.id,
        name: st.name,
        phone: st.phone,
        type: st.type || null,
        category: st.category || null,
        logo_url: st.logo_url || null,
        total_orders: st.total_orders != null ? Number(st.total_orders) : null,
        average_rating: st.average_rating != null ? Number(st.average_rating) : 0,
        rating_count: st.rating_count != null ? Number(st.rating_count) : 0,
        profile_views: st.profile_views != null ? Number(st.profile_views) : 0,
      },
      wallet,
      transactions,
      orders,
      aggregates: {
        orders_count: orders.length,
        products_active_count,
        revenue_orders_sum,
      },
    });
  } catch (e) {
    console.error("[merchant-dashboard]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.patch("/merchant-hub", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const { data: st, error: sErr } = await sb.from("stores").select("id").eq("phone", digits).eq("status", "approved").maybeSingle();
    if (sErr) return fail(res, sErr.message, 400);
    if (!st) return fail(res, "لا يوجد متجر معتمد لجوالك.", 404);

    const b = req.body || {};
    let bioNext;
    if (Object.prototype.hasOwnProperty.call(b, "bio")) {
      const t = String(b.bio ?? "").trim();
      bioNext = t || null;
    }

    let bannerNext;
    if (b.banner_base64 && typeof b.banner_base64 === "string" && String(b.banner_base64).length > 40) {
      const fn = String(b.banner_file_name || "banner.jpg");
      const url = await uploadToStoreBucket(sb, st.id, "banner", b.banner_base64, fn);
      if (url) bannerNext = url;
    }

    if (b.logo_base64 && typeof b.logo_base64 === "string" && String(b.logo_base64).length > 40) {
      const fn = String(b.logo_file_name || "logo.jpg");
      const logoUrl = await uploadToStoreBucket(sb, st.id, "logo", b.logo_base64, fn);
      if (logoUrl) {
        const upLogo = await sb.from("stores").update({ logo_url: logoUrl }).eq("id", st.id);
        if (upLogo.error && /logo_url|column/i.test(String(upLogo.error.message || ""))) {
          console.warn("[store/merchant-hub] logo_url column missing");
        } else {
          listCache = { key: "", at: 0, payload: null };
        }
      }
    }

    let ex = null;
    let exErr = null;
    ({ data: ex, error: exErr } = await sb
      .from("store_merchant_hub")
      .select("bio,banner_url,checkout_payment_methods")
      .eq("store_id", st.id)
      .maybeSingle());
    if (exErr && /column|does not exist|schema cache/i.test(String(exErr.message || ""))) {
      const retry = await sb.from("store_merchant_hub").select("bio,banner_url").eq("store_id", st.id).maybeSingle();
      if (!retry.error) {
        ex = retry.data;
        exErr = null;
      }
    }
    if (exErr) {
      if (isStoreMerchantHubMissing(exErr)) {
        return fail(res, "جدول store_merchant_hub غير جاهز — نفّذ shared/migration_store_merchant_hub.sql", 400);
      }
      return fail(res, exErr.message, 400);
    }

    const merged = {
      store_id: st.id,
      bio: bioNext !== undefined ? bioNext : ex?.bio ?? null,
      banner_url: bannerNext !== undefined ? bannerNext : ex?.banner_url ?? null,
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(b, "checkout_payment_methods")) {
      const platform = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
      merged.checkout_payment_methods = checkoutPaymentMethods.intersectMethods(
        platform,
        checkoutPaymentMethods.normalizeMethodsPartial(b.checkout_payment_methods)
      );
    } else if (ex && ex.checkout_payment_methods != null) {
      merged.checkout_payment_methods = ex.checkout_payment_methods;
    }

    const { data: saved, error: upErr } = await sb
      .from("store_merchant_hub")
      .upsert(merged, { onConflict: "store_id" })
      .select("bio,banner_url,checkout_payment_methods,updated_at,created_at")
      .single();
    if (upErr && /column|does not exist|schema cache/i.test(String(upErr.message || ""))) {
      const { data: saved2, error: upErr2 } = await sb
        .from("store_merchant_hub")
        .upsert(
          { store_id: merged.store_id, bio: merged.bio, banner_url: merged.banner_url, updated_at: merged.updated_at },
          { onConflict: "store_id" }
        )
        .select("bio,banner_url,updated_at,created_at")
        .single();
      if (upErr2) {
        if (isStoreMerchantHubMissing(upErr2)) {
          return fail(res, "جدول store_merchant_hub غير جاهز — نفّذ shared/migration_store_merchant_hub.sql", 400);
        }
        return fail(res, upErr2.message, 400);
      }
      listCache = { key: "", at: 0, payload: null };
      const hubOut2 = saved2 || merged;
      if (hubOut2 && hubOut2.banner_url) hubOut2.banner_url = await resolveStoreImageUrl(sb, hubOut2.banner_url);
      return ok(res, { ok: true, merchant_hub: hubOut2 });
    }
    if (upErr) {
      if (isStoreMerchantHubMissing(upErr)) {
        return fail(res, "جدول store_merchant_hub غير جاهز — نفّذ shared/migration_store_merchant_hub.sql", 400);
      }
      return fail(res, upErr.message, 400);
    }
    listCache = { key: "", at: 0, payload: null };
    const hubOut = saved || merged;
    if (hubOut && hubOut.banner_url) hubOut.banner_url = await resolveStoreImageUrl(sb, hubOut.banner_url);
    return ok(res, { ok: true, merchant_hub: hubOut });
  } catch (e) {
    console.error("[store/merchant-hub/patch]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.get("/withdrawals", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const digits = normalizePhone(req.appUser.phone);
    const { data: st, error: sErr } = await sb
      .from("stores")
      .select("id")
      .eq("phone", digits)
      .eq("status", "approved")
      .maybeSingle();
    if (sErr) return fail(res, sErr.message, 400);
    if (!st) return fail(res, "لا يوجد متجر معتمد لجوالك.", 404);

    const { data, error } = await sb
      .from("store_withdrawals")
      .select("id,store_id,amount,status,created_at,updated_at")
      .eq("store_id", st.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (isStoreWithdrawalsMissing(error)) return ok(res, { withdrawals: [], note: "migration_store_withdrawals.sql" });
      return fail(res, error.message, 400);
    }
    return ok(res, { withdrawals: data || [] });
  } catch (e) {
    console.error("[store/withdrawals/list]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

router.post("/withdrawals", requireAuth, requireStoreRole, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 10) {
      return fail(res, "المبلغ يجب أن يكون 10 ريال أو أكثر", 400);
    }

    const digits = normalizePhone(req.appUser.phone);
    const { data: st, error: sErr } = await sb
      .from("stores")
      .select("id")
      .eq("phone", digits)
      .eq("status", "approved")
      .maybeSingle();
    if (sErr) return fail(res, sErr.message, 400);
    if (!st) return fail(res, "لا يوجد متجر معتمد لجوالك.", 404);
    const sid = st.id;

    const submitted = stripIban(req.body?.iban);
    if (!submitted) {
      return fail(res, "أدخل الآيبان مطابقاً لما سجّلته عند تسجيل المتجر لتأكيد طلب السحب", 400);
    }

    const { data: stBank, error: stBankErr } = await sb
      .from("stores")
      .select("bank_iban, payout_iban_fingerprint")
      .eq("id", sid)
      .maybeSingle();
    if (stBankErr) return fail(res, stBankErr.message, 400);
    if (!stBank?.bank_iban && !stBank?.payout_iban_fingerprint) {
      return fail(
        res,
        "لا يوجد آيبان مسجّل للمتجر — سجّل بيانات الحساب في طلب فتح المتجر أو تواصل مع الإدارة",
        400
      );
    }

    let ibanMatches = false;
    if (stBank.payout_iban_fingerprint) {
      ibanMatches = stBank.payout_iban_fingerprint === ibanFingerprintFromPlain(submitted);
    }
    if (!ibanMatches && stBank.bank_iban) {
      try {
        const plain = decrypt(stBank.bank_iban);
        ibanMatches = stripIban(plain) === submitted;
      } catch (_de) {
        return fail(res, "تعذر التحقق من الآيبان — تحقق من إعدادات الخادم", 500);
      }
    }
    if (!ibanMatches) {
      return fail(res, "الآيبان لا يطابق بيانات المتجر المسجّلة", 400);
    }

    const wallet = await getStoreWalletPayloadWithFallback(sb, req.appUser.id, sid);
    const balance = Number(wallet.balance) || 0;

    const { data: pendRows, error: pErr } = await sb
      .from("store_withdrawals")
      .select("amount")
      .eq("store_id", sid)
      .eq("status", "pending");
    if (pErr && !isStoreWithdrawalsMissing(pErr)) return fail(res, pErr.message, 400);
    const reserved = (pendRows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const available = Math.round((balance - reserved) * 100) / 100;
    if (amount > available) {
      return fail(res, `المبلغ المتاح للطلب: ${available.toFixed(2)} ريال (بعد خصم طلبات السحب قيد المراجعة)`, 400);
    }

    const { data: ins, error: insErr } = await sb
      .from("store_withdrawals")
      .insert({
        store_id: sid,
        amount,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .select("id,store_id,amount,status,created_at")
      .single();
    if (insErr) {
      if (isStoreWithdrawalsMissing(insErr)) {
        return fail(res, "جدول طلبات السحب غير جاهز — نفّذ migration_store_withdrawals.sql", 400);
      }
      return fail(res, insErr.message, 400);
    }
    return ok(res, { withdrawal: ins });
  } catch (e) {
    console.error("[store/withdrawals/post]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

/** GET /api/store/:id — نفس استجابة /public/:id (يُسجّل آخراً حتى لا يتعارض مع /products وغيره) */
const STORE_GET_BY_ID_RESERVED = new Set([
  "products",
  "product-categories",
  "product-category-options",
  "reviews",
  "register",
  "register-map-context",
  "public",
  "my-store",
  "merchant-dashboard",
  "merchant-hub",
  "withdrawals",
  "delivery-policy",
  "resolve-maps-link",
  "delivery-engine",
  "orders",
]);

function isStoreWithdrawalsMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /store_withdrawals|schema cache|relation .*store_withdrawals/i.test(msg);
}
router.get("/:id", optionalAuth, async (req, res, next) => {
  const raw = String(req.params.id || "").trim();
  if (!raw || STORE_GET_BY_ID_RESERVED.has(raw.toLowerCase())) return next();
  return getPublicStoreById(req, res);
});

router.use(
  "/",
  deliveryEngineRouter({
    loadApprovedStore,
    assertMerchantOwnsStore,
    resolveMerchantStoreByPhone,
  })
);

module.exports = router;
