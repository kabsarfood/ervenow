/**
 * مسار قيادة OSRM على Leaflet — نفس منطق صفحة تتبع طالب الخدمة (track.html).
 */
(function (global) {
  var OSRM_BASE = "https://router.project-osrm.org/route/v1/driving/";

  function norm(ll) {
    if (!ll) return null;
    if (Array.isArray(ll)) {
      return { lat: Number(ll[0]), lng: Number(ll[1]) };
    }
    return { lat: Number(ll.lat), lng: Number(ll.lng) };
  }

  function geometryToLatLngs(geometry) {
    var out = [];
    if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return out;
    for (var i = 0; i < geometry.coordinates.length; i++) {
      var c = geometry.coordinates[i];
      if (!c || c.length < 2) continue;
      var lng = Number(c[0]);
      var lat = Number(c[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
    }
    return out;
  }

  /**
   * @param {{ lat: number, lng: number }|number[]} from
   * @param {{ lat: number, lng: number }|number[]} to
   */
  async function fetchDrivingRoute(from, to) {
    var a = norm(from);
    var b = norm(to);
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
      throw new Error("invalid_coords");
    }
    var url =
      OSRM_BASE +
      a.lng +
      "," +
      a.lat +
      ";" +
      b.lng +
      "," +
      b.lat +
      "?overview=full&geometries=geojson";
    var r = await fetch(url);
    if (!r.ok) throw new Error("osrm_http_" + r.status);
    var j = await r.json();
    if (j.code && j.code !== "Ok") throw new Error("osrm_" + (j.code || "fail"));
    if (!j.routes || !j.routes[0] || !j.routes[0].geometry) throw new Error("osrm_no_geometry");
    return j.routes[0];
  }

  /**
   * @param {number[][]} latlngs
   * @param {{ color?: string, weight?: number }} [style]
   */
  function buildRouteLayer(latlngs, style) {
    if (typeof L === "undefined") throw new Error("leaflet_missing");
    style = style || {};
    var color = style.color || "#2563eb";
    var weight = style.weight || 6;
    var shadow = L.polyline(latlngs, {
      color: "#0c4a6e",
      weight: weight + 6,
      opacity: 0.2,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
      smoothFactor: 1.15,
    });
    var main = L.polyline(latlngs, {
      color: color,
      weight: weight,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round",
      smoothFactor: 1.15,
    });
    var fg = L.featureGroup([shadow, main]);
    fg.__ervOsrmRoute = true;
    return fg;
  }

  /**
   * @param {L.Map} map
   * @param {*} from
   * @param {*} to
   * @param {{ fitBounds?: boolean, padding?: number[], maxZoom?: number, style?: object }} [options]
   */
  async function drawOnMap(map, from, to, options) {
    options = options || {};
    if (!map) throw new Error("map_missing");
    var route = await fetchDrivingRoute(from, to);
    var latlngs = geometryToLatLngs(route.geometry);
    if (latlngs.length < 2) throw new Error("route_too_short");

    var layer = buildRouteLayer(latlngs, options.style);
    layer.addTo(map);

    if (options.fitBounds !== false) {
      var pad = options.padding || [36, 36];
      var maxZoom = options.maxZoom != null ? options.maxZoom : 16;
      map.fitBounds(layer.getBounds(), { padding: pad, maxZoom: maxZoom, animate: true, duration: 0.35 });
    }

    return {
      layer: layer,
      route: route,
      latlngs: latlngs,
      distanceM: route.distance,
      durationS: route.duration,
    };
  }

  global.ErvenowOsrmRoute = {
    norm: norm,
    geometryToLatLngs: geometryToLatLngs,
    fetchDrivingRoute: fetchDrivingRoute,
    buildRouteLayer: buildRouteLayer,
    drawOnMap: drawOnMap,
  };
})(typeof window !== "undefined" ? window : global);
