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
    var t = String(s || "")
      .trim()
      .replace(/\u060c/g, ",")
      .replace(/،/g, ",");
    if (!t.includes(",")) return null;
    var parts = t.split(/,\s*/);
    if (parts.length < 2) return null;
    var lat = parseFloat(String(parts[0]).trim());
    var lng = parseFloat(String(parts[1]).trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function normalizeHttpUrl(input) {
    var s = String(input || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) {
      if (/^(maps\.|www\.|goo\.|g\.co)/i.test(s)) s = "https://" + s;
      else if (/google\.com\/maps|maps\.google|goo\.gl|maps\.app/i.test(s)) s = "https://" + s;
    }
    return s;
  }

  function decodeCandidates(input) {
    var raw = String(input || "").trim();
    var list = [raw];
    try {
      list.push(decodeURIComponent(raw));
    } catch (e) {}
    try {
      list.push(decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch (e2) {}
    var seen = {};
    return list.filter(function (x) {
      if (!x || seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }

  function parse3d4d(s) {
    var last = null;
    var re = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/gi;
    var m;
    while ((m = re.exec(s)) !== null) {
      last = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    }
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) return last;

    re = /!4d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/gi;
    while ((m = re.exec(s)) !== null) {
      last = { lat: parseFloat(m[2]), lng: parseFloat(m[1]) };
    }
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) return last;

    var m2d = s.match(/!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/i);
    if (m2d) {
      return { lat: parseFloat(m2d[2]), lng: parseFloat(m2d[1]) };
    }
    return null;
  }

  function parseMapsUrlFromString(s) {
    var raw = String(s || "").trim();
    if (!raw) return null;

    var direct = parseLatLngPair(raw);
    if (direct) return direct;

    var urlStr = normalizeHttpUrl(raw);

    var from3d = parse3d4d(urlStr);
    if (from3d) return from3d;

    var patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/]|z|\?|$)/i,
      /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]daddr=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]saddr=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]lat=(-?\d+(?:\.\d+)?)[&]lng=(-?\d+(?:\.\d+)?)/i,
      /\/search\/(-?\d+(?:\.\d+)?),\+?(-?\d+(?:\.\d+)?)/i,
      /\/place\/[^@]*@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
      /\/dir\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
      /\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\/|$|\?|z)/,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = urlStr.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]);
        var lng = parseFloat(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return { lat: lat, lng: lng };
        }
      }
    }

    try {
      var u = new URL(urlStr);
      var keys = ["q", "query", "ll", "center", "destination", "daddr", "saddr", "origin"];
      for (var k = 0; k < keys.length; k++) {
        var q = u.searchParams.get(keys[k]);
        if (!q) continue;
        var cleaned = String(q).replace(/^loc:/i, "").trim();
        var fromQ = parseLatLngPair(cleaned);
        if (fromQ) return fromQ;
      }
      var pathMatch = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (pathMatch) {
        return { lat: parseFloat(pathMatch[1]), lng: parseFloat(pathMatch[2]) };
      }
    } catch (e) {}

    return null;
  }

  /**
   * استخراج إحداثيات من رابط Google Maps / Apple / lat,lng
   * @returns {{ lat: number, lng: number } | null}
   */
  function parseMapsUrl(input) {
    var candidates = decodeCandidates(input);
    for (var i = 0; i < candidates.length; i++) {
      var ll = parseMapsUrlFromString(candidates[i]);
      if (ll) return ll;
    }
    return null;
  }

  function isShortMapsLink(input) {
    var s = String(input || "").trim();
    var n = normalizeHttpUrl(s) || s;
    return /maps\.app\.goo\.gl\//i.test(n) || /\/goo\.gl\/[a-zA-Z0-9]/i.test(n) || /^https?:\/\/g\.co\//i.test(n);
  }

  /**
   * فك الرابط محلياً ثم عبر الخادم (مهم لـ maps.app.goo.gl).
   * @returns {Promise<{ ll: {lat,lng}, mapsUrl: string, error?: string } | null>}
   */
  async function resolveMapsLinkAsync(input) {
    var raw = String(input || "").trim();
    if (!raw) return null;

    var short = isShortMapsLink(raw);

    if (!short) {
      var llLocal = parseMapsUrl(raw);
      if (llLocal) {
        return {
          ll: llLocal,
          mapsUrl: /^https?:\/\//i.test(raw) ? raw : buildGoogleMapsUrl(llLocal.lat, llLocal.lng),
        };
      }
    }

    if (!/maps|google|goo\.gl|g\.co/i.test(raw)) {
      return null;
    }

    if (!global.PlatformAPI || typeof PlatformAPI.api !== "function") {
      if (short) {
        return {
          error:
            "رابط maps.app.goo.gl يحتاج الخادم — تأكد أن الموقع يعمل (أعد تشغيل Node) ثم جرّب مجدداً.",
        };
      }
      return null;
    }

    try {
      var j = await PlatformAPI.api("/api/delivery/resolve-maps-link", {
        method: "POST",
        body: { url: raw },
      });
      var lat = Number(j && j.lat);
      var lng = Number(j && j.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return {
          error:
            (j && j.error) ||
            "تعذر قراءة الإحداثيات من رابط المشاركة. جرّب «مشاركة» من Google Maps مرة أخرى أو حدد على الخريطة.",
        };
      }
      return {
        ll: { lat: lat, lng: lng },
        mapsUrl: String((j && j.resolved_url) || raw),
      };
    } catch (e) {
      return {
        error: (e && e.message) || "تعذر الاتصال بالخادم لفك رابط Google Maps",
      };
    }
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
    resolveMapsLinkAsync: resolveMapsLinkAsync,
    buildGoogleMapsUrl: buildGoogleMapsUrl,
    getProductLabel: getProductLabel,
    formatProductLine: formatProductLine,
    isMapDeliveryOrder: isMapDeliveryOrder,
    productLineFromOrder: productLineFromOrder,
    pickupLinkFromOrder: pickupLinkFromOrder,
    dropLinkFromOrder: dropLinkFromOrder,
  };
})(typeof window !== "undefined" ? window : global);
