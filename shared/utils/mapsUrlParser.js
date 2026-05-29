/**
 * استخراج إحداثيات من روابط Google Maps / Apple / نص lat,lng
 * يُستخدم في الخادم والواجهة (انسخ المنطق إلى delivery-map-order.js عند التعديل).
 */

const FETCH_TIMEOUT_MS = 12000;

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
  } catch (_e) {}
  try {
    list.push(decodeURIComponent(raw.replace(/\+/g, " ")));
  } catch (_e2) {}
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
  } catch (_e3) {}

  return null;
}

function parseMapsUrl(input) {
  var candidates = decodeCandidates(input);
  for (var i = 0; i < candidates.length; i++) {
    var ll = parseMapsUrlFromString(candidates[i]);
    if (ll) return ll;
  }
  return null;
}

function buildGoogleMapsUrl(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return "https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lng);
}

var CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** روابط مشاركة Google (maps.app.goo.gl) لا تحتوي إحداثيات إلا بعد إعادة التوجيه */
function isShortMapsLink(input) {
  var s = String(input || "").trim();
  var n = normalizeHttpUrl(s) || s;
  return /maps\.app\.goo\.gl\//i.test(n) || /\/goo\.gl\/[a-zA-Z0-9]/i.test(n) || /^https?:\/\/g\.co\//i.test(n);
}

function needsRedirectResolve(url) {
  return isShortMapsLink(url);
}

function extractMapsUrlFromHtml(html) {
  var h = String(html || "");
  if (!h) return "";
  var m = h.match(/https:\/\/(?:www\.)?google\.com\/maps[^\s"'<>\\]+/i);
  if (m && m[0]) {
    return m[0].replace(/\\u003d/g, "=").replace(/&amp;/g, "&").replace(/\\\//g, "/");
  }
  return "";
}

async function followMapsRedirects(startUrl) {
  var url = normalizeHttpUrl(startUrl);
  if (!url) return "";

  var ac = new AbortController();
  var tid = setTimeout(function () {
    ac.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    for (var hop = 0; hop < 12; hop++) {
      if (parseMapsUrl(url)) return url;

      var res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          "User-Agent": CHROME_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        var loc = res.headers.get("location");
        if (!loc) break;
        url = new URL(loc, url).href;
        continue;
      }

      if (res.ok) {
        var html = await res.text().catch(function () {
          return "";
        });
        if (parseMapsUrl(html) || parse3d4d(html)) return url;
        var embedded = extractMapsUrlFromHtml(html);
        if (embedded) {
          url = embedded;
          if (parseMapsUrl(url)) return url;
        }
      }
      break;
    }
    return url;
  } catch (_e) {
    return url;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * @param {string} input
 * @returns {Promise<{ lat: number, lng: number, resolved_url: string } | null>}
 */
async function resolveMapsLink(input) {
  var raw = String(input || "").trim();
  if (!raw) return null;

  var resolved = normalizeHttpUrl(raw) || raw;

  if (!isShortMapsLink(raw)) {
    var llDirect = parseMapsUrl(raw);
    if (llDirect) {
      return {
        lat: llDirect.lat,
        lng: llDirect.lng,
        resolved_url: resolved.indexOf("http") === 0 ? resolved : buildGoogleMapsUrl(llDirect.lat, llDirect.lng),
      };
    }
  }

  var final = await followMapsRedirects(raw);
  var ll = parseMapsUrl(final);
  if (ll) {
    return {
      lat: ll.lat,
      lng: ll.lng,
      resolved_url: final || resolved,
    };
  }

  return null;
}

module.exports = {
  parseLatLngPair,
  parseMapsUrl,
  parseMapsUrlFromString,
  buildGoogleMapsUrl,
  normalizeHttpUrl,
  isShortMapsLink,
  needsRedirectResolve,
  followMapsRedirects,
  resolveMapsLink,
};
