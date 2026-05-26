/** Admin Dashboard — orders */
import { app } from "./shared.js";
import "./api.js";

app.canExecuteOnOrder = function (o) {
  if (!o || app.isCancelledOrderClient(o) || app.isDeliveredStatusClient(o)) return false;
  return true;
}

app.getAssignableDrivers = function () {
  var out = [];
  for (var i = 0; i < app.cacheDrivers.length; i++) {
    var d = app.cacheDrivers[i];
    if (!d) continue;
    var st = String(d.status || "").toLowerCase();
    if (st !== "approved" && d.active !== true) continue;
    if (!d.user_id) continue;
    out.push(d);
  }
  return out;
}

app.suggestNearestDriver = function (order) {
  var target = app.getOrderTargetLatLng(order);
  if (!target) return null;
  var best = null;
  var bestKm = Infinity;
  var list = app.getAssignableDrivers();
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    var la = Number(d.lat != null ? d.lat : d.latitude);
    var ln = Number(d.lng != null ? d.lng : d.longitude);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    var km = app.haversineKm(target.lat, target.lng, la, ln);
    if (km < bestKm) {
      bestKm = km;
      best = d;
    }
  }
  if (!best) return null;
  return { driver: best, km: bestKm };
}

app.getOrderById = function (orderId) {
  var oid = String(orderId || "").trim();
  var idx = app.findCacheOrderIndex(oid);
  return idx >= 0 ? app.cacheOrders[idx] : null;
}

app.mergeOrderIntoCache = function (order) {
  if (!order || order.id == null) return;
  var oid = String(order.id);
  var idx = app.findCacheOrderIndex(oid);
  if (idx >= 0) app.cacheOrders[idx] = Object.assign({}, app.cacheOrders[idx], order);
  else {
    app.cacheOrders.unshift(order);
    if (app.cacheOrders.length > 600) app.cacheOrders.length = 600;
  }
  app.setBadge("badgeOrders", app.cacheOrders.length);
  if (app.activePanelId === "panelOrders") app.renderRecentOrders();
  app.syncLiveMapMarkers();
  app.renderSmartAlerts();
  app.adminRealtimeJoinTrackedOrders();
}

app.adminAssignDriver = async function (orderId, driverUserId) {
  return app.PlatformAPI.api(
    "/api/admin/orders/" + encodeURIComponent(orderId) + "/assign-driver",
    { method: "POST", body: { driver_user_id: driverUserId } }
  );
}

app.adminTransferDriver = async function (orderId, driverUserId) {
  return app.PlatformAPI.api(
    "/api/admin/orders/" + encodeURIComponent(orderId) + "/transfer-driver",
    { method: "POST", body: { driver_user_id: driverUserId } }
  );
}

app.adminCancelOrder = async function (orderId) {
  return app.PlatformAPI.api(
    "/api/delivery/orders/" + encodeURIComponent(orderId) + "/cancel",
    { method: "POST", body: {} }
  );
}

app.runAssignDriver = async function (orderId, driver, isQuick) {
  if (!driver || !driver.user_id) {
    app.showError("المندوب غير مرتبط بحساب مستخدم");
    return;
  }
  var oid = String(orderId).trim();
  var o = app.getOrderById(oid);
  var useTransfer = o && o.driver_id && app.execModalMode === "transfer";
  try {
    var j = useTransfer
      ? await app.adminTransferDriver(oid, driver.user_id)
      : await app.adminAssignDriver(oid, driver.user_id);
    if (j && j.order) app.mergeOrderIntoCache(j.order);
    app.showSuccess(
      (isQuick ? "تم التعيين السريع — " : "تم التعيين — ") + (driver.name || "مندوب")
    );
    app.closeExecDriverModal();
  } catch (e) {
    app.showError(e.message || "فشل تعيين المندوب");
  }
}

