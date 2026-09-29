const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { roughDistanceKm } = require("../../shared/utils/geo");
const { storeRowIsListedActive } = require("../../shared/utils/storePublication");
const { restaurantCategoryLabelAr } = require("../../shared/restaurantCategories");
const { readPlatformSetting } = require("../../shared/utils/platformSettingsCache");
const { HOME_SERVICE_CATALOG } = require("../../shared/utils/homeServicePricing");
const {
  MIN_RATING_COUNT,
  DEMAND_WINDOW_DAYS,
  DELIVERY_LINKS,
  laneForStoreType,
  laneForServiceType,
  restaurantChips,
  storeTypeChips,
  serviceChips,
  deliveryChips,
  rankTopRated,
  aggregateDemand,
  rankMostOrdered,
  buildPublicStats,
  demandSinceIso,
} = require("../../shared/utils/homeHighlights");

const router = express.Router();

const STORE_SELECTS = [
  "id,name,type,category,logo_url,lat,lng,status,is_active,average_rating,rating_count,publication_status",
  "id,name,type,category,logo_url,lat,lng,status,is_active,average_rating,rating_count",
  "id,name,type,category,logo_url,lat,lng,status,average_rating,rating_count",
];

const ORDER_SELECTS = [
  "id,store_id,order_type,service_type,delivery_status,status,created_at,city",
  "id,store_id,order_type,service_type,delivery_status,status,created_at",
  "id,store_id,delivery_status,status,created_at",
];

function finiteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function laneImage(lane) {
  if (lane === "restaurant") return "/assets/cat-restaurants.jpg";
  if (lane === "delivery") return "/assets/cat-delivery.jpg";
  if (lane === "service") return "/assets/cat-services.jpg";
  return "/assets/cat-stores.jpg";
}

