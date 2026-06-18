/**
 * ERVENOW — Driver Portal Preview (experimental unified shell)
 * Existing APIs only — no backend changes.
 */
(function (global) {
  "use strict";

  var shell = null;
  var W = null;

  var state = {
    me: null,
    orders: { ready_queue: [], active: [], completed: [], orders: [] },
    wallet: null,
    rating: { avg: null, count: 0 },
    activeSection: "dashboard",
    earningsRange: "today",
    earnings: null,
    online: true,
    locationOk: false,
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
    var ready = (state.orders.ready_queue || []).length;
    if (!done && !ready) return "—";
    return Math.round((done / Math.max(1, done + ready)) * 100) + "%";
  }

  function updateOnlineUi() {
    state.online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
    if (!shell) return;
    var statusHtml = state.online
      ? '<span class="pf-status-pill"><span>🟢</span><span>متصل</span></span>'
      : '<span class="pf-status-pill is-paused"><span>🔴</span><span>غير متصل</span></span>';
    shell.updateHeader({ toolsHtml: statusHtml });
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
      state.orders = {
        ready_queue: o.ready_queue || [],
        active: o.active || [],
        completed: o.completed || [],
        orders: o.orders || [],
      };
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

  function renderDashboard() {
    var bal = state.wallet && state.wallet.balance != null ? fmtMoney(state.wallet.balance) + " ر.س" : "—";
    var avg = state.rating.avg != null ? Number(state.rating.avg).toFixed(1) : "—";
    var activeN = (state.orders.active || []).length;
    var readyN = (state.orders.ready_queue || []).length;
    var doneN = completedToday().length;

    return (
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
      renderOrderList((state.orders.ready_queue || []).slice(0, 3), "ready", "لا طلبات جاهزة للاستلام الآن.") +
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
    var body =
      "<p class='dp-order-card__meta'>" +
      esc(o.store_name || "متجر") +
      "<br>" +
      esc(o.pickup_address || o.drop_address || "—") +
      "<br>" +
      fmtDate(o.created_at) +
      " · " +
      esc(STATUS_AR[st] || st) +
      "</p>";
    var actions = "";
    if (mode === "ready") {
      actions =
        '<button type="button" class="dp-btn dp-btn--primary dp-accept" data-id="' +
        esc(o.id) +
        '">استلام / قبول</button>';
    } else if (mode === "active") {
      if (st === "picked_up" || st === "accepted") {
        actions +=
          '<button type="button" class="dp-btn dp-btn--primary dp-start" data-id="' +
          esc(o.id) +
          '">بدء التوصيل</button>';
      }
      if (st === "delivering") {
        actions +=
          '<button type="button" class="dp-btn dp-btn--primary dp-complete" data-id="' +
          esc(o.id) +
          '">تم التسليم</button>';
      }
      actions +=
        '<a class="dp-btn dp-btn--ghost" href="/driver-app?order=' +
        encodeURIComponent(o.id) +
        '#track">تتبع حي</a>';
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
    return (
      '<h2 class="dp-section-title">الطلبات الجاهزة</h2>' +
      '<p class="dp-section-sub">Ready Queue — من نظام الاستلام الحالي</p>' +
      renderOrderList(state.orders.ready_queue || [], "ready", "لا طلبات جاهزة للاستلام الآن.") +
      '<p class="dp-section-sub"><a href="/driver">فتح لوحة المندوب الكاملة ↗</a></p>'
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
    return (
      '<h2 class="dp-section-title">المحفظة</h2>' +
      '<p class="dp-section-sub">Wallet — النظام الحالي</p>' +
      '<div class="dp-kpi-grid">' +
      kpi("الرصيد", fmtMoney(w.balance) + " ر.س") +
      kpi("إجمالي المكتسب", fmtMoney(w.total_earned) + " ر.س") +
      kpi("إجمالي المسحوب", fmtMoney(w.total_withdrawn) + " ر.س") +
      "</div>" +
      '<div class="dp-card dp-table-wrap"><h3>آخر الحركات</h3><table class="dp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      '<div class="dp-classic-links">' +
      '<a class="dp-btn dp-btn--primary" href="/driver-wallet">السحب والعمليات الكاملة</a>' +
      "</div>"
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
      '<a class="dp-btn dp-btn--ghost" href="/driver-login">تبديل الحساب</a>' +
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

  function renderMain() {
    var sectionId = shell ? shell.getActiveSection() : state.activeSection;
    state.activeSection = sectionId;
    if (shell) shell.setContent(renderSection(sectionId));
    if (shell) shell.renderNav();
    updateHeader();
    wireSectionEvents();
    if (sectionId === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("dpNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "driver-notif");
    }
  }

  async function refreshOrders() {
    var o = await api("/api/driver/orders");
    state.orders = {
      ready_queue: o.ready_queue || [],
      active: o.active || [],
      completed: o.completed || [],
      orders: o.orders || [],
    };
    renderMain();
  }

  function wireSectionEvents() {
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
    document.querySelectorAll(".dp-accept").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        try {
          var res = await api("/api/driver/accept/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "POST",
          });
          if (res && res.accepted === false) {
            showMsg((res && res.message) || "تعذّر الاستلام", false);
          } else {
            showMsg("تم الاستلام بنجاح", true);
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
    renderMain();
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
        return api("/api/driver/accept/" + encodeURIComponent(orderId), { method: "POST" }).then(function (res) {
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
      shell.mountNotifications().then(function () {
        state.notifOk = true;
        if (shell.getActiveSection() === "dashboard") renderMain();
      });
      global.addEventListener("online", updateOnlineUi);
      global.addEventListener("offline", updateOnlineUi);
    }

    if (!global.PlatformAPI || !PlatformAPI.getToken || !PlatformAPI.getToken()) {
      shell.showLogin();
      return;
    }
    if (global.ErvenowAuthGuard) {
      var me = await ErvenowAuthGuard.ensureApprovedAccount({
        loginUrl: "/driver-login",
        pendingUrl: "/pending-approval.html",
      });
      if (!me) {
        shell.showLogin();
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

  global.ErvenowDriverPreview = { init: init, navigate: navigate, refresh: loadCoreData };
})(typeof window !== "undefined" ? window : global);