app.renderExecDriverModalUi = function () {
  var title = document.getElementById("execModalTitle");
  var label = document.getElementById("execModalOrderLabel");
  var suggestBox = document.getElementById("execSuggestedBox");
  var suggestText = document.getElementById("execSuggestedText");
  var list = document.getElementById("execDriverPickList");
  if (!list || !app.execModalOrder) return;
  if (title) title.textContent = app.execModalMode === "transfer" ? "تحويل مندوب" : "تعيين مندوب";
  if (label) {
    label.textContent =
      "طلب #" +
      (app.execModalOrder.order_number || String(app.execModalOrder.id).slice(0, 8));
  }
  app.execSuggestedDriver = app.suggestNearestDriver(app.execModalOrder);
  if (suggestBox && suggestText) {
    if (app.execSuggestedDriver && app.execModalMode === "assign") {
      suggestBox.style.display = "block";
      suggestText.textContent =
        (app.execSuggestedDriver.driver.name || "مندوب") +
        " — تقريباً " +
        app.execSuggestedDriver.km.toFixed(1) +
        " كم من نقطة الاستلام/التسليم";
    } else {
      suggestBox.style.display = "none";
      suggestText.textContent = "—";
    }
  }
  list.innerHTML = "";
  var drivers = app.getAssignableDrivers();
  if (!drivers.length) {
    list.innerHTML = '<p class="live-dash-msg" style="color:#6f5441">لا يوجد مناديب معتمدون بموقع GPS.</p>';
    return;
  }
  drivers.sort(function (a, b) {
    if (!app.execSuggestedDriver) return 0;
    if (a.id === app.execSuggestedDriver.driver.id) return -1;
    if (b.id === app.execSuggestedDriver.driver.id) return 1;
    return (a.name || "").localeCompare(b.name || "", "ar");
  });
  drivers.forEach(function (d) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "exec-driver-pick";
    if (app.execSuggestedDriver && app.execSuggestedDriver.driver.id === d.id) {
      btn.classList.add("is-suggested");
    }
    var left = document.createElement("span");
    left.innerHTML = "<strong>" + app.escapeHtml(d.name || "مندوب") + "</strong><br><span style=\"font-size:.78rem;color:#6f5441\">" + app.escapeHtml(d.phone || "") + "</span>";
    var dist = document.createElement("span");
    dist.style.fontWeight = "800";
    dist.style.color = "#5b371d";
    if (app.execModalOrder) {
      var target = app.getOrderTargetLatLng(app.execModalOrder);
      var la = Number(d.lat != null ? d.lat : d.latitude);
      var ln = Number(d.lng != null ? d.lng : d.longitude);
      if (target && Number.isFinite(la) && Number.isFinite(ln)) {
        dist.textContent = app.haversineKm(target.lat, target.lng, la, ln).toFixed(1) + " كم";
      } else dist.textContent = "—";
    }
    btn.appendChild(left);
    btn.appendChild(dist);
    btn.addEventListener("click", function () {
      void app.runAssignDriver(app.execModalOrder.id, d, false);
    });
    list.appendChild(btn);
  });
}

app.openExecDriverModal = function (order, mode) {
  if (!order || !app.hasPermission("orders")) return;
  app.execModalOrder = order;
  app.execModalMode = mode || (order.driver_id ? "transfer" : "assign");
  var backdrop = document.getElementById("execModalBackdrop");
  if (!backdrop) return;
  app.renderExecDriverModalUi();
  backdrop.hidden = false;
}

app.closeExecDriverModal = function () {
  app.execModalOrder = null;
  app.execSuggestedDriver = null;
  var backdrop = document.getElementById("execModalBackdrop");
  if (backdrop) backdrop.hidden = true;
}

app.buildOrderExecPopupActions = function (o) {
  if (!app.canExecuteOnOrder(o)) return "";
  var oid = app.escapeHtml(o.id);
  var html = '<div class="admin-popup-actions">';
  if (app.orderNeedsDriver(o)) {
    html +=
      '<button type="button" class="admin-exec-btn exec-btn--primary" style="background:#fde68a;color:#3d2618" data-exec-action="assign" data-order-id="' +
      oid +
      '">تعيين</button>';
    html +=
      '<button type="button" class="admin-exec-btn exec-btn--quick" style="background:#22c55e;color:#fff" data-exec-action="quick-assign" data-order-id="' +
      oid +
      '">تعيين سريع</button>';
  } else if (o.driver_id) {
    html +=
      '<button type="button" class="admin-exec-btn exec-btn--transfer" style="background:#8b5cf6;color:#fff" data-exec-action="transfer" data-order-id="' +
      oid +
      '">تحويل</button>';
  }
  html +=
    '<button type="button" class="admin-exec-btn exec-btn--danger" style="background:#b91c1c;color:#fff" data-exec-action="cancel" data-order-id="' +
    oid +
    '">إلغاء</button>';
  html += "</div>";
  return html;
}

