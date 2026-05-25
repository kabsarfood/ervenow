/** Admin Dashboard — dashboard */
import { app } from "./shared.js";
import "./api.js";

app.isCancelledOrderClient = function (row) {
  var s = String((row && (row.delivery_status || row.status)) || "").toLowerCase();
  return s === "cancelled" || s === "cancelled_by_customer" || s === "canceled" || s === "canceled_by_customer";
}

app.orderBillableAmountClient = function (row) {
  if (!row || typeof row !== "object") return 0;
  var twv = Number(row.total_with_vat);
  if (Number.isFinite(twv) && twv > 0) return app.roundMoney2(twv);
  var ot = Number(row.order_total) || 0;
  var df = Number(row.delivery_fee) || 0;
  var vat = Number(row.vat_amount) || 0;
  var composed = ot + df + vat;
  if (Number.isFinite(composed) && composed > 0) return app.roundMoney2(composed);
  var ta = Number(row.total_amount);
  if (Number.isFinite(ta) && ta > 0) return app.roundMoney2(ta);
  if (Number.isFinite(ot) && ot > 0) return app.roundMoney2(ot);
  var ad = Number(row.amount_display);
  if (Number.isFinite(ad) && ad > 0) return app.roundMoney2(ad);
  return 0;
}

app.isDeliveredStatusClient = function (row) {
  var s = String((row && (row.delivery_status || row.status)) || "").toLowerCase();
  return s === "delivered";
}

app.isActiveDeliveryStatusClient = function (row) {
  var s = String((row && (row.delivery_status || row.status)) || "").toLowerCase();
  return s === "accepted" || s === "delivering" || s === "picked";
}