function publicImage(url, lane) {
  const raw = url != null ? String(url).trim() : "";
  if (!raw) return laneImage(lane);
  if (raw.startsWith("/") || /^https?:\/\//i.test(raw)) return raw;
  return laneImage(lane);
}

async function selectFirst(sb, table, selects, apply) {
  let lastError = null;
  for (const columns of selects) {
    let query = sb.from(table).select(columns);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (!error) return { rows: data || [], error: null };
    lastError = error;
    if (!/column|schema cache|does not exist/i.test(String(error.message || ""))) break;
  }
  return { rows: [], error: lastError };
}

function storeCard(row, distanceKm) {
  const lane = laneForStoreType(row.type);
  const ratingAvg = Number(row.average_rating) || 0;
  const ratingCount = Number(row.rating_count) || 0;
  return {
    id: String(row.id),
    name: String(row.name || "").trim() || (lane === "restaurant" ? "مطعم" : "متجر"),
    lane,
    tag: lane === "restaurant" ? "مطاعم" : "متجر",
    href: "/store.html?id=" + encodeURIComponent(String(row.id)),
    image_url: publicImage(row.logo_url, lane),
    rating_avg: ratingAvg,
    rating_count: ratingCount,
    distance_km: distanceKm,
  };
}

function serviceDemandCard(key, count) {
  const lane = laneForServiceType(key);
  const delivery = DELIVERY_LINKS[key];
  const catalog = HOME_SERVICE_CATALOG[key];
  const label = (delivery && delivery.label) || (catalog && catalog.label) || "";
  if (!label) return null;
  return {
    id: "service:" + key,
    name: label,
    lane,
    tag: lane === "delivery" ? "توصيل" : "خدمة",
    href: (delivery && delivery.href) || "/services",
    image_url: laneImage(lane),
    rating_avg: 0,
    rating_count: 0,
    recent_orders: count,
  };
}

function withMeta(card, windowDays) {
  const out = {
    id: card.id,
    name: card.name,
    lane: card.lane,
    tag: card.tag,
    href: card.href,
    image_url: card.image_url,
    rating_avg: Number(card.rating_avg) || 0,
    rating_count: Number(card.rating_count) || 0,
    recent_orders: Number(card.recent_orders) || 0,
  };
  if (card.distance_km != null && Number.isFinite(Number(card.distance_km))) {
    out.distance_km = Math.round(Number(card.distance_km) * 10) / 10;
  }
  if (out.recent_orders > 0) {
    out.meta = out.recent_orders + " طلب خلال " + windowDays + " يوم";
    if (out.distance_km != null) out.meta += " · " + out.distance_km + " كم";
  } else if (out.rating_count > 0) {
    out.meta = out.rating_count + " تقييم";
    if (out.distance_km != null) out.meta += " · " + out.distance_km + " كم";
  } else {
    out.meta = "";
  }
  return out;
}

router.get("/highlights", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "الخادم غير مهيأ لقاعدة البيانات", 503);

    const userLat = finiteCoord(req.query.user_lat);
    const userLng = finiteCoord(req.query.user_lng);
    const hasGeo = userLat != null && userLng != null && Math.abs(userLat) <= 90 && Math.abs(userLng) <= 180;

    const storeResult = await selectFirst(sb, "stores", STORE_SELECTS, (query) => query.eq("status", "approved").limit(800));
    if (storeResult.error) return fail(res, storeResult.error.message || "تعذر قراءة المتاجر", 500);

    const listed = storeResult.rows.filter((row) => storeRowIsListedActive(row));
    const storeCards = listed.map((row) => {
      let distance = null;
      if (hasGeo && row.lat != null && row.lng != null) {
        const km = roughDistanceKm(userLat, userLng, Number(row.lat), Number(row.lng));
        if (Number.isFinite(km)) distance = km;
      }
      return storeCard(row, distance);
    });

    let providers = [];
    const providerResult = await selectFirst(sb, "users", [
      "id,name,role,service_type,service_rating_avg,service_rating_count",
    ], (query) => query.eq("role", "service").limit(200));
    if (!providerResult.error) {
      providers = providerResult.rows
        .map((row) => {
          const key = String(row.service_type || "").trim().toLowerCase();
          const catalog = HOME_SERVICE_CATALOG[key];
          return {
            id: "provider:" + row.id,
            name: String(row.name || "").trim() || (catalog && catalog.label) || "خدمة",
            lane: "service",
            tag: "خدمة",
            href: "/services",
            image_url: laneImage("service"),
            rating_avg: Number(row.service_rating_avg) || 0,
            rating_count: Number(row.service_rating_count) || 0,
            distance_km: null,
          };
        });
    }

    const since = demandSinceIso(new Date(), DEMAND_WINDOW_DAYS);
    const orderResult = await selectFirst(sb, "orders", ORDER_SELECTS, (query) =>
      query.gte("created_at", since).limit(2000)
    );
    const demand = aggregateDemand(orderResult.error ? [] : orderResult.rows, since);
    const demandCards = storeCards.map((card) => ({ ...card }));
    demand.serviceCounts.forEach((row) => {
      const extra = serviceDemandCard(row.key, row.count);
      if (extra) demandCards.push(extra);
    });
    const demandMap = new Map(demandCards.map((card) => [String(card.id), 0]));
    demand.byStore.forEach((count, id) => demandMap.set(String(id), count));
    demand.serviceCounts.forEach((row) => demandMap.set("service:" + row.key, row.count));

    const topRated = rankTopRated(storeCards.concat(providers), MIN_RATING_COUNT)
      .slice(0, 8)
      .map((card) => withMeta(card, DEMAND_WINDOW_DAYS));
    const mostOrdered = rankMostOrdered(demandCards, demandMap)
      .slice(0, 12)
      .map((card, index) => {
        const item = withMeta(card, DEMAND_WINDOW_DAYS);
        item.tag = "#" + (index + 1);
        return item;
      });

    const catalogLabels = {};
    Object.keys(HOME_SERVICE_CATALOG || {}).forEach((key) => {
      catalogLabels[key] = HOME_SERVICE_CATALOG[key] && HOME_SERVICE_CATALOG[key].label;
    });

    let settings = null;
    try {
      settings = await readPlatformSetting(sb, "home_public_stats");
    } catch (e) {
      settings = null;
    }

    let customerCount = null;
    const customerQuery = await sb.from("users").select("id", { count: "exact", head: true }).eq("role", "customer");
    if (!customerQuery.error && customerQuery.count != null) customerCount = customerQuery.count;

    const stats = buildPublicStats({
      settings,
      customerCount,
      storeCount: listed.length,
      cityCount: demand.cities.size,
    });

    res.set("Cache-Control", "public, max-age=30");
    return ok(res, {
      min_rating_count: MIN_RATING_COUNT,
      demand_window_days: DEMAND_WINDOW_DAYS,
      demand_error: Boolean(orderResult.error),
      stats,
      gates: {
        restaurants: restaurantChips(listed, restaurantCategoryLabelAr),
        stores: storeTypeChips(listed),
        delivery: deliveryChips(demand.serviceCounts),
        services: serviceChips(demand.serviceCounts, catalogLabels),
      },
      top_rated: topRated,
      most_ordered: mostOrdered,
    });
  } catch (e) {
    console.error("[home/highlights]", e);
    return fail(res, e.message || "تعذر تجهيز الصفحة الرئيسية", 500);
  }
});

module.exports = router;