app.renderOrderExecButtons = function (container, o) {
  if (!container || !app.canExecuteOnOrder(o)) {
    if (container) container.innerHTML = "";
    return;
  }
  container.innerHTML = "";
  if (app.orderNeedsDriver(o)) {
    var bAssign = document.createElement("button");
    bAssign.type = "button";
    bAssign.className = "exec-btn exec-btn--primary";
    bAssign.textContent = "تعيين مندوب";
    bAssign.addEventListener("click", function () {
      app.openExecDriverModal(o, "assign");
    });
    container.appendChild(bAssign);
    var bQuick = document.createElement("button");
    bQuick.type = "button";
    bQuick.className = "exec-btn exec-btn--quick";
    bQuick.textContent = "تعيين سريع";
    bQuick.addEventListener("click", function () {
      var sug = app.suggestNearestDriver(o);
      if (!sug) {
        app.showError("تعذر اقتراح مندوب — تحقق من مواقع المناديب والطلب");
        app.openExecDriverModal(o, "assign");
        return;
      }
      if (confirm("تعيين " + (sug.driver.name || "المندوب") + " (الأقرب ~" + sug.km.toFixed(1) + " كم)؟")) {
        void app.runAssignDriver(o.id, sug.driver, true);
      }
    });
    container.appendChild(bQuick);
  } else if (o.driver_id) {
    var bTr = document.createElement("button");
    bTr.type = "button";
    bTr.className = "exec-btn exec-btn--transfer";
    bTr.textContent = "تحويل";
    bTr.addEventListener("click", function () {
      app.openExecDriverModal(o, "transfer");
    });
    container.appendChild(bTr);
  }
  var bCancel = document.createElement("button");
  bCancel.type = "button";
  bCancel.className = "exec-btn exec-btn--danger";
  bCancel.textContent = "إلغاء";
  bCancel.addEventListener("click", function () {
    if (!confirm("إلغاء الطلب #" + (o.order_number || o.id) + "؟")) return;
    void (async function () {
      try {
        var j = await app.adminCancelOrder(o.id);
        if (j && j.order) app.mergeOrderIntoCache(j.order);
        app.showSuccess("تم إلغاء الطلب");
      } catch (e) {
        app.showError(e.message || "فشل الإلغاء");
      }
    })();
  });
  container.appendChild(bCancel);
}

app.setupExecUi = function () {
  var backdrop = document.getElementById("execModalBackdrop");
  var closeBtn = document.getElementById("execModalCloseBtn");
  var quickBtn = document.getElementById("execQuickAssignBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeExecDriverModal);
  if (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) app.closeExecDriverModal();
    });
  }
  if (quickBtn) {
    quickBtn.addEventListener("click", function () {
      if (!app.execModalOrder || !app.execSuggestedDriver) return;
      void app.runAssignDriver(app.execModalOrder.id, app.execSuggestedDriver.driver, true);
    });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".admin-exec-btn");
    if (!btn) return;
    var action = btn.getAttribute("data-exec-action");
    var orderId = btn.getAttribute("data-order-id");
    var o = app.getOrderById(orderId);
    if (!o) return;
    if (action === "assign") app.openExecDriverModal(o, "assign");
    else if (action === "transfer") app.openExecDriverModal(o, "transfer");
    else if (action === "quick-assign") {
      var sug = app.suggestNearestDriver(o);
      if (!sug) {
        app.showError("لا يوجد مندوب بموقع قريب");
        return;
      }
      if (confirm("تعيين سريع لـ " + (sug.driver.name || "المندوب") + "؟")) {
        void app.runAssignDriver(o.id, sug.driver, true);
      }
    } else if (action === "cancel") {
      if (!confirm("إلغاء الطلب؟")) return;
      void (async function () {
        try {
          var j = await app.adminCancelOrder(orderId);
          if (j && j.order) app.mergeOrderIntoCache(j.order);
          app.showSuccess("تم الإلغاء");
        } catch (err) {
          app.showError(err.message || "فشل الإلغاء");
        }
      })();
    }
  });
}

app.focusLiveOrderRow = function (orderId) {
  var oid = String(orderId || "").trim();
  if (!oid || !app.hasPermission("orders")) return;
  app.showPanel("panelOrders");
  void app.loadPanelById("panelOrders").then(function () {
    var root = document.getElementById("recentOrders");
    if (!root) return;
    var el = root.querySelector('[data-order-id="' + oid + '"]');
    if (el) {
        el.style.outline = "2px solid #5b371d";
        el.style.background = "#fff7ed";
        try {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_s) {
          el.scrollIntoView();
        }
      setTimeout(function () {
        el.style.outline = "";
        el.style.background = "";
      }, 2800);
    }
  });
}

