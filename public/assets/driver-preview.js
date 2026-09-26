/**
 * ERVENOW — Driver Portal Preview (experimental unified shell)
 * Existing APIs only — no backend changes.
 */
(function (global) {
  "use strict";

  var shell = null;
  var W = null;
  var notifOpsApi = null;
  var pollTimer = null;
  var presenceTimer = null;
  var locationHideBound = false;
  var locationHideBound = false;
  var knownOrderIds = [];
  var lastLat = NaN;
  var lastLng = NaN;
  var lastSentAt = 0;
  var sendingLocation = false;
  var POLL_MS = 45000;
  var PRESENCE_MS = 8000;

  var TRANSPORT_PROVIDER_TYPES = {
    pickup_truck: 1,
    car_transport: 1,
    vehicle_transfer: 1,
    internal_delivery: 1,
    furniture_move: 1,
    gas_cylinder_swap: 1,
    gas_central_refill: 1,
    gas_delivery: 1,
    car_polishing: 1,
  };

  function isTransportProviderProfile(profile) {
    var st = String((profile && profile.service_type) || "").toLowerCase();
    return !!TRANSPORT_PROVIDER_TYPES[st];
  }
  var PRESENCE_MS = 15000;

  var state = {
    me: null,
    orders: { ready_queue: [], legacy_open: [], active: [], completed: [], orders: [] },
    wallet: null,
    rating: { avg: null, count: 0 },
    activeSection: "dashboard",
    liveTrackOrderId: null,
    earningsRange: "today",
    earnings: null,
    online: true,
    locationOk: false,
    gpsActive: false,
    lastLocationSentAt: null,
    ordersOk: false,
    walletOk: false,
    notifOk: false,
  };

  var STATUS_AR = {
    pending: "قيد الانتظار",
    new: "جديد",
    accepted: "مقبول",
    preparing: "تجهيز",
    ready: "جاهز",
    picked_up: "تم الاستلام",
    picked: "تم الاستلام",
    delivering: "جاري التوصيل",
    delivered: "مُسلّم",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return iso;
    }
  }

  function api(path, opts) {
    if (!global.PlatformAPI || !PlatformAPI.api) throw new Error("PlatformAPI غير متاح");
    return PlatformAPI.api(path, opts);
  }

  function showMsg(text, ok) {
    if (shell) shell.showMessage(text, ok);
  }

  function normStatus(o) {
    var s = String((o && (o.delivery_status || o.status)) || "")
      .trim()
      .toLowerCase();
    if (s === "picked") return "picked_up";
    return s;
  }

  function driverName() {
    var p = (state.me && state.me.profile) || {};
    return p.full_name || p.name || p.phone || "المندوب";
  }

  function driverInitials() {
    var n = driverName();
    var parts = n.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] || "") + (parts[1][0] || "");
    return n.slice(0, 2);
  }

  function isToday(iso) {
    if (!iso) return false;
    var d = new Date(iso);
    var t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  function inRange(iso, range) {
    if (!iso) return false;
    var d = new Date(iso);
    var now = new Date();
    var start = new Date(now);
    if (range === "today") start.setHours(0, 0, 0, 0);
    else if (range === "week") start.setDate(start.getDate() - 7);
    else if (range === "month") start.setMonth(start.getMonth() - 1);
    return d >= start;
  }

  function completedToday() {
    return (state.orders.completed || []).filter(function (o) {
      return isToday(o.updated_at || o.created_at);
    });
  }

  function ordersTodayCount() {
    var all = state.orders.orders || [];
    return all.filter(function (o) {
      return isToday(o.created_at);
    }).length;
  }

  function earningsFromTx(range) {
    var txs = (state.wallet && state.wallet.last_transactions) || [];
    return txs
      .filter(function (t) {
        if (!inRange(t.created_at, range)) return false;
        var dir = String(t.direction || "").toLowerCase();
        var amt = Number(t.amount) || 0;
        return dir === "credit" || dir === "in" || (amt > 0 && dir !== "debit" && dir !== "out");
      })
      .reduce(function (s, t) {
        return s + Math.abs(Number(t.amount) || 0);
      }, 0);
  }

  function acceptRate() {
    var done = completedToday().length;
    var ready = readyQueueItems().length;
    if (!done && !ready) return "—";
    return Math.round((done / Math.max(1, done + ready)) * 100) + "%";
  }

  function isLegacyOpenOrder(o) {
    var s = normStatus(o);
    return (s === "new" || s === "pending") && !o.driver_id;
  }

  function readyQueueItems() {
    var seen = {};
    var out = [];
    function pushList(list) {
      (list || []).forEach(function (o) {
        var id = String(o.id || "");
        if (!id || seen[id]) return;
        seen[id] = 1;
        out.push(o);
      });
    }
    pushList(state.orders.ready_queue);
    pushList(state.orders.legacy_open);
    return out;
  }

  function applyOrdersPayload(o) {
    var ids = (o.orders || [])
      .map(function (x) {
        return String(x.id || "");
      })
      .filter(Boolean);
    var newIds = ids.filter(function (id) {
      return knownOrderIds.indexOf(id) === -1;
    });
    if (newIds.length && knownOrderIds.length) {
      try {
        if (global.ErvenowNotificationSounds && ErvenowNotificationSounds.play) {
          ErvenowNotificationSounds.play("notify");
        } else {
          new Audio("/assets/sounds/EW_NOTIFY.mp3").play();
        }
      } catch (_e) {}
    }
    knownOrderIds = ids;
    state.orders = {
      ready_queue: o.ready_queue || [],
      legacy_open: o.legacy_open || [],
      active: o.active || [],
      completed: o.completed || [],
      orders: o.orders || [],
    };
    if (global.ErvenowDriverOperational && ErvenowDriverOperational.syncActiveProximity) {
      ErvenowDriverOperational.syncActiveProximity(state.orders.active, proximityHandlers());
    }
  }

  function proximityHandlers() {
    return {
      patchStatus: async function (orderId, status) {
        var st = String(status || "").toLowerCase();
        if (st === "delivering") {
          await api("/api/driver/start-delivery/" + encodeURIComponent(orderId), { method: "POST" });
        } else if (st === "delivered") {
          await api("/api/driver/complete-order/" + encodeURIComponent(orderId), { method: "POST" });
        } else {
          await api("/api/order/" + encodeURIComponent(orderId) + "/status", {
            method: "PATCH",
            body: { delivery_status: status },
          });
        }
      },
      onPickup: function () {
        showMsg("تم بدء التوصيل (قرب نقطة الاستلام)", true);
        refreshOrders().catch(function () {});
      },
      onDeliver: function () {
        showMsg("تم التسليم (قرب نقطة التسليم)", true);
        refreshOrders().catch(function () {});
      },
    };
  }

  function hasActiveDelivery() {
    return (state.orders.active || []).some(function (o) {
      var s = normStatus(o);
      return s === "accepted" || s === "picked_up" || s === "delivering";
    });
  }

  function shouldSendLocation(lat, lng) {
    var now = Date.now();
    if (!Number.isFinite(lastLat) || !Number.isFinite(lastLng)) return true;
    var moved = Math.abs(lat - lastLat) + Math.abs(lng - lastLng) > 0.0004;
    if (!hasActiveDelivery()) return moved && now - lastSentAt > 60000;
    return moved || now - lastSentAt > 8000;
  }

  async function sendLocation(lat, lng) {
    if (sendingLocation || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!shouldSendLocation(lat, lng)) return;
    sendingLocation = true;
    try {
      var activeOrder =
        (state.orders.active || []).find(function (o) {
          var s = normStatus(o);
          return s === "accepted" || s === "picked_up" || s === "delivering";
        }) || null;
      var body = { lat: lat, lng: lng };
      if (activeOrder && activeOrder.id) body.order_id = activeOrder.id;
      await api("/api/driver/update-location", { method: "POST", body: body });
      lastLat = lat;
      lastLng = lng;
      lastSentAt = Date.now();
      try { localStorage.setItem("ervenowDriverLocAt", String(lastSentAt)); } catch (_ls) {}
      state.gpsActive = true;
      state.lastLocationSentAt = new Date().toISOString();
      updateOnlineUi();
      if (global.ErvenowDriverOperational && ErvenowDriverOperational.checkProximityAuto) {
        ErvenowDriverOperational.checkProximityAuto(lat, lng, proximityHandlers());
      }
    } catch (_e) {
      state.gpsActive = false;
      updateOnlineUi();
    } finally {
      sendingLocation = false;
    }
  }

  function startPresenceLocationLoop() {
    if (presenceTimer != null || !navigator.geolocation) return;
    presenceTimer = setInterval(function () {
      if (!navigator.onLine || document.hidden || trackWatchId != null) return;
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          sendLocation(pos.coords.latitude, pos.coords.longitude);
        },
        function () {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
      );
    }, PRESENCE_MS);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        sendLocation(pos.coords.latitude, pos.coords.longitude);
      },
      function () {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
  }

  function stopOperationalLoops() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (presenceTimer != null) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
    if (global.ErvenowDriverOperational && ErvenowDriverOperational.stopProximityLoop) {
      ErvenowDriverOperational.stopProximityLoop();
    }
  }

  var ordersPollBusy = false;

  function pauseOrdersPoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startOrdersPoll(runNow) {
    if (typeof document !== "undefined" && document.hidden) return;
    if (pollTimer == null) {
      pollTimer = setInterval(function () {
        if ((typeof document !== "undefined" && document.hidden) || ordersPollBusy) return;
        ordersPollBusy = true;
        pollTick()
          .catch(function () {})
          .finally(function () {
            ordersPollBusy = false;
          });
      }, POLL_MS);
    }
    if (runNow && !ordersPollBusy) {
      ordersPollBusy = true;
      pollTick()
        .catch(function () {})
        .finally(function () {
          ordersPollBusy = false;
        });
    }
  }

  function startOperationalLoops() {
    stopOperationalLoops();
    startOrdersPoll(false);
    startPresenceLocationLoop();
    if (!locationHideBound) {
      locationHideBound = true;
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          stopTrackWatch();
          pauseOrdersPoll();
          return;
        }
        startOrdersPoll(true);
      });
    }
  }

  async function pollTick() {
    if (!global.PlatformAPI || !PlatformAPI.getToken || !PlatformAPI.getToken()) return;
    var prevSection = shell ? shell.getActiveSection() : state.activeSection;
    await refreshOrders({ silent: true });
    if (notifOpsApi && notifOpsApi.refresh) {
      try {
        await notifOpsApi.refresh();
        state.notifOk = true;
      } catch (_e) {
        state.notifOk = false;
      }
    }
    if (shell && shell.getActiveSection() === prevSection) {
      renderMain();
    }
  }

  function updateOnlineUi() {
    state.online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
    if (!shell) return;
    var gpsLabel = state.gpsActive ? "موقع محدّث" : state.locationOk ? "GPS جاهز" : "تفعيل الموقع";
    var statusHtml = state.online
      ? '<span class="pf-status-pill"><span>🟢</span><span>متصل · ' + esc(gpsLabel) + "</span></span>"
      : '<span class="pf-status-pill is-paused"><span>🔴</span><span>غير متصل</span></span>';
    shell.updateHeader({ toolsHtml: statusHtml });
    if (global.ErvenowPortalProviderLocation) {
      if (state.gpsActive && Number.isFinite(lastLat) && Number.isFinite(lastLng)) {
        ErvenowPortalProviderLocation.syncButtonLabel({ lat: lastLat, lng: lastLng });
      } else {
        ErvenowPortalProviderLocation.syncButtonLabel(null);
      }
    }
  }

  function updateHeader() {
    if (!shell) return;
    shell.updateHeader({
      subtitle: driverName(),
      sidebarName: driverName(),
    });
    updateOnlineUi();
  }

  async function checkLocationPermission() {
    state.locationOk = false;
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      var p = await navigator.permissions.query({ name: "geolocation" });
      state.locationOk = p.state === "granted";
    } catch (_) {}
  }

  async function loadCoreData() {
    state.me = await api("/api/core/me");
    try {
      var o = await api("/api/driver/orders");
      applyOrdersPayload(o);
      state.ordersOk = true;
    } catch (e) {
      state.ordersOk = false;
      throw e;
    }
    try {
      state.wallet = await api("/api/driver/wallet");
      state.walletOk = true;
    } catch (_) {
      try {
        state.wallet = await api("/api/wallet");
        state.walletOk = true;
      } catch (_2) {
        state.wallet = { balance: 0, last_transactions: [] };
        state.walletOk = false;
      }
    }
    try {
      state.rating = await api("/api/driver/rating");
    } catch (_) {
      state.rating = { avg: null, count: 0 };
    }
    try {
      state.earnings = await api("/api/driver/earnings");
    } catch (_) {
      state.earnings = null;
    }
    await checkLocationPermission();
    updateHeader();
  }

  function kpi(lbl, val) {
    return (
      '<div class="dp-kpi"><span class="dp-kpi__lbl">' +
      esc(lbl) +
      '</span><span class="dp-kpi__val">' +
      esc(val) +
      "</span></div>"
    );
  }

  function opsItem(label, ok) {
    return (
      '<div class="dp-ops-item' +
      (ok ? "" : " is-warn") +
      '"><span>' +
      (ok ? "🟢" : "🟠") +
      "</span><span>" +
      esc(label) +
      "</span></div>"
    );
  }

  function locationReady() {
    if (state.gpsActive || state.locationOk) return true;
    return !!(global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.isReady());
  }

  function locationBannerHtml() {
    if (locationReady()) return "";
    return global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.renderBanner
      ? ErvenowPortalProviderLocation.renderBanner()
      : "";
  }

  async function ensureDriverLocationForOrders() {
    var Loc = global.ErvenowPortalProviderLocation;
    if (!Loc) return;
    try {
      if (typeof Loc.ensureForOrders === "function") {
        await Loc.ensureForOrders("driver");
      } else if (typeof Loc.captureAndSave === "function") {
        await Loc.captureAndSave("driver");
      }
    } catch (e) {
      showMsg((e && e.message) || "فعّل الموقع من القائمة لاستقبال الطلبات", false);
    }
  }

  function renderDashboard() {
    var bal = state.wallet && state.wallet.balance != null ? fmtMoney(state.wallet.balance) + " ر.س" : "—";
    var avg = state.rating.avg != null ? Number(state.rating.avg).toFixed(1) : "—";
    var activeN = (state.orders.active || []).length;
    var readyN = readyQueueItems().length;
    var doneN = completedToday().length;

    return (
      locationBannerHtml() +
      (W ? W.sectionHeader("الرئيسية", "بيئة عمل المندوب") : "") +
      (W
        ? W.kpiGrid([
            { label: "طلبات جديدة", value: String(readyN) },
            { label: "طلبات نشطة", value: String(activeN) },
            { label: "مكتملة اليوم", value: String(doneN) },
            { label: "أرباح اليوم", value: fmtMoney(earningsFromTx("today")), suffix: "ر.س" },
            { label: "الرصيد", value: bal.replace(" ر.س", ""), suffix: "ر.س" },
            { label: "التقييم", value: avg },
          ])
        : "") +
      '<div class="pf-home-block">' +
      '<div class="pf-home-block__head"><h3>الطلبات المتاحة</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="ready">عرض الكل</button></div>' +
      renderOrderList(readyQueueItems().slice(0, 3), "ready", "لا طلبات جاهزة للاستلام الآن.") +
      "</div>" +
      '<div class="pf-home-block">' +
      '<div class="pf-home-block__head"><h3>الطلبات النشطة</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="active">عرض الكل</button></div>' +
      renderOrderList(
        (state.orders.active || [])
          .filter(function (o) {
            var s = normStatus(o);
            return s === "picked_up" || s === "delivering" || s === "accepted";
          })
          .slice(0, 3),
        "active",
        "لا طلبات نشطة حالياً."
      ) +
      "</div>" +
      '<div class="pf-home-block">' +
      '<div class="pf-home-block__head"><h3>آخر المكتملة</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="completed">عرض الكل</button></div>' +
      renderOrderList((state.orders.completed || []).slice(0, 3), "", "لا طلبات مكتملة حديثاً.") +
      "</div>"
    );
  }

  function orderCard(o, mode) {
    var st = normStatus(o);
    var num = o.order_number || String(o.id || "").slice(0, 8);
    var legacyTag = mode === "ready" && isLegacyOpenOrder(o) ? " <span class='dp-legacy-tag'>توصيل مباشر</span>" : "";
    var body =
      "<p class='dp-order-card__meta'>" +
      esc(o.store_name || (isLegacyOpenOrder(o) ? "توصيل" : "متجر")) +
      legacyTag +
      "<br>" +
      esc(o.pickup_address || o.drop_address || "—") +
      "<br>" +
      fmtDate(o.created_at) +
      " · " +
      esc(STATUS_AR[st] || st) +
      (global.ErvenowUnifiedOrderRead && ErvenowUnifiedOrderRead.badgeHtml
        ? ErvenowUnifiedOrderRead.badgeHtml(o, "driver")
        : "") +
      "</p>";
    var actions = "";
    var uiActions = [];
    if (mode === "ready") {
      uiActions.push("accept_delivery");
      actions =
        '<button type="button" class="dp-btn dp-btn--primary dp-accept" data-id="' +
        esc(o.id) +
        '">استلام / قبول</button>';
    } else if (mode === "active") {
      if (st === "picked_up" || st === "accepted") {
        uiActions.push("start_delivery");
        actions +=
          '<button type="button" class="dp-btn dp-btn--primary dp-start" data-id="' +
          esc(o.id) +
          '">بدء التوصيل</button>';
      }
      if (st === "delivering") {
        uiActions.push("complete");
        actions +=
          '<button type="button" class="dp-btn dp-btn--primary dp-complete" data-id="' +
          esc(o.id) +
          '">تم التسليم</button>';
      }
      actions +=
        '<button type="button" class="dp-btn dp-btn--ghost dp-live-track" data-order-id="' +
        esc(o.id) +
        '">تتبع حي</button>';
      if (global.ErvenowDriverOperational && ErvenowDriverOperational.renderNavButtons) {
        actions += ErvenowDriverOperational.renderNavButtons(o, st);
      }
    }
    if (global.ErvenowUnifiedOrderRead && ErvenowUnifiedOrderRead.observeActions) {
      ErvenowUnifiedOrderRead.observeActions(o, "driver", uiActions);
    }
    return (
      '<article class="dp-order-card"><div class="dp-order-card__head"><span class="dp-order-card__num">' +
      esc(num) +
      "</span></div>" +
      body +
      (actions ? '<div class="dp-order-card__actions">' + actions + "</div>" : "") +
      "</article>"
    );
  }

  function renderOrderList(items, mode, emptyText) {
    if (!items.length) return '<p class="dp-empty">' + esc(emptyText) + "</p>";
    return '<div class="dp-order-list">' + items.map(function (o) { return orderCard(o, mode); }).join("") + "</div>";
  }

  function renderReady() {
    var legacyN = (state.orders.legacy_open || []).length;
  return (
      '<h2 class="dp-section-title">الطلبات الجاهزة</h2>' +
      '<p class="dp-section-sub">Ready Queue — جاهزة من المتجر' +
      (legacyN ? " · " + legacyN + " توصيل مباشر (legacy)" : "") +
      "</p>" +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="dp-btn dp-btn--ghost" id="dpRefreshOrders">تحديث</button></div>' +
      renderOrderList(readyQueueItems(), "ready", "لا طلبات جاهزة للاستلام الآن.")
    );
  }

  function renderActive() {
    var list = (state.orders.active || []).filter(function (o) {
      var s = normStatus(o);
      return s === "picked_up" || s === "delivering" || s === "accepted";
    });
    return (
      '<h2 class="dp-section-title">الطلبات النشطة</h2>' +
      '<p class="dp-section-sub">Active Orders — تم الاستلام · جاري التوصيل</p>' +
      renderOrderList(list, "active", "لا طلبات نشطة — استلم طلباً من القائمة الجاهزة.") +
      '<button type="button" class="dp-btn dp-btn--ghost" id="dpRefreshOrders">تحديث</button>'
    );
  }

  function renderCompleted() {
    return (
      '<h2 class="dp-section-title">الطلبات المكتملة</h2>' +
      '<p class="dp-section-sub">Completed Orders</p>' +
      renderOrderList(state.orders.completed || [], "", "لا طلبات مكتملة حديثاً.") 
    );
  }

  function earningsBlock(range) {
    var e = state.earnings || {};
    var block = e[range] || {};
    if (block.earnings_sar != null) return block;
    return {
      earnings_sar: earningsFromTx(range),
      trips: (state.orders.completed || []).filter(function (o) {
        return inRange(o.updated_at || o.created_at, range);
      }).length,
      avg_per_trip_sar: 0,
    };
  }

  function renderEarnings() {
    var ranges = [
      { key: "today", label: "اليوم" },
      { key: "week", label: "الأسبوع" },
      { key: "month", label: "الشهر" },
    ];
    var tabs = ranges
      .map(function (r) {
        return (
          '<button type="button" class="dp-tab' +
          (state.earningsRange === r.key ? " is-active" : "") +
          '" data-earn-range="' +
          r.key +
          '">' +
          esc(r.label) +
          "</button>"
        );
      })
      .join("");
    var block = earningsBlock(state.earningsRange);
    var amt = Number(block.earnings_sar) || 0;
    var done = Number(block.trips) || 0;
    var avg =
      block.avg_per_trip_sar != null && done > 0
        ? block.avg_per_trip_sar
        : done > 0
          ? Math.round((amt / done) * 100) / 100
          : 0;
    return (
      '<h2 class="dp-section-title">الأرباح</h2>' +
      '<p class="dp-section-sub">Earnings — من سجل المحفظة والرحلات المكتملة</p>' +
      '<div class="dp-tabs">' +
      tabs +
      "</div>" +
      '<div class="dp-kpi-grid">' +
      kpi("إجمالي الأرباح", fmtMoney(amt) + " ر.س") +
      kpi("عدد الرحلات", String(done)) +
      kpi("متوسط الدخل", fmtMoney(avg) + " ر.س") +
      "</div>"
    );
  }

  function renderWallet() {
    var w = state.wallet || {};
    var txs = w.last_transactions || [];
    var rows = txs.length
      ? txs
          .slice(0, 25)
          .map(function (t) {
            return (
              "<tr><td>" +
              fmtDate(t.created_at) +
              "</td><td>" +
              esc(t.description || t.note || t.type || "—") +
              "</td><td>" +
              fmtMoney(t.amount) +
              " ر.س</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="3" class="dp-empty">لا عمليات بعد</td></tr>';
    var withdrawPanel =
      global.ErvenowPortalWalletWithdraw && ErvenowPortalWalletWithdraw.renderWithdrawPanel
        ? ErvenowPortalWalletWithdraw.renderWithdrawPanel({ prefix: "dp", minAmount: 20 })
        : "";
    return (
      '<h2 class="dp-section-title">المحفظة</h2>' +
      '<p class="dp-section-sub">Wallet — الرصيد والسحب</p>' +
      '<div class="dp-kpi-grid">' +
      kpi("الرصيد", fmtMoney(w.balance) + " ر.س") +
      kpi("إجمالي المكتسب", fmtMoney(w.total_earned) + " ر.س") +
      kpi("إجمالي المسحوب", fmtMoney(w.total_withdrawn) + " ر.س") +
      "</div>" +
      withdrawPanel +
      '<div class="dp-card dp-table-wrap"><h3>آخر الحركات</h3><table class="dp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>"
    );
  }

  function findTrackOrder() {
    var id = String(state.liveTrackOrderId || "");
    var pools = []
      .concat(state.orders.active || [])
      .concat(state.orders.orders || [])
      .concat(state.orders.ready_queue || []);
    var found = id
      ? pools.find(function (o) {
          return String(o.id || "") === id;
        })
      : null;
    if (found) return found;
    var active = (state.orders.active || []).filter(function (o) {
      var s = normStatus(o);
      return s === "picked_up" || s === "delivering" || s === "accepted";
    });
    return active[0] || null;
  }

  function renderLiveTrack() {
    var order = findTrackOrder();
    if (order && order.id) state.liveTrackOrderId = order.id;
    if (!order) {
      return (
        '<h2 class="dp-section-title">التتبع الحي</h2>' +
        '<p class="dp-section-sub">من الطلب النشط: الخريطة، موقعك، والوصول</p>' +
        '<div class="dp-card"><p class="dp-empty" style="margin:0">لا يوجد طلب نشط. اقبل طلباً من الجاهزة ثم ارجع هنا.</p>' +
        '<button type="button" class="dp-btn dp-btn--primary" data-pf-section="ready">الطلبات الجاهزة</button></div>'
      );
    }
    var st = normStatus(order);
    var num = order.order_number || String(order.id || "").slice(0, 8);
    var canStart = st === "accepted" || st === "picked" || st === "picked_up";
    var onRoad = st === "delivering";
    return (
      '<h2 class="dp-section-title">التتبع الحي</h2>' +
      '<p class="dp-section-sub">طلب #' +
      esc(num) +
      " · " +
      esc(STATUS_AR[st] || st) +
      "</p>" +
      '<div class="dp-card dp-track-card">' +
      "<p><strong>الاستلام:</strong> " +
      esc(order.pickup_address || "—") +
      "</p>" +
      "<p><strong>التسليم:</strong> " +
      esc(order.drop_address || "—") +
      "</p>" +
      '<p id="dpTrackStatus">الحالة: ' +
      esc(STATUS_AR[st] || st) +
      "</p>" +
      '<p id="dpTrackGps">الموقع: بانتظار GPS</p>' +
      '<div id="dpTrackMap" class="dp-track-map" data-order="' +
      esc(order.id) +
      '"></div>' +
      '<div class="dp-track-actions">' +
      '<button type="button" class="dp-btn dp-btn--primary dp-track-start"' +
      (canStart ? "" : " disabled") +
      ' data-id="' +
      esc(order.id) +
      '">بدء التوصيل</button>' +
      '<button type="button" class="dp-btn dp-btn--ghost dp-track-arrived"' +
      (onRoad ? "" : " disabled") +
      ' data-id="' +
      esc(order.id) +
      '">وصلت للعنوان</button>' +
      '<button type="button" class="dp-btn dp-btn--primary dp-track-complete"' +
      (onRoad ? "" : " disabled") +
      ' data-id="' +
      esc(order.id) +
      '">تم التسليم</button>' +
      "</div></div>"
    );
  }

  function renderRating() {
    var avg = state.rating.avg != null ? Number(state.rating.avg).toFixed(1) : "—";
    var count = Number(state.rating.count) || 0;
    return (
      '<h2 class="dp-section-title">التقييم</h2>' +
      '<p class="dp-section-sub">Rating</p>' +
      '<div class="dp-kpi-grid">' +
      kpi("متوسط التقييم", avg) +
      kpi("عدد التقييمات", String(count)) +
      "</div>" +
      '<div class="dp-card"><p style="margin:0;font-weight:700;color:var(--dp-muted)">يُحسب من تقييمات العملاء على الطلبات المُسلّمة.</p></div>'
    );
  }

  function renderNotifications() {
    return (
      '<h2 class="dp-section-title">الإشعارات</h2>' +
      '<p class="dp-section-sub">Notifications — مركز الإشعارات داخل البوابة</p>' +
      '<div id="dpNotifHost" class="dp-notif-host"></div>'
    );
  }

  function renderSettings() {
    var p = (state.me && state.me.profile) || {};
    return (
      '<h2 class="dp-section-title">الإعدادات</h2>' +
      '<p class="dp-section-sub">Settings</p>' +
      '<div class="dp-card">' +
      "<p><strong>الاسم:</strong> " +
      esc(p.full_name || p.name || "—") +
      "</p>" +
      "<p><strong>الجوال:</strong> " +
      esc(p.phone || "—") +
      "</p>" +
      "<p><strong>الدور:</strong> " +
      esc(p.role || "driver") +
      "</p>" +
      "<p><strong>الحالة:</strong> " +
      esc(p.status || "—") +
      "</p></div>" +
      '<div class="dp-classic-links">' +
      '<a class="dp-btn dp-btn--ghost" href="/login?role=driver">تبديل الحساب</a>' +
      "</div>"
    );
  }

  function renderSection(id) {
    switch (id) {
      case "dashboard":
        return renderDashboard();
      case "ready":
        return renderReady();
      case "active":
        return renderActive();
      case "completed":
        return renderCompleted();
      case "earnings":
        return renderEarnings();
      case "wallet":
        return renderWallet();
      case "live-track":
        return renderLiveTrack();
      case "rating":
        return renderRating();
      case "notifications":
        return renderNotifications();
      case "settings":
        return renderSettings();
      default:
        return "";
    }
  }

  var trackMap = null;
  var trackDriverMarker = null;
  var trackPickupMarker = null;
  var trackDropMarker = null;
  var trackLine = null;
  var trackSocket = null;
  var trackWatchId = null;

  function stopTrackWatch() {
    if (trackWatchId != null && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(trackWatchId);
      } catch (_) {}
      trackWatchId = null;
    }
  }

  function destroyTrackMap() {
    stopTrackWatch();
    if (trackMap) {
      try {
        trackMap.remove();
      } catch (_) {}
    }
    trackMap = null;
    trackDriverMarker = null;
    trackPickupMarker = null;
    trackDropMarker = null;
    trackLine = null;
  }

  function paintDriverMarker(lat, lng) {
    if (!trackMap || !Number.isFinite(lat) || !Number.isFinite(lng) || typeof L === "undefined") return;
    if (!trackDriverMarker) {
      trackDriverMarker = L.circleMarker([lat, lng], {
        radius: 10,
        color: "#0f5a37",
        fillColor: "#b9872f",
        fillOpacity: 0.95,
      })
        .addTo(trackMap)
        .bindPopup("موقعك");
    } else {
      trackDriverMarker.setLatLng([lat, lng]);
    }
  }

  function ensureTrackSocket(orderId) {
    if (typeof io === "undefined" || !orderId) return;
    var token = global.PlatformAPI && PlatformAPI.getToken ? PlatformAPI.getToken() : "";
    if (!trackSocket) {
      trackSocket = io({ path: "/socket.io/", transports: ["websocket", "polling"], auth: { token: token } });
    }
    try {
      trackSocket.emit("join:order", String(orderId));
    } catch (_) {}
  }

  function pushTrackSocket(orderId) {
    if (!trackSocket || !orderId || !Number.isFinite(lastLat) || !Number.isFinite(lastLng)) return;
    try {
      trackSocket.emit("driver:location", { orderId: String(orderId), lat: lastLat, lng: lastLng });
    } catch (_) {}
  }

  async function drawTrackRoute(order) {
    if (!trackMap || !order || typeof L === "undefined") return;
    if (trackPickupMarker) trackMap.removeLayer(trackPickupMarker);
    if (trackDropMarker) trackMap.removeLayer(trackDropMarker);
    if (trackLine) trackMap.removeLayer(trackLine);
    trackPickupMarker = null;
    trackDropMarker = null;
    trackLine = null;
    var pLat = Number(order.pickup_lat);
    var pLng = Number(order.pickup_lng);
    var dLat = Number(order.drop_lat);
    var dLng = Number(order.drop_lng);
    var hasPickup = Number.isFinite(pLat) && Number.isFinite(pLng);
    var hasDrop = Number.isFinite(dLat) && Number.isFinite(dLng);
    if (hasPickup) trackPickupMarker = L.marker([pLat, pLng]).addTo(trackMap).bindPopup("استلام");
    if (hasDrop) trackDropMarker = L.marker([dLat, dLng]).addTo(trackMap).bindPopup("تسليم");
    if (hasPickup && hasDrop && global.ErvenowOsrmRoute && ErvenowOsrmRoute.drawOnMap) {
      try {
        var res = await ErvenowOsrmRoute.drawOnMap(
          trackMap,
          { lat: pLat, lng: pLng },
          { lat: dLat, lng: dLng },
          { style: { color: "#b9872f", weight: 5 }, padding: [28, 28], maxZoom: 15 }
        );
        trackLine = res.layer;
      } catch (_) {
        trackMap.fitBounds([[pLat, pLng], [dLat, dLng]], { padding: [28, 28] });
      }
    } else if (hasDrop) {
      trackMap.setView([dLat, dLng], 14);
    } else if (hasPickup) {
      trackMap.setView([pLat, pLng], 14);
    }
    paintDriverMarker(lastLat, lastLng);
    try {
      trackMap.invalidateSize();
    } catch (_) {}
  }

  function startTrackWatch(orderId) {
    stopTrackWatch();
    var gps = document.getElementById("dpTrackGps");
    if (!navigator.geolocation) {
      if (gps) gps.textContent = "المتصفح لا يدعم تحديد الموقع.";
      return;
    }
    if (gps) gps.textContent = "جاري تفعيل GPS…";
    ensureTrackSocket(orderId);
    trackWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        state.gpsActive = true;
        paintDriverMarker(lat, lng);
        if (gps) gps.textContent = "موقعك ظاهر على الخريطة";
        if (!document.hidden) {
          sendLocation(lat, lng);
          pushTrackSocket(orderId);
        }
        updateOnlineUi();
      },
      function () {
        if (gps) gps.textContent = "تعذّر قراءة GPS — اسمح بالموقع.";
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
  }

  function mountLiveTrack() {
    var host = document.getElementById("dpTrackMap");
    if (!host || typeof L === "undefined") return;
    var order = findTrackOrder();
    if (!order) return;
    destroyTrackMap();
    trackMap = L.map(host).setView([24.7136, 46.6753], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(trackMap);
    drawTrackRoute(order);
    startTrackWatch(order.id);
  }

  function syncTrackChrome() {
    var order = findTrackOrder();
    if (!order) return;
    var st = normStatus(order);
    var statusEl = document.getElementById("dpTrackStatus");
    if (statusEl) statusEl.textContent = "الحالة: " + (STATUS_AR[st] || st);
    var canStart = st === "accepted" || st === "picked" || st === "picked_up";
    var onRoad = st === "delivering";
    document.querySelectorAll(".dp-track-start").forEach(function (btn) {
      btn.disabled = !canStart;
    });
    document.querySelectorAll(".dp-track-arrived, .dp-track-complete").forEach(function (btn) {
      btn.disabled = !onRoad;
    });
    paintDriverMarker(lastLat, lastLng);
  }

  function renderMain() {
    var sectionId = shell ? shell.getActiveSection() : state.activeSection;
    state.activeSection = sectionId;
    var mapHost = document.getElementById("dpTrackMap");
    if (
      sectionId === "live-track" &&
      trackMap &&
      mapHost &&
      mapHost.getAttribute("data-order") === String(state.liveTrackOrderId || "")
    ) {
      syncTrackChrome();
      return;
    }
    if (sectionId !== "live-track") destroyTrackMap();
    if (shell) shell.setContent(renderSection(sectionId));
    if (shell) shell.renderNav();
    updateHeader();
    wireSectionEvents();
    if (sectionId === "live-track") mountLiveTrack();
    if (sectionId === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("dpNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "driver-notif");
    }
    if (sectionId === "wallet" && global.ErvenowPortalWalletWithdraw) {
      ErvenowPortalWalletWithdraw.wireWithdrawPanel({
        prefix: "dp",
        minAmount: 20,
        onMessage: function (text, ok) {
          if (text) showMsg(text, ok);
        },
        onSuccess: function () {
          loadCoreData()
            .then(function () {
              renderMain();
            })
            .catch(function () {});
        },
      });
    }
  }

  async function refreshOrders(opts) {
    opts = opts || {};
    var o = await api("/api/driver/orders");
    applyOrdersPayload(o);
    if (!opts.silent) renderMain();
  }

  function wireSectionEvents() {
    var main = shell ? shell.getMainEl() : document;
    if (global.ErvenowDriverOperational && ErvenowDriverOperational.wireNavButtons) {
      ErvenowDriverOperational.wireNavButtons(main);
    }
    document.querySelectorAll("[data-earn-range]").forEach(function (btn) {
      btn.onclick = function () {
        state.earningsRange = btn.getAttribute("data-earn-range");
        renderMain();
      };
    });
    var ref = document.getElementById("dpRefreshOrders");
    if (ref) {
      ref.onclick = function () {
        refreshOrders().catch(function (e) {
          showMsg(e.message || String(e), false);
        });
      };
    }
    document.querySelectorAll(".dp-track-start").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          var j = await api("/api/driver/start-delivery/" + encodeURIComponent(btn.getAttribute("data-id")), { method: "POST" });
          if (j && j.order) state.liveTrackOrderId = j.order.id;
          showMsg("بدأ التوصيل", true);
          await refreshOrders();
          destroyTrackMap();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
          btn.disabled = false;
        }
      };
    });
    document.querySelectorAll(".dp-track-arrived").forEach(function (btn) {
      btn.onclick = async function () {
        try {
          await api("/api/driver/ping-arrival/" + encodeURIComponent(btn.getAttribute("data-id")), { method: "POST" });
          var gps = document.getElementById("dpTrackGps");
          if (gps) gps.textContent = "تم إبلاغ العميل بالوصول";
          showMsg("تم إبلاغ العميل بالوصول", true);
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    });
    document.querySelectorAll(".dp-track-complete").forEach(function (btn) {
      btn.onclick = async function () {
        if (!global.confirm("تأكيد تسليم الطلب؟")) return;
        btn.disabled = true;
        try {
          await api("/api/driver/complete-order/" + encodeURIComponent(btn.getAttribute("data-id")), { method: "POST" });
          showMsg("تم التسليم", true);
          state.liveTrackOrderId = null;
          destroyTrackMap();
          await refreshOrders();
          if (shell) shell.navigate("completed");
        } catch (e) {
          showMsg(e.message || String(e), false);
          btn.disabled = false;
        }
      };
    });
    document.querySelectorAll(".dp-live-track").forEach(function (btn) {
      btn.onclick = function () {
        state.liveTrackOrderId = btn.getAttribute("data-order-id");
        if (shell) shell.navigate("live-track");
        else {
          state.activeSection = "live-track";
          renderMain();
        }
      };
    });
    document.querySelectorAll(".dp-accept").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          await ensureDriverLocationForOrders();
          if (!locationReady()) {
            showMsg("فعّل الموقع من القائمة (📍) لاستقبال الطلبات", false);
            return;
          }
          var res = await api("/api/driver/accept/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "POST",
          });
          if (res && res.accepted === false) {
            showMsg((res && res.message) || "تعذّر الاستلام", false);
          } else {
            showMsg("تم الاستلام بنجاح", true);
            if (global.ErvenowDriverOperational && ErvenowDriverOperational.speakArabic) {
              ErvenowDriverOperational.speakArabic("تم قبول الطلب. توجه إلى نقطة الاستلام.");
            }
            await refreshOrders();
          }
        } catch (e) {
          showMsg(e.message || String(e), false);
        } finally {
          btn.disabled = false;
        }
      };
    });
    document.querySelectorAll(".dp-start").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          await api("/api/driver/start-delivery/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "POST",
          });
          showMsg("بدء التوصيل", true);
          if (global.ErvenowDriverOperational && ErvenowDriverOperational.speakArabic) {
            ErvenowDriverOperational.speakArabic("بدء التوصيل. اتبع المسار إلى العميل.");
          }
          await refreshOrders();
        } catch (e) {
          showMsg(e.message || String(e), false);
        } finally {
          btn.disabled = false;
        }
      };
    });
    document.querySelectorAll(".dp-complete").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          await api("/api/driver/complete-order/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "POST",
          });
          showMsg("تم التسليم", true);
          if (global.ErvenowDriverOperational && ErvenowDriverOperational.speakArabic) {
            ErvenowDriverOperational.speakArabic("تم تسليم الطلب بنجاح.");
          }
          await refreshOrders();
          state.wallet = await api("/api/driver/wallet");
        } catch (e) {
          showMsg(e.message || String(e), false);
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  function navigate(section) {
    if (shell) shell.navigate(section);
  }

  async function boot() {
    await loadCoreData();
    var qOrder = "";
    try {
      qOrder = new URLSearchParams(global.location.search).get("order") || "";
    } catch (_) {}
    if (qOrder) {
      state.liveTrackOrderId = qOrder;
      if (shell) shell.navigate("live-track");
    }
    await ensureDriverLocationForOrders();
    renderMain();
    startOperationalLoops();
    if (shell.getActiveSection() === "dashboard") renderMain();
  }

  function createShell(portalCfg) {
    return ErvenowPortalFramework.PortalShell.create({
      role: "driver",
      config: portalCfg || ErvenowPortalFramework.RoleContext.getConfig("driver"),
      app: "#dpApp",
      loginEl: "#dpLogin",
      hashBase: "/driver-preview",
      notifKey: "driver-preview-header",
      operationalV2: true,
      portalTitle: "بوابة المندوب",
      onAcceptOrder: function (orderId) {
        return ensureDriverLocationForOrders().then(function () {
          if (!locationReady()) {
            throw new Error("فعّل الموقع من القائمة (📍) لاستقبال الطلبات");
          }
          return api("/api/driver/accept/" + encodeURIComponent(orderId), { method: "POST" });
        }).then(function (res) {
          if (res && res.accepted === false) throw new Error(res.message || "تعذّر الاستلام");
          showMsg("تم حجز الطلب — انتقل إلى الطلبات الجارية", true);
          return refreshOrders();
        });
      },
      onNotificationDetails: function (orderId) {
        if (shell) shell.navigate("active");
      },
      onNavigate: function (section) {
        state.activeSection = section;
        renderMain();
      },
    });
  }

  async function init() {
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      showMsg("Portal Framework غير محمّل", false);
      return;
    }
    if (!shell) {
      var portalCfg = ErvenowPortalFramework.RoleContext.getConfig("driver");
      if (ErvenowPortalFramework.PortalPlatformModules) {
        portalCfg = await ErvenowPortalFramework.PortalPlatformModules.filterConfig(portalCfg);
      }
      shell = createShell(portalCfg);
      W = shell.getWidgets();
      shell.mountChrome();
      shell.mountNotifications().then(function (api) {
        notifOpsApi = api;
        state.notifOk = !!api;
        if (shell.getActiveSection() === "dashboard") renderMain();
      });
      global.addEventListener("online", updateOnlineUi);
      global.addEventListener("offline", updateOnlineUi);
      global.addEventListener("beforeunload", stopOperationalLoops);
      global.addEventListener("ervenow:provider-location-updated", function (ev) {
        var d = (ev && ev.detail) || {};
        if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
          lastLat = d.lat;
          lastLng = d.lng;
          state.gpsActive = true;
          updateOnlineUi();
        }
      });
    }

    if (!global.PlatformAPI || !PlatformAPI.getToken || !PlatformAPI.getToken()) {
      shell.showLogin();
      return;
    }
    if (global.ErvenowAuthGuard) {
      var me = await ErvenowAuthGuard.ensureApprovedAccount({
        loginUrl: "/login?role=driver",
        pendingUrl: "/pending-approval.html",
      });
      if (!me) {
        shell.showLogin();
        return;
      }
      if (isTransportProviderProfile(me.profile)) {
        var hash = global.location.hash || "";
        global.location.replace("/transport-preview" + hash);
        return;
      }
      var role = String((me.profile && me.profile.role) || "").toLowerCase();
      if (role !== "driver" && role !== "admin") {
        showMsg("هذه المعاينة للمندوبين فقط.", false);
        shell.showLogin();
        return;
      }
    }
    try {
      shell.showApp();
      await boot();
    } catch (e) {
      showMsg(e.message || "تعذّر التحميل", false);
    }
  }

  global.ErvenowDriverPreview = {
    init: init,
    navigate: navigate,
    refresh: loadCoreData,
    stopLoops: stopOperationalLoops,
  };
})(typeof window !== "undefined" ? window : global);