app.isCreatedTodayClient = function (iso) {
  if (!iso) return false;
  try {
    var d = new Date(iso);
    var now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch (_e) {
    return false;
  }
}

app.renderLiveProfitCards = function () {
  var oEl = document.getElementById("liveProfitOrdersToday");
  var rEl = document.getElementById("liveProfitRevenue");
  if (oEl) oEl.textContent = app.hasPermission("dashboard") ? String(app.liveProfit.ordersToday) : "—";
  if (rEl) {
    rEl.textContent = app.hasPermission("dashboard")
      ? app.fmtMoneyShort(app.liveProfit.revenueDeliveredToday) + " ر.س"
      : "—";
  }
}

app.recomputeLiveProfitDelivered = function () {
  var rev = 0;
  for (var i = 0; i < app.cacheOrders.length; i++) {
    var o = app.cacheOrders[i];
    if (!o || app.isCancelledOrderClient(o)) continue;
    if (!app.isDeliveredStatusClient(o) || !app.isCreatedTodayClient(o.created_at)) continue;
    rev += app.orderBillableAmountClient(o);
  }
  app.liveProfit.revenueDeliveredToday = app.roundMoney2(rev);
}

app.applyLiveProfitOnOrderPatch = function (prev, merged, isNew) {
  if (!app.hasPermission("dashboard")) return;
  if (isNew) {
    var created = merged.created_at || new Date().toISOString();
    if (app.isCreatedTodayClient(created)) {
      app.liveProfit.ordersToday = (Number(app.liveProfit.ordersToday) || 0) + 1;
    }
  }
  var wasDel = prev && app.isDeliveredStatusClient(prev);
  var nowDel = app.isDeliveredStatusClient(merged);
  if (nowDel && (!wasDel || prev)) {
    app.recomputeLiveProfitDelivered();
  }
  app.renderLiveProfitCards();
}

app.syncLiveProfitFromStats = function (sj) {
  if (!sj || !app.hasPermission("dashboard")) return;
  var t = sj.ordersToday != null ? sj.ordersToday : sj.today_orders;
  if (t != null) app.liveProfit.ordersToday = Number(t) || 0;
  app.recomputeLiveProfitDelivered();
  app.renderLiveProfitCards();
}

app.orderStatusRaw = function (o) {
  return String((o && (o.delivery_status || o.status)) || "")
    .toLowerCase()
    .trim();
}

app.isPendingLikeStatus = function (o) {
  if (!o || app.isCancelledOrderClient(o) || app.isDeliveredStatusClient(o)) return false;
  var s = app.orderStatusRaw(o);
  if (s === "new" || s === "pending") return true;
  return app.classifyOrderStatusLive(o).bucket === "pending";
}

app.getOrderSlaLevel = function (o) {
  if (!app.isPendingLikeStatus(o) || !o.created_at) return null;
  try {
    var age = Date.now() - new Date(o.created_at).getTime();
    if (age >= app.PENDING_SLA_FAILURE_MS) return "failure";
    if (age >= app.PENDING_SLA_CRITICAL_MS) return "critical";
    if (age >= app.PENDING_SLA_WARNING_MS) return "warning";
    return null;
  } catch (_e) {
    return null;
  }
}

app.isPendingTooLong = function (o) {
  var lvl = app.getOrderSlaLevel(o);
  return lvl === "critical" || lvl === "failure";
}

app.slaLevelLabel = function (lvl) {
  if (lvl === "warning") return "تحذير SLA";
  if (lvl === "critical") return "حرج SLA";
  if (lvl === "failure") return "فشل SLA";
  return "";
}

app.haversineKm = function (lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = ((lat2 - lat1) * Math.PI) / 180;
  var dLng = ((lng2 - lng1) * Math.PI) / 180;
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

app.getOrderTargetLatLng = function (o) {
  if (!o) return null;
  var lat = Number(o.pickup_lat);
  var lng = Number(o.pickup_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: lat, lng: lng };
  lat = Number(o.drop_lat);
  lng = Number(o.drop_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: lat, lng: lng };
  return null;
}

app.orderNeedsDriver = function (o) {
  if (!o || app.isCancelledOrderClient(o) || app.isDeliveredStatusClient(o)) return false;
  if (o.driver_id != null && String(o.driver_id).trim() !== "") return false;
  var s = app.orderStatusRaw(o);
  if (s === "delivered" || s === "cancelled" || s === "canceled") return false;
  return app.isPendingLikeStatus(o) || s === "accepted" || s === "delivering" || s === "picked";
}

app.orderStatusMapColor = function (o) {
  if (!o) return app.ORDER_MAP_COLORS.pending;
  if (app.orderNeedsDriver(o)) return app.ORDER_MAP_COLORS.noDriver;
  var sla = app.getOrderSlaLevel(o);
  if (sla === "failure") return app.ORDER_MAP_COLORS.late;
  if (sla === "critical") return "#f97316";
  if (sla === "warning") return "#eab308";
  if (app.isPendingTooLong(o)) return app.ORDER_MAP_COLORS.late;
  var s = app.orderStatusRaw(o);
  if (s === "delivering") return app.ORDER_MAP_COLORS.delivering;
  if (s === "picked") return app.ORDER_MAP_COLORS.picked;
  if (s === "delivered") return app.ORDER_MAP_COLORS.delivered;
  if (s === "accepted") return app.ORDER_MAP_COLORS.accepted;
  return app.ORDER_MAP_COLORS.pending;
}

app.driverStatusLabel = function (dr) {
  var st = String((dr && dr.status) || "").toLowerCase();
  if (st === "approved" || dr.active === true) return "معتمد · نشط";
  if (st === "pending") return "قيد المراجعة";
  if (st === "blocked" || st === "rejected") return "غير متاح";
  return st || "—";
}

app.driverMarkerColor = function (dr, currentOrder) {
  if (currentOrder) return app.orderStatusMapColor(currentOrder);
  var st = String((dr && dr.status) || "").toLowerCase();
  if (st === "approved" || dr.active === true) return app.ORDER_MAP_COLORS.driverFree;
  if (st === "pending") return app.ORDER_MAP_COLORS.pending;
  return app.ORDER_MAP_COLORS.delivered;
}

app.findCurrentOrderForDriver = function (dr) {
  if (!dr) return null;
  var keys = [];
  if (dr.user_id != null) keys.push(String(dr.user_id));
  if (dr.id != null) keys.push(String(dr.id));
  for (var i = 0; i < app.cacheOrders.length; i++) {
    var o = app.cacheOrders[i];
    if (!o || app.isCancelledOrderClient(o) || app.isDeliveredStatusClient(o)) continue;
    var did = o.driver_id != null ? String(o.driver_id).trim() : "";
    if (did && keys.indexOf(did) !== -1) return o;
  }
  return null;
}

app.buildDriverPopupHtml = function (dr, currentOrder) {
  var name = app.escapeHtml(dr.name || "مندوب");
  var st = app.escapeHtml(app.driverStatusLabel(dr));
  var orderBlock;
  if (currentOrder) {
    var label = app.escapeHtml(currentOrder.order_number || String(currentOrder.id || "").slice(0, 8));
    var ost = app.escapeHtml(currentOrder.delivery_status || currentOrder.status || "—");
    orderBlock =
      '<div class="admin-popup-row"><strong>الطلب الحالي:</strong> ' + label + " · " + ost + "</div>";
  } else {
    orderBlock = '<div class="admin-popup-row muted">لا يوجد طلب نشط حالياً</div>';
  }
  return (
    '<div class="admin-map-popup">' +
    "<strong>🚚 " +
    name +
    "</strong>" +
    '<div class="admin-popup-row">الحالة: ' +
    st +
    "</div>" +
    orderBlock +
    (currentOrder ? app.buildOrderExecPopupActions(currentOrder) : "") +
    "</div>"
  );
}

app.buildOrderMapPopupHtml = function (o, kind) {
  var label = app.escapeHtml(o.order_number || String(o.id || "").slice(0, 8));
  var st = app.escapeHtml(o.delivery_status || o.status || "—");
  var title = kind === "pickup" ? "📦 استلام" : kind === "drop" ? "📍 تسليم" : "🚚 موقع المندوب";
  var extra = "";
  var sla = app.getOrderSlaLevel(o);
  if (sla === "warning") extra += '<div class="admin-popup-row" style="color:#a16207">⚠ SLA: تحذير</div>';
  if (sla === "critical") extra += '<div class="admin-popup-row" style="color:#c2410c">⚠ SLA: حرج</div>';
  if (sla === "failure") extra += '<div class="admin-popup-row" style="color:#b91c1c">⚠ SLA: فشل</div>';
  if (app.orderNeedsDriver(o)) extra += '<div class="admin-popup-row" style="color:#b45309">⚠ لا يوجد مندوب معيّن</div>';
  return (
    '<div class="admin-map-popup"><strong>' +
    title +
    " " +
    label +
    "</strong><div class=\"admin-popup-row\">الحالة: " +
    st +
    "</div>" +
    extra +
    app.buildOrderExecPopupActions(o) +
    "</div>"
  );
}

app.collectSmartAlerts = function () {
  var alerts = [];
  var seen = {};
  for (var i = 0; i < app.cacheOrders.length; i++) {
    var o = app.cacheOrders[i];
    if (!o || o.id == null) continue;
    if (app.isCancelledOrderClient(o) || app.isDeliveredStatusClient(o)) continue;
    var oid = String(o.id);
    var label = o.order_number || oid.slice(0, 8);
    if (app.orderNeedsDriver(o)) {
      var k1 = "nd:" + oid;
      if (!seen[k1]) {
        seen[k1] = true;
        alerts.push({
          type: "no-driver",
          orderId: oid,
          text: "طلب #" + label + " — لا يوجد مندوب معيّن",
        });
      }
    }
    var sla = app.getOrderSlaLevel(o);
    if (sla) {
      var mins = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
      var k2 = "sla:" + sla + ":" + oid;
      if (!seen[k2]) {
        seen[k2] = true;
        alerts.push({
          type: "sla-" + sla,
          orderId: oid,
          text: "طلب #" + label + " — " + app.slaLevelLabel(sla) + " (" + mins + " د)",
        });
      }
    }
  }
  return alerts;
}

app.renderSmartAlerts = function () {
  var root = document.getElementById("liveSmartAlerts");
  var card = document.getElementById("liveAlertsCard");
  if (!root) return;
  if (!app.hasPermission("orders")) {
    if (card) card.style.display = "none";
    return;
  }
  if (card) card.style.display = "";
  var alerts = app.collectSmartAlerts();
  if (!alerts.length) {
    root.className = "live-smart-alerts live-dash-msg";
    root.textContent = "لا توجد تنبيهات حالياً.";
    return;
  }
  root.className = "live-smart-alerts";
  root.innerHTML = "";
  alerts.forEach(function (a) {
    var el = document.createElement("div");
    var cls = "live-alert-item live-alert-item--" + a.type;
    if (a.type.indexOf("sla-") === 0) cls = "live-alert-item live-alert-item--" + a.type;
    else if (a.type === "late") cls = "live-alert-item live-alert-item--late";
    else cls = "live-alert-item live-alert-item--no-driver";
    el.className = cls;
    var ico = "🚫";
    if (a.type.indexOf("sla-failure") === 0) ico = "🔴";
    else if (a.type.indexOf("sla-critical") === 0) ico = "🟠";
    else if (a.type.indexOf("sla-warning") === 0) ico = "🟡";
    el.innerHTML = '<span class="ico">' + ico + "</span><span>" + app.escapeHtml(a.text) + "</span>";
    el.addEventListener("click", function () {
      app.focusLiveOrderRow(a.orderId);
      var o = null;
      for (var ai = 0; ai < app.cacheOrders.length; ai++) {
        if (String(app.cacheOrders[ai].id) === String(a.orderId)) {
          o = app.cacheOrders[ai];
          break;
        }
      }
      if (o && app.liveMap) {
        var lat = Number(o.drop_lat) || Number(o.pickup_lat) || Number(o.driver_lat);
        var lng = Number(o.drop_lng) || Number(o.pickup_lng) || Number(o.driver_lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          try {
            app.liveMap.setView([lat, lng], 15);
          } catch (_m) {}
        }
      }
    });
    root.appendChild(el);
  });
}

app.startAdminAlertsTimer = function () {
  if (app.adminAlertsTimer) clearInterval(app.adminAlertsTimer);
  app.adminAlertsTimer = setInterval(function () {
    if (!app.hasPermission("orders")) return;
    app.renderSmartAlerts();
    app.syncLiveMapMarkers();
  }, 30000);
}

app.adminMapDotIcon = function (color, opts) {
  opts = opts || {};
  var size = opts.size || 12;
  var pulse = !!opts.pulse;
  var wrapCls = "admin-map-dot-wrap" + (pulse ? " admin-map-dot-pulse" : "");
  return L.divIcon({
    className: wrapCls,
    html:
      '<span style="background:' +
      color +
      ";width:" +
      size +
      "px;height:" +
      size +
      "px;border-radius:50%;display:block;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)\"></span>",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

app.ensureLiveMap = function () {
  if (app.liveMap || typeof L === "undefined") return;
  var el = document.getElementById("app.liveMap");
  if (!el) return;
  app.liveMap = L.map("app.liveMap", { zoomControl: true }).setView([24.7136, 46.6753], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(app.liveMap);
  app.liveMapMarkersLayer = L.layerGroup().addTo(app.liveMap);
  setTimeout(function () {
    try {
      app.liveMap.invalidateSize();
    } catch (_e) {}
  }, 120);
}

app.removeLiveMapMarker = function (store, key) {
  if (!store[key]) return;
  try {
    if (app.liveMapMarkersLayer) app.liveMapMarkersLayer.removeLayer(store[key]);
  } catch (_e) {}
  delete store[key];
}

app.upsertLiveMapMarker = function (store, key, lat, lng, icon, popupHtml, markerOpts) {
  if (!app.liveMapMarkersLayer || typeof L === "undefined") return;
  markerOpts = markerOpts || {};
  var la = Number(lat);
  var ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    app.removeLiveMapMarker(store, key);
    return;
  }
  var ll = [la, ln];
  var m = store[key];
  if (!m) {
    m = L.marker(ll, { icon: icon });
    if (popupHtml) m.bindPopup(popupHtml, { maxWidth: 300 });
    m.on("click", function () {
      if (popupHtml) m.openPopup();
      if (typeof markerOpts.onClick === "function") markerOpts.onClick();
    });
    m.addTo(app.liveMapMarkersLayer);
    store[key] = m;
  } else {
    m.setLatLng(ll);
    if (icon) m.setIcon(icon);
    if (popupHtml) m.setPopupContent(popupHtml);
  }
}

app.syncLiveMapMarkers = function () {
  app.ensureLiveMap();
  if (!app.liveMap || !app.liveMapMarkersLayer) return;

  var wantedDrivers = {};
  var wantedOrders = {};
  var bounds = [];

  if (app.hasPermission("drivers")) {
    for (var di = 0; di < app.cacheDrivers.length; di++) {
      var dr = app.cacheDrivers[di];
      if (!dr || !dr.id) continue;
      var dlat = dr.lat != null ? dr.lat : dr.latitude;
      var dlng = dr.lng != null ? dr.lng : dr.longitude;
      var dla = Number(dlat);
      var dln = Number(dlng);
      if (!Number.isFinite(dla) || !Number.isFinite(dln)) continue;
      var dk = "drv:" + String(dr.id);
      wantedDrivers[dk] = true;
      var currentOrder = app.findCurrentOrderForDriver(dr);
      var dColor = app.driverMarkerColor(dr, currentOrder);
      var dPulse =
        !!currentOrder && (app.isPendingTooLong(currentOrder) || app.orderNeedsDriver(currentOrder));
      var dPopup = app.buildDriverPopupHtml(dr, currentOrder);
      (function (orderRef) {
        app.upsertLiveMapMarker(
          app.liveMapDriverMarkers,
          dk,
          dla,
          dln,
          app.adminMapDotIcon(dColor, { size: currentOrder ? 14 : 12, pulse: dPulse }),
          dPopup,
          {
            onClick: function () {
              if (orderRef) app.focusLiveOrderRow(orderRef.id);
            },
          }
        );
      })(currentOrder);
      bounds.push([dla, dln]);
    }
  }

  if (app.hasPermission("orders")) {
    var mapOrders = app.cacheOrders.slice(0, 50);
    for (var oi = 0; oi < mapOrders.length; oi++) {
      var o = mapOrders[oi];
      if (!o || o.id == null) continue;
      if (app.isCancelledOrderClient(o)) continue;
      var oid = String(o.id);
      var oColor = app.orderStatusMapColor(o);
      var slaLvl = app.getOrderSlaLevel(o);
      var oPulse = !!slaLvl || app.orderNeedsDriver(o);
      var oIcon = app.adminMapDotIcon(oColor, { size: 11, pulse: oPulse });

      var plat = Number(o.pickup_lat);
      var plng = Number(o.pickup_lng);
      if (Number.isFinite(plat) && Number.isFinite(plng)) {
        var pk = "pk:" + oid;
        wantedOrders[pk] = true;
        (function (orderId) {
          app.upsertLiveMapMarker(
            app.liveMapOrderMarkers,
            pk,
            plat,
            plng,
            oIcon,
            app.buildOrderMapPopupHtml(o, "pickup"),
            { onClick: function () { app.focusLiveOrderRow(orderId); } }
          );
        })(oid);
        bounds.push([plat, plng]);
      }

      var dlat2 = Number(o.drop_lat);
      var dlng2 = Number(o.drop_lng);
      if (Number.isFinite(dlat2) && Number.isFinite(dlng2)) {
        var dk2 = "drop:" + oid;
        wantedOrders[dk2] = true;
        (function (orderId) {
          app.upsertLiveMapMarker(
            app.liveMapOrderMarkers,
            dk2,
            dlat2,
            dlng2,
            app.adminMapDotIcon(oColor, { size: 13, pulse: oPulse }),
            app.buildOrderMapPopupHtml(o, "drop"),
            { onClick: function () { app.focusLiveOrderRow(orderId); } }
          );
        })(oid);
        bounds.push([dlat2, dlng2]);
      }

      var drlat = Number(o.driver_lat);
      var drlng = Number(o.driver_lng);
      if (Number.isFinite(drlat) && Number.isFinite(drlng) && app.isActiveDeliveryStatusClient(o)) {
        var ok = "odrv:" + oid;
        wantedOrders[ok] = true;
        (function (orderId) {
          app.upsertLiveMapMarker(
            app.liveMapOrderMarkers,
            ok,
            drlat,
            drlng,
            app.adminMapDotIcon(app.ORDER_MAP_COLORS.delivering, { size: 14, pulse: oPulse }),
            app.buildOrderMapPopupHtml(o, "driver"),
            { onClick: function () { app.focusLiveOrderRow(orderId); } }
          );
        })(oid);
        bounds.push([drlat, drlng]);
      }
    }
  }

  Object.keys(app.liveMapDriverMarkers).forEach(function (k) {
    if (!wantedDrivers[k]) app.removeLiveMapMarker(app.liveMapDriverMarkers, k);
  });
  Object.keys(app.liveMapOrderMarkers).forEach(function (k) {
    if (!wantedOrders[k]) app.removeLiveMapMarker(app.liveMapOrderMarkers, k);
  });

  if (bounds.length === 1) {
    app.liveMap.setView(bounds[0], 14);
  } else if (bounds.length > 1) {
    try {
      app.liveMap.fitBounds(L.latLngBounds(bounds).pad(0.15));
    } catch (_b) {}
  }
  try {
    app.liveMap.invalidateSize();
  } catch (_s) {}
  app.renderSmartAlerts();
}

app.applyDriverGpsToActiveOrders = function (data) {
  if (!data || data.lat == null || data.lng == null) return;
  var la = Number(data.lat);
  var ln = Number(data.lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
  var touched = false;
  for (var i = 0; i < app.cacheOrders.length; i++) {
    var o = app.cacheOrders[i];
    if (!o || !app.isActiveDeliveryStatusClient(o)) continue;
    o.driver_lat = la;
    o.driver_lng = ln;
    if (data.ts != null) o.last_location_at = new Date(Number(data.ts)).toISOString();
    touched = true;
  }
  if (touched) app.syncLiveMapMarkers();
}

app.updateLiveSocketPulse = function () {
  var pulse = document.querySelector(".live-pulse");
  if (!pulse) return;
  if (app.adminDashboardSocketConnected()) {
    pulse.style.background = "#22c55e";
  } else {
    pulse.style.background = "#f59e0b";
  }
}

app.classifyOrderStatusLive = function (o) {
  var s = String(o && (o.delivery_status || o.status) || "")
    .toLowerCase()
    .trim();
  if (s === "delivering") {
    return { bucket: "delivering", label: "قيد التوصيل", cls: "live-badge--delivering" };
  }
  if (s === "delivered") {
    return { bucket: "delivered", label: "تم التسليم", cls: "live-badge--delivered" };
  }
  return { bucket: "pending", label: "في الانتظار", cls: "live-badge--pending" };
}

app.updateLiveClock = function () {
  var el = document.getElementById("liveLastUpdated");
  if (el) el.textContent = "آخر تحديث: " + new Date().toLocaleTimeString("ar-SA");
}

app.scheduleAdminLiveStatsRefresh = function () {
  if (!app.hasPermission("dashboard")) return;
  if (app.adminLiveStatsDebounceTimer) clearTimeout(app.adminLiveStatsDebounceTimer);
  app.adminLiveStatsDebounceTimer = setTimeout(function () {
    app.adminLiveStatsDebounceTimer = null;
    void app.refreshLiveDriversAndMap();
  }, 280);
}

/** عداد المندوبين + الخريطة — بدون تكرار stats أو orders. */

app.refreshLiveDriversAndMap = async function () {
  var drvEl = document.getElementById("liveStatDrivers");
  if (drvEl) {
    if (app.hasPermission("drivers")) {
      try {
        var dj = await app.PlatformAPI.api("/api/admin/drivers");
        var n = dj.drivers && dj.drivers.length ? dj.drivers.length : 0;
        drvEl.textContent = String(n);
      } catch (_e2) {
        drvEl.textContent = "—";
      }
    } else drvEl.textContent = "—";
  }
  app.syncLiveMapMarkers();
}

app.refreshLiveDashboard = async function () {
  if (app.liveTickBusy) return;
  app.liveTickBusy = true;
  try {
    await app.refreshLiveDriversAndMap();
    if (app.hasPermission("orders")) app.renderSmartAlerts();
    app.updateLiveClock();
  } finally {
    app.liveTickBusy = false;
  }
}

app.applyStatsToDom = function (j) {
  if (!j) return;
  var t = j.ordersToday != null ? j.ordersToday : j.today_orders || 0;
  var a = j.activeOrders != null ? j.activeOrders : j.active_orders || 0;
  var lt = document.getElementById("liveStatToday");
  var la = document.getElementById("liveStatActive");
  var lrt = document.getElementById("liveRevenueToday");
  var lrot = document.getElementById("liveRevenueTotal");
  if (lt) lt.textContent = String(t);
  if (la) la.textContent = String(a);
  if (lrt) lrt.textContent = app.fmtMoney(j.revenueToday || 0);
  if (lrot) lrot.textContent = app.fmtMoney(j.revenueTotal || 0);
  app.syncLiveProfitFromStats(j);
}

app.loadStats = async function () {
  if (!app.hasPermission("dashboard")) return;
  try {
    var rangeEl = document.getElementById("range");
    var range = rangeEl && rangeEl.value ? rangeEl.value : "today";
    var j = await app.PlatformAPI.api("/api/admin/stats?range=" + encodeURIComponent(range));
    app.applyStatsToDom(j);
  } catch (e) {
    app.showError(e.message || "فشل تحميل الإحصائيات");
  }
}