app.findCacheOrderIndex = function (orderId) {
  var want = String(orderId || "").trim();
  for (var i = 0; i < app.cacheOrders.length; i++) {
    if (String(app.cacheOrders[i].id) === want) return i;
  }
  return -1;
}

app.buildLiveOrderRow = function (o) {
  var row = document.createElement("div");
  row.className = "live-order-row";
  row.setAttribute("data-live-order-id", String(o.id != null ? o.id : ""));
  var left = document.createElement("div");
  var idLine = document.createElement("div");
  idLine.className = "live-order-id";
  var meta = document.createElement("div");
  meta.className = "live-order-meta";
  left.appendChild(idLine);
  left.appendChild(meta);
  var top = document.createElement("div");
  top.className = "live-order-top";
  top.style.display = "grid";
  top.style.gridTemplateColumns = "1fr auto";
  top.style.gap = "8px";
  top.style.alignItems = "center";
  top.appendChild(left);
  var badge = document.createElement("span");
  badge.className = "live-badge";
  top.appendChild(badge);
  row.appendChild(top);
  var exec = document.createElement("div");
  exec.className = "live-order-exec";
  var existingExec = row.querySelector(".live-order-exec");
  if (existingExec) existingExec.remove();
  app.renderOrderExecButtons(exec, o);
  row.appendChild(exec);
  app.applyLiveOrderRowState(row, o);
  return row;
}

app.fillLiveOrderRowContent = function (row, o) {
  var idLine = row.querySelector(".live-order-id");
  var meta = row.querySelector(".live-order-meta");
  var badge = row.querySelector(".live-badge");
  if (idLine) {
    idLine.textContent = String(o.order_number || (o.id != null ? String(o.id).slice(0, 12) : ""));
  }
  if (meta) {
    var metaBits = [app.fmtWhen(o.created_at)];
    var sla = app.getOrderSlaLevel(o);
    if (sla) {
      var mins = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
      metaBits.push("⚠ " + app.slaLevelLabel(sla) + " (" + mins + " د)");
    }
    if (app.orderNeedsDriver(o)) metaBits.push("⚠ بدون مندوب");
    meta.textContent = metaBits.join(" · ");
  }
  if (badge) {
    var ci = app.classifyOrderStatusLive(o);
    var badgeCls = ci.cls;
    var badgeLabel = ci.label;
    var slaLvl = app.getOrderSlaLevel(o);
    if (slaLvl === "failure") {
      badgeCls = "live-badge--sla-failure";
      badgeLabel = "فشل SLA";
    } else if (slaLvl === "critical") {
      badgeCls = "live-badge--sla-critical";
      badgeLabel = "حرج SLA";
    } else if (slaLvl === "warning") {
      badgeCls = "live-badge--sla-warning";
      badgeLabel = "تحذير SLA";
    } else if (app.orderNeedsDriver(o)) {
      badgeCls = "live-badge--no-driver";
      badgeLabel = "بدون مندوب";
    }
    badge.className = "live-badge " + badgeCls;
    var raw = String(o.delivery_status || o.status || "—");
    badge.textContent = badgeLabel + " · " + raw;
  }
  var execEl = row.querySelector(".live-order-exec");
  if (execEl) app.renderOrderExecButtons(execEl, o);
}

app.applyLiveOrderRowState = function (row, o) {
  app.fillLiveOrderRowContent(row, o);
  row.className = "live-order-row";
  var slaLvl = app.getOrderSlaLevel(o);
  if (slaLvl === "warning") row.classList.add("live-order-row--sla-warning");
  if (slaLvl === "critical") row.classList.add("live-order-row--sla-critical");
  if (slaLvl === "failure") row.classList.add("live-order-row--sla-failure");
  if (app.orderNeedsDriver(o)) row.classList.add("live-order-row--no-driver");
}

app.adminRealtimeJoinTrackedOrders = function () {
  if (!app.adminSocket || !app.adminSocket.connected) return;
  var tok = app.PlatformAPI && typeof app.PlatformAPI.getToken === "function" ? app.PlatformAPI.getToken() : "";
  if (!tok) return;
  var lim = Math.min(app.cacheOrders.length, 40);
  for (var i = 0; i < lim; i++) {
    var oid = app.cacheOrders[i] && app.cacheOrders[i].id;
    if (oid == null) continue;
    var sid = String(oid).trim();
    if (!sid) continue;
    try {
      app.adminSocket.emit("join:order", sid);
    } catch (_e) {}
  }
}

