/**
 * ERVENOW — طلب توصيل من الخريطة: تحليل روابط Google Maps ومساعدة السلة.
 */
(function (global) {
  "use strict";

  var PRODUCT_TYPES = {
    clothes: "ملابس",
    bag: "شنطة / حقيبة",
    groceries: "مواد غذائية",
    kitchenware: "أواني",
    documents: "مستندات",
    electronics: "إلكترونيات",
    other: "أخرى",
  };

  function parseLatLngPair(s) {
    var t = String(s || "").trim();
    if (!t.includes(",")) return null;
    var parts = t.split(",");
    if (parts.length < 2) return null;
    var lat = parseFloat(String(parts[0]).trim());
    var lng = parseFloat(String(parts[1]).trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  /**
   * استخراج إحداثيات من رابط Google Maps / Apple / lat,lng
   * @returns {{ lat: number, lng: number } | null}
   */
  function parseMapsUrl(input) {
    var raw = String(input || "").trim();
    if (!raw) return null;

    var direct = parseLatLngPair(raw);
    if (direct) return direct;

    var s = raw;
    if (!/^https?:\/\//i.test(s)) {
      if (/^(maps\.|www\.|goo\.)/i.test(s)) s = "https://" + s;
      else if (s.indexOf("google.com") !== -1 || s.indexOf("goo.gl") !== -1) s = "https://" + s;
    }

    var patterns = [
      /@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:[,/]|$)/,
      /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
      /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)(?:&|$)/,
      /[?&]query=(-?\d+\.?\d*),(-?\d+\.?\d*)(?:&|$)/,
      /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)(?:&|$)/,
      /\/place\/[^/]*\/(-?\d+\.?\d*),(-?\d+\.?\d*)/,
      /\/dir\/[^/]*\/(-?\d+\.?\d*),(-?\d+\.?\d*)/,
      /\/(-?\d+\.?\d*),(-?\d+\.?\d*)(?:\/|$|\?)/,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]);
        var lng = parseFloat(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat: lat, lng: lng };
        }
      }
    }

    try {
      var u = new URL(s);
      var q =
        u.searchParams.get("q") ||
        u.searchParams.get("query") ||
        u.searchParams.get("ll") ||
        u.searchParams.get("destination");
      if (q) {
        var fromQ = parseLatLngPair(q);
        if (fromQ) return fromQ;
      }
    } catch (e) {}

    return null;
  }

  function buildGoogleMapsUrl(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return "https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lng);
  }

  function getProductLabel(typeKey, note) {
    var key = String(typeKey || "other").toLowerCase();
    var base = PRODUCT_TYPES[key] || PRODUCT_TYPES.other;
    var n = String(note || "").trim();
    if (key === "other" && n) return n.slice(0, 120);
    if (n) return base + " — " + n.slice(0, 80);
    return base;
  }

  function formatProductLine(typeKey, qty, note) {
    var q = Math.max(1, Math.min(99, parseInt(String(qty || "1"), 10) || 1));
    var label = getProductLabel(typeKey, note);
    return label + " × " + q;
  }

  function isMapDeliveryOrder(order) {
    if (!order) return false;
    var notes = String(order.notes || "");
    if (/توصيل من الخريطة|dashboard_map/i.test(notes)) return true;
    var b = order.breakdown;
    var items = b && Array.isArray(b.items) ? b.items : [];
    if (!items.length) return false;
    var d = items[0] && items[0].data ? items[0].data : {};
    return String(d.source || "") === "dashboard_map";
  }

  function productLineFromOrder(order) {
    var b = order && order.breakdown;
    var items = b && Array.isArray(b.items) ? b.items : [];
    var first = items[0] || {};
    var d = first.data && typeof first.data === "object" ? first.data : {};
    if (d.product_label) return String(d.product_label);
    if (d.product_category) {
      return formatProductLine(d.product_category, d.product_qty || d.qty || 1, d.product_note);
    }
    return String(first.title || "طلب توصيل").trim() || "طلب توصيل";
  }

  function pickupLinkFromOrder(order) {
    var d = order && order.data && typeof order.data === "object" ? order.data : {};
    if (d.pickup_maps_url) return String(d.pickup_maps_url);
    var lat = Number(order.pickup_lat);
    var lng = Number(order.pickup_lng);
    return buildGoogleMapsUrl(lat, lng) || String(order.pickup_address || "").trim();
  }

  function dropLinkFromOrder(order) {
    var d = order && order.data && typeof order.data === "object" ? order.data : {};
    if (d.drop_maps_url) return String(d.drop_maps_url);
    var lat = Number(order.drop_lat);
    var lng = Number(order.drop_lng);
    return buildGoogleMapsUrl(lat, lng) || String(order.drop_address || "").trim();
  }

  global.ErvenowDeliveryMap = {
    PRODUCT_TYPES: PRODUCT_TYPES,
    parseLatLngPair: parseLatLngPair,
    parseMapsUrl: parseMapsUrl,
    buildGoogleMapsUrl: buildGoogleMapsUrl,
    getProductLabel: getProductLabel,
    formatProductLine: formatProductLine,
    isMapDeliveryOrder: isMapDeliveryOrder,
    productLineFromOrder: productLineFromOrder,
    pickupLinkFromOrder: pickupLinkFromOrder,
    dropLinkFromOrder: dropLinkFromOrder,
  };
})(typeof window !== "undefined" ? window : global);