app.handleAdminOrderPatch = function (msg) {
  if (!msg || !msg.patch) return;
  var oid = String(msg.orderId != null ? msg.orderId : msg.patch.id || "").trim();
  if (!oid) return;
  var idx = app.findCacheOrderIndex(oid);
  var prev = idx >= 0 ? app.cacheOrders[idx] : null;
  var merged;
  var isNew = idx < 0;
  if (idx >= 0) {
    merged = Object.assign({}, app.cacheOrders[idx], msg.patch);
    app.cacheOrders[idx] = merged;
  } else {
    merged = Object.assign({ id: oid }, msg.patch);
    app.cacheOrders.unshift(merged);
    if (app.cacheOrders.length > 600) app.cacheOrders.length = 600;
  }
  app.setBadge("badgeOrders", app.cacheOrders.length);
  if (app.activePanelId === "panelOrders") app.renderRecentOrders();
  app.applyLiveProfitOnOrderPatch(prev, merged, isNew);
  app.syncLiveMapMarkers();
  app.scheduleAdminLiveStatsRefresh();
  if (isNew) app.adminRealtimeJoinTrackedOrders();
}

app.handleAdminOrderLive = function (msg) {
  if (!msg || !msg.orderId) return;
  var oid = String(msg.orderId).trim();
  if (!oid) return;
  var idx = app.findCacheOrderIndex(oid);
  if (idx >= 0) {
    var extras = {};
    if (msg.arrivalPing !== undefined) extras._liveArrivalPing = msg.arrivalPing;
    if (msg.ts != null) extras._liveTs = msg.ts;
    app.cacheOrders[idx] = Object.assign({}, app.cacheOrders[idx], extras);
    if (app.activePanelId === "panelOrders") app.renderRecentOrders();
    app.syncLiveMapMarkers();
  } else {
    app.handleAdminOrderPatch({ orderId: oid, patch: { id: oid } });
    return;
  }
  app.scheduleAdminLiveStatsRefresh();
}

app.silentLoadRecentOrdersForRealtime = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/orders");
    app.cacheOrders = j.orders || [];
    app.setBadge("badgeOrders", app.cacheOrders.length);
    if (app.activePanelId === "panelOrders") app.renderRecentOrders();
    app.adminRealtimeJoinTrackedOrders();
    app.recomputeLiveProfitDelivered();
    app.renderLiveProfitCards();
    app.syncLiveMapMarkers();
    return true;
  } catch (_e) {
    return false;
  }
}

app.loadRecentOrders = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/orders");
    app.cacheOrders = j.orders || [];
    app.setBadge("badgeOrders", app.cacheOrders.length);
    app.renderRecentOrders();
    app.adminRealtimeJoinTrackedOrders();
    app.recomputeLiveProfitDelivered();
    app.renderLiveProfitCards();
    app.syncLiveMapMarkers();
  } catch (e) {
    app.showError(e.message || "فشل تحميل آخر الطلبات");
  }
}

app.renderRecentOrders = function () {
  var root = document.getElementById("recentOrders");
  if (!root) return;
  var q = app.getSearch("searchOrders");
  var rows = app.cacheOrders.filter(function (o) {
    return app.hasQueryMatch(q, [o.order_number, o.id, o.delivery_status, o.status, o.customer_phone]);
  });
  if (!rows.length) {
    root.innerHTML = '<div class="panel-empty">لا توجد طلبات مطابقة</div>';
    return;
  }
  root.innerHTML = rows
    .map(function (o) {
      var st = o.delivery_status || o.status || "—";
      var amount = Number(
        o.amount_display ||
          o.total_with_vat ||
          (Number(o.order_total || 0) + Number(o.delivery_fee || 0) + Number(o.vat_amount || 0)) ||
          o.order_total ||
          o.total_amount ||
          0
      );
      return (
        '<div class="item" data-order-id="' + app.escapeHtml(String(o.id || "")) + '">' +
        '<div class="line"><strong>' + (o.order_number || String(o.id || "").slice(0, 8)) + "</strong></div>" +
        '<div class="line">الحالة: ' + st + "</div>" +
        '<div class="line">المبلغ: ' + app.fmtMoney(amount) + "</div>" +
        '<div class="muted">' + (o.created_at || "") + "</div>" +
        "</div>"
      );
    })
    .join("");
}
