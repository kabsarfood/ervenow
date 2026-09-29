/**
 * ERVENOW — بوابة التاجر.
 * الكاشير اختياري داخل نفس المساحة. طلبات المنصة تبقى على دورة الطلب الحالية.
 */
(function (global) {
  "use strict";

  var shell = null;
  var W = null;
  var boardSocket = null;
  var boardRefreshTimer = null;
  var boardPollTimer = null;
  var notifCenterApi = null;
  var BOARD_POLL_MS = 45000;
  var OFFICIAL_PORTAL_PATH = "/merchant-dashboard";

  function currentPortalPath() {
    var p = String((global.location && global.location.pathname) || "").replace(/\/+$/, "") || "/";
    if (p === "/merchant-dashboard" || p === "/merchant-dashboard.html") return OFFICIAL_PORTAL_PATH;
    return "/merchant-preview";
  }

  function canonicalSection(id) {
    var rc = global.ErvenowPortalFramework && ErvenowPortalFramework.RoleContext;
    var raw = String(id || "").replace(/^#/, "");
    if (rc && typeof rc.normalizeSection === "function") return rc.normalizeSection("merchant", raw) || raw;
    return raw || "home";
  }

  function activeCanonical() {
    return canonicalSection(shell ? shell.getActiveSection() : state.activeSection);
  }

  var sectionCacheAt = {};

  var state = {
    storeId: null,
    store: null,
    hub: null,
    dashboard: null,
    board: null,
    products: [],
    categories: [],
    facilityCategories: [],
    publishReadiness: null,
    merchantCategories: [],
    withdrawals: [],
    withdrawalMeta: { balance: 0, available: 0, pending_reserved: 0, total_withdrawn: 0 },
    reviews: [],
    activeSection: "home",
    orderFilter: "active",
    orderQuery: "",
    orderDate: "",
    reportRange: "today",
    posEnabled: true,
    posMode: "A",
    cashiers: [],
    expenses: [],
    seenOrderIds: null,
    incoming: [],
  };

  var ORDER_GROUPS = {
    new: ["pending", "draft", "new"],
    preparing: ["accepted", "preparing"],
    ready: ["ready"],
    done: ["picked_up", "delivering", "delivered", "picked"],
  };

  var HUB_PAY_ROWS = [
    { key: "ew_pay", label: "EW PAY" },
    { key: "mada", label: "مدى" },
    { key: "visa", label: "Visa" },
    { key: "mastercard", label: "Mastercard" },
    { key: "apple_pay", label: "Apple Pay" },
    { key: "stc_pay", label: "STC Pay" },
    { key: "cash_on_delivery", label: "الدفع عند الوصول" },
    { key: "tabby", label: "Tabby" },
    { key: "tamara", label: "Tamara" },
  ];

  var checkoutPlatform = {};
  var checkoutPlatformLoaded = false;

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
      var d = new Date(iso);
      var day = d.toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit" });
      var time = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
      return day + " · " + time;
    } catch (_) {
      return iso;
    }
  }

  function orderDayKey(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function showMsg(text, ok) {
    if (shell) shell.showMessage(text, ok);
  }

  function normalizeStatus(s) {
    var x = String(s || "").trim().toLowerCase();
    if (x === "picked" || x === "delivering") return "picked_up";
    if (x === "draft" || x === "new") return "pending";
    return x;
  }

  function inOrderGroup(status, group) {
    var s = normalizeStatus(status);
    var keys = ORDER_GROUPS[group] || [];
    return keys.indexOf(s) >= 0;
  }

  function storeInitials(name) {
    var parts = String(name || "م").trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] || "") + (parts[1][0] || "");
    return (parts[0] || "م").slice(0, 2);
  }

  function api(path, opts) {
    if (!global.PlatformAPI || !PlatformAPI.api) throw new Error("PlatformAPI غير متاح");
    return PlatformAPI.api(path, opts);
  }

  function orderBoardPath() {
    var day = String(state.orderDate || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return "/api/store/order-board?date=" + day;
    return "/api/store/order-board";
  }

  async function loadOrderBoard() {
    try {
      state.board = await api(orderBoardPath());
      sectionCacheAt.orders = Date.now();
    } catch (_) {
      state.board = state.board || { orders: [], status_counts: {} };
    }
  }

  async function loadProductsCatalog() {
    if (!state.storeId) return;
    var sid = encodeURIComponent(state.storeId);
    try {
      var prod = await api("/api/store/products?store_id=" + sid + "&limit=80&offset=0");
      state.products = prod.products || [];
    } catch (_) {
      state.products = state.products || [];
    }
    try {
      var cats = await api("/api/store/product-category-options?store_id=" + sid);
      state.categories = cats.options || cats.categories || [];
    } catch (_) {
      state.categories = state.categories || [];
    }
    sectionCacheAt.products = Date.now();
  }

  function storeIdFromSocketMsg(msg) {
    if (!msg) return null;
    if (msg.store_id != null) return msg.store_id;
    if (msg.patch && msg.patch.store_id != null) return msg.patch.store_id;
    return null;
  }

  function orderSectionsNeedRefresh() {
    var section = activeCanonical();
    return section === "home" || section === "orders";
  }

  function sectionWantsOrderLive() {
    return orderSectionsNeedRefresh();
  }

  function scheduleBoardRefresh() {
    if (boardRefreshTimer) clearTimeout(boardRefreshTimer);
    boardRefreshTimer = setTimeout(function () {
      boardRefreshTimer = null;
      refreshOrderBoardLive().catch(function () {});
    }, 350);
  }

  async function refreshOrderBoardLive() {
    await loadOrderBoard();
    noteFreshPlatformOrders();
    if (orderSectionsNeedRefresh()) renderMain();
    else paintIncomingChrome();
  }

  function disconnectOrderBoardSocket() {
    if (boardSocket) {
      try {
        boardSocket.disconnect();
      } catch (_) {}
      boardSocket = null;
    }
  }

  function ensureSocketIo() {
    if (typeof global.io === "function") return Promise.resolve();
    if (ensureSocketIo.promise) return ensureSocketIo.promise;
    ensureSocketIo.promise = new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://cdn.socket.io/4.8.1/socket.io.min.js";
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        resolve();
      };
      document.head.appendChild(s);
    });
    return ensureSocketIo.promise;
  }

  function connectOrderBoardSocket() {
    if (boardSocket || !state.storeId) return;
    if (typeof global.io !== "function") {
      if (connectOrderBoardSocket.waiting) return;
      connectOrderBoardSocket.waiting = true;
      ensureSocketIo().then(function () {
        connectOrderBoardSocket.waiting = false;
        if (typeof global.io === "function") connectOrderBoardSocket();
      });
      return;
    }
    try {
      boardSocket = global.io({
        path: "/socket.io/",
        transports: ["websocket", "polling"],
        auth: {
          token:
            (global.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken()) ||
            localStorage.getItem("ervenow_access_token") ||
            "",
        },
      });
      function onStoreOrderEvent(msg) {
        if (!msg || !state.storeId) return;
        if (String(storeIdFromSocketMsg(msg) || "") !== String(state.storeId)) return;
        scheduleBoardRefresh();
      }
      boardSocket.on("order:patch", onStoreOrderEvent);
      boardSocket.on("order:new", onStoreOrderEvent);
      boardSocket.on("order:cancelled", onStoreOrderEvent);
    } catch (_) {}
  }

  var boardPollBusy = false;

  function startOrderBoardPolling(runNow) {
    if (typeof document !== "undefined" && document.hidden) return;
    if (runNow && !boardPollBusy) {
      boardPollBusy = true;
      refreshOrderBoardLive()
        .catch(function () {})
        .finally(function () {
          boardPollBusy = false;
        });
    }
    if (boardPollTimer) return;
    boardPollTimer = setInterval(function () {
      if ((typeof document !== "undefined" && document.hidden) || boardPollBusy) return;
      boardPollBusy = true;
      refreshOrderBoardLive()
        .catch(function () {})
        .finally(function () {
          boardPollBusy = false;
        });
    }, BOARD_POLL_MS);
  }

  function stopOrderBoardPolling() {
    if (boardPollTimer) {
      clearInterval(boardPollTimer);
      boardPollTimer = null;
    }
  }

  var boardLiveWanted = false;

  function startOrderBoardLive() {
    boardLiveWanted = true;
    connectOrderBoardSocket();
    startOrderBoardPolling(false);
  }

  function syncOrderLiveForSection() {
    if (sectionWantsOrderLive()) startOrderBoardLive();
    else stopOrderBoardPolling();
  }

  function stopOrderBoardLive() {
    boardLiveWanted = false;
    if (boardRefreshTimer) {
      clearTimeout(boardRefreshTimer);
      boardRefreshTimer = null;
    }
    stopOrderBoardPolling();
    disconnectOrderBoardSocket();
  }

  if (typeof document !== "undefined" && !startOrderBoardLive.visibilityBound) {
    startOrderBoardLive.visibilityBound = true;
    document.addEventListener("visibilitychange", function () {
      if (!boardLiveWanted) return;
      if (document.hidden) {
        stopOrderBoardPolling();
        return;
      }
      startOrderBoardPolling(true);
    });
  }

  async function loadCoreData() {
    var my = await api("/api/store/my-store");
    state.store = my.store || my;
    state.hub = my.merchant_hub || null;
    state.publishReadiness = my.publish_readiness || null;
    state.storeId = state.store && state.store.id;
    updateHeader();
    var jobs = [
      api("/api/store/merchant-dashboard").then(function (dash) {
        state.dashboard = dash;
      }),
    ];
    if (state.storeId) {
      jobs.push(
        api("/api/store/pos-settings")
          .then(function (j) {
            state.posEnabled = !(j && j.enabled === false);
            state.posMode = j && j.pos_mode === "B" ? "B" : "A";
          })
          .catch(function () {
            state.posEnabled = true;
          })
      );
    }
    await Promise.all(jobs);
    if (!state.board) {
      state.board = { orders: (state.dashboard && state.dashboard.orders) || [], status_counts: {} };
    }
  }

  async function loadFacilityCategories() {
    var type = String((state.store && state.store.type) || "").toLowerCase();
    var q = "";
    if (type === "restaurant") q = "restaurant";
    else if (type === "supermarket" || type === "minimarket") q = "market";
    if (!q) {
      state.facilityCategories = type ? [{ slug: type, label: type }] : [];
      return;
    }
    try {
      var j = await api("/api/categories?type=" + encodeURIComponent(q) + "&list=canonical&sort=manual");
      state.facilityCategories = j.categories || j.items || [];
    } catch (_) {
      state.facilityCategories = [];
    }
  }

  async function loadMerchantCategories() {
    if (!state.storeId) return;
    try {
      var res = await api(
        "/api/store/merchant-categories?store_id=" + encodeURIComponent(state.storeId)
      );
      state.merchantCategories = res.categories || [];
    } catch (_) {
      state.merchantCategories = [];
    }
  }

  async function loadExpenses() {
    if (!state.storeId) return;
    try {
      var j = await api("/api/store/expenses");
      state.expenses = (j && j.expenses) || [];
    } catch (_) {
      state.expenses = state.expenses || [];
    }
  }

  async function loadCashiers() {
    if (!state.storeId) return;
    try {
      var j = await api("/api/store/cashiers?store_id=" + encodeURIComponent(state.storeId));
      state.cashiers = (j && j.cashiers) || [];
    } catch (_) {
      state.cashiers = state.cashiers || [];
    }
  }

  async function loadWithdrawals() {
    try {
      var res = await api("/api/store/withdrawals");
      state.withdrawals = res.withdrawals || [];
      state.withdrawalMeta = {
        balance: Number(res.balance) || 0,
        available: Number(res.available) || 0,
        pending_reserved: Number(res.pending_reserved) || 0,
        total_withdrawn: Number(res.total_withdrawn) || 0,
        portal_type: res.portal_type || "merchant",
        wallet_source: res.wallet_source || null,
      };
    } catch (_) {
      state.withdrawals = [];
      state.withdrawalMeta = { balance: 0, available: 0, pending_reserved: 0 };
    }
  }

  function withdrawalStatusAr(st) {
    var s = String(st || "").toLowerCase();
    if (s === "approved") return "مُوافق عليه";
    if (s === "rejected") return "مرفوض";
    return "قيد المراجعة";
  }

  function renderCategories() {
    var rows = (state.merchantCategories || [])
      .map(function (c) {
        return (
          "<tr data-cat-slug='" +
          esc(c.slug) +
          "'><td><span aria-hidden='true'>" +
          esc(c.icon || "📦") +
          "</span> " +
          esc(c.label) +
          "</td><td>" +
          esc(c.slug) +
          "</td><td>" +
          String(c.product_count || 0) +
          "</td><td>" +
          String(c.sort_order != null ? c.sort_order : "—") +
          "</td><td>" +
          '<button type="button" class="mp-btn mp-btn--ghost mp-cat-up" data-slug="' +
          esc(c.slug) +
          '">▲</button> ' +
          '<button type="button" class="mp-btn mp-btn--ghost mp-cat-down" data-slug="' +
          esc(c.slug) +
          '">▼</button> ' +
          '<button type="button" class="mp-btn mp-btn--ghost mp-cat-edit" data-slug="' +
          esc(c.slug) +
          '">تعديل</button> ' +
          (c.is_builtin
            ? "<span style='font-size:0.8rem;color:var(--pf-muted)'>افتراضي</span>"
            : '<button type="button" class="mp-btn mp-btn--ghost mp-cat-del" data-slug="' +
              esc(c.slug) +
              '">حذف</button>') +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<h2 class="mp-section-title">الفئات</h2>' +
      '<p class="mp-section-sub">Categories — إدارة أقسام المنتجات</p>' +
      '<div class="mp-card mp-form" id="mpCatForm">' +
      "<h3>إنشاء / تعديل فئة</h3>" +
      '<input type="hidden" id="mpCatEditSlug" />' +
      "<label>المعرّف (slug — إنجليزي)</label><input id='mpCatSlug' type='text' placeholder='مثال: snacks' />" +
      "<label>الاسم بالعربية</label><input id='mpCatName' type='text' />" +
      "<label>الأيقونة (اختياري)</label><input id='mpCatIcon' type='text' placeholder='📦' />" +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSaveCategory">حفظ الفئة</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" id="mpResetCategory">مسح</button>' +
      "</div></div>" +
      '<div class="mp-card mp-table-wrap"><h3>جميع الفئات</h3><table class="mp-table"><thead><tr>' +
      "<th>الفئة</th><th>Slug</th><th>منتجات</th><th>ترتيب</th><th>إجراءات</th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="5" class="mp-empty">لا فئات بعد</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderWithdrawals() {
    var meta = state.withdrawalMeta || {};
    var rows = (state.withdrawals || [])
      .map(function (w) {
        var st = String(w.status || "").toLowerCase();
        var reason =
          st === "rejected" && w.rejection_reason
            ? '<p class="mp-withdraw-reason">سبب الرفض: ' + esc(w.rejection_reason) + "</p>"
            : "";
        return (
          "<tr><td>" +
          fmtDate(w.created_at) +
          "</td><td>" +
          fmtMoney(w.amount) +
          " ر.س</td><td>" +
          esc(withdrawalStatusAr(w.status)) +
          reason +
          "</td><td><code class='mp-tx-id' title='" +
          esc(w.id) +
          "'>" +
          esc(w.id || "—") +
          "</code></td></tr>"
        );
      })
      .join("");
    return (
      '<h2 class="mp-section-title">السحوبات</h2>' +
      '<p class="mp-section-sub">Withdrawals — محفظة المتجر (portal: merchant)</p>' +
      '<div class="mp-kpi-grid">' +
      kpiCard("الرصيد الحالي", fmtMoney(meta.balance) + " ر.س") +
      kpiCard("المتاح للسحب", fmtMoney(meta.available) + " ر.س") +
      kpiCard("معلّق (محجوز)", fmtMoney(meta.pending_reserved) + " ر.س") +
      kpiCard("إجمالي المسحوب", fmtMoney(meta.total_withdrawn) + " ر.س") +
      "</div>" +
      '<div class="mp-card mp-form">' +
      "<h3>طلب سحب جديد</h3>" +
      "<p style='margin:0 0 12px;font-size:0.88rem;color:var(--pf-muted)'>الحد الأدنى 10 ر.س — يُخصم من الرصيد المتاح بعد موافقة الإدارة.</p>" +
      "<label>المبلغ (ريال)</label><input id='mpWithdrawAmount' type='number' min='10' step='0.01' />" +
      "<label>الآيبان (مطابق للمسجّل)</label><input id='mpWithdrawIban' type='text' dir='ltr' placeholder='SA…' />" +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSubmitWithdraw" style="margin-top:12px">إرسال طلب السحب</button>' +
      "</div>" +
      '<div class="mp-card mp-table-wrap"><h3>آخر عمليات السحب</h3><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>رقم العملية</th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="4" class="mp-empty">لا طلبات سحب بعد</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderNotifications() {
    return (
      '<h2 class="mp-section-title">الإشعارات</h2>' +
      '<p class="mp-section-sub">Notifications — مركز الإشعارات داخل البوابة</p>' +
      '<div id="mpNotifHost" class="mp-notif-host"></div>'
    );
  }

  function updateHeader() {
    if (!shell) return;
    var name = (state.store && (state.store.name || state.store.store_name)) || "منشأتي";
    var st = String((state.store && state.store.status) || "active").toLowerCase();
    var active = st === "active" || st === "approved";
    var logo = (state.store && state.store.logo_url) || (state.hub && state.hub.logo_url);
    var pub = String((state.store && state.store.publication_status) || "").toLowerCase();
    var published = !!(state.store && state.store.is_published) || pub === "published";
    var needs = !!(state.store && state.store.needs_completion);
    var statusHtml =
      '<span class="pf-status-pill' +
      (published ? "" : " is-paused") +
      '"><span aria-hidden="true">' +
      (published ? "🟢" : needs ? "📝" : "⏸") +
      "</span><span>" +
      (published ? "منشور" : needs ? "مسودة — أكمل الصفحة" : active ? "معتمد" : "موقوف") +
      "</span></span>";
    shell.updateHeader({
      subtitle: name,
      sidebarName: name,
      toolsHtml: statusHtml,
    });
    if (global.ErvenowPortalProviderLocation) {
      ErvenowPortalProviderLocation.syncButtonLabel(state.store);
    }
    var footerHost = shell.getEls && shell.getEls().app && shell.getEls().app.querySelector("[data-pf-footer]");
    if (footerHost && global.ErvenowPortalFramework && ErvenowPortalFramework.PortalFooter && ErvenowPortalFramework.PortalFooter.mount) {
      ErvenowPortalFramework.PortalFooter.mount(footerHost, {
        portalTitle: "بوابة المتجر",
        compact: true,
        store: state.store || {},
      });
    }
  }

  function allBoardOrders() {
    return (state.board && state.board.orders) || (state.dashboard && state.dashboard.orders) || [];
  }

  function orderSourceKey(o) {
    var data = o && o.data && typeof o.data === "object" ? o.data : {};
    var raw = String(data.order_source || o.series_source || "").toLowerCase();
    return raw === "pos" ? "pos" : "ervenow";
  }

  function orderSourceLabel(o) {
    return orderSourceKey(o) === "pos" ? "كاشير" : "ERVENOW";
  }

  function isIncomingPlatformOrder(o) {
    var st = String((o && (o.delivery_status || o.board_status)) || "").toLowerCase();
    if (st !== "pending" && st !== "draft" && st !== "new") return false;
    return orderSourceKey(o) !== "pos";
  }

  function incomingPlatformCount() {
    return allBoardOrders().filter(isIncomingPlatformOrder).length;
  }

  function fulfillmentLabel(o) {
    var data = o && o.data && typeof o.data === "object" ? o.data : {};
    var f = String(data.fulfillment || "").toLowerCase();
    if (f === "local") return "محلي";
    if (f === "pickup") return "استلام";
    if (f === "delivery") return "توصيل";
    if (o && o.drop_address) return "توصيل";
    return "طلب";
  }

  function seedSeenOrders() {
    state.seenOrderIds = {};
    allBoardOrders().forEach(function (o) {
      if (o && o.id) state.seenOrderIds[String(o.id)] = true;
    });
  }

  function noteFreshPlatformOrders() {
    var list = allBoardOrders();
    if (!state.seenOrderIds) {
      seedSeenOrders();
      paintIncomingChrome();
      return;
    }
    var fresh = [];
    list.forEach(function (o) {
      if (!o || !o.id) return;
      var id = String(o.id);
      if (state.seenOrderIds[id]) return;
      state.seenOrderIds[id] = true;
      if (isIncomingPlatformOrder(o)) fresh.push(o);
    });
    if (fresh.length) {
      state.incoming = fresh.concat(state.incoming).slice(0, 3);
      if (global.ErvenowNotificationSounds && ErvenowNotificationSounds.play) {
        ErvenowNotificationSounds.play("alert");
      }
      var bell = document.querySelector(".erv-notification-bell");
      if (bell) {
        bell.classList.remove("is-pulse");
        void bell.offsetWidth;
        bell.classList.add("is-pulse");
      }
    }
    paintIncomingChrome();
  }

  function renderIncomingBanner() {
    var host = document.getElementById("mpIncomingHost");
    if (!host) return;
    var order = state.incoming[0];
    if (!order) {
      host.innerHTML = "";
      return;
    }
    var value = order.order_value != null ? order.order_value : order.total_with_vat || order.order_total || order.total;
    host.innerHTML =
      '<div class="mp-incoming" role="status">' +
      '<span class="mp-incoming__bell" aria-hidden="true">🔔</span>' +
      '<div class="mp-incoming__body"><strong>#' +
      esc(order.order_number || order.id) +
      ' طلب جديد</strong><span class="mp-incoming__meta">' +
      esc(fulfillmentLabel(order)) +
      " · " +
      fmtMoney(value) +
      " ر.س</span></div>" +
      '<div class="mp-incoming__actions">' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-incoming-view="' +
      esc(order.id) +
      '">عرض الطلب</button>' +
      '<button type="button" class="mp-btn mp-btn--primary" data-incoming-accept="' +
      esc(order.id) +
      '">قبول الطلب</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-incoming-dismiss="' +
      esc(order.id) +
      '" aria-label="إغلاق">×</button></div></div>';
  }

  function ensureIncomingHost() {
    if (document.getElementById("mpIncomingHost")) return;
    var main = shell && shell.getEls ? shell.getEls().main : null;
    var content = main && main.parentElement;
    if (!content) return;
    var host = document.createElement("div");
    host.id = "mpIncomingHost";
    host.className = "mp-incoming-host";
    content.insertBefore(host, content.firstChild);
    host.addEventListener("click", function (ev) {
      var view = ev.target.closest("[data-incoming-view]");
      var accept = ev.target.closest("[data-incoming-accept]");
      var dismiss = ev.target.closest("[data-incoming-dismiss]");
      if (view) {
        state.orderFilter = "new";
        navigate("orders");
        return;
      }
      if (dismiss) {
        var dismissId = dismiss.getAttribute("data-incoming-dismiss");
        state.incoming = state.incoming.filter(function (o) {
          return String(o.id) !== String(dismissId);
        });
        renderIncomingBanner();
        return;
      }
      if (!accept) return;
      var acceptId = accept.getAttribute("data-incoming-accept");
      accept.disabled = true;
      acceptPlatformOrder(acceptId)
        .then(function () {
          state.incoming = state.incoming.filter(function (o) {
            return String(o.id) !== String(acceptId);
          });
          showMsg("تم قبول الطلب", true);
          return refreshOrderBoardLive();
        })
        .catch(function (e) {
          accept.disabled = false;
          showMsg(e.message || String(e), false);
        });
    });
  }

  function acceptPlatformOrder(orderId) {
    if (global.ErvenowMerchantOrderWorkflow && ErvenowMerchantOrderWorkflow.patchOrderStatus) {
      return ErvenowMerchantOrderWorkflow.patchOrderStatus(orderId, "accepted");
    }
    return api("/api/order/" + encodeURIComponent(orderId) + "/status", {
      method: "PATCH",
      body: { delivery_status: "accepted" },
    });
  }

  function applyPosNav() {
    if (!shell || !shell.getConfig) return;
    var cfg = shell.getConfig();
    if (!cfg._merchantNavFull) cfg._merchantNavFull = (cfg.nav || []).slice();
    var show = state.posEnabled !== false;
    cfg.nav = cfg._merchantNavFull.filter(function (item) {
      if (!item) return false;
      if (item.id === "pos" && !show) return false;
      return true;
    });
    cfg.items = cfg.nav.map(function (item) {
      return item.id;
    });
    var count = incomingPlatformCount();
    cfg.nav.forEach(function (item) {
      if (item && item.id === "orders") item.badge = count > 0 ? (count > 9 ? "9+" : String(count)) : 0;
    });
    if (!show && activeCanonical() === "pos") {
      shell.navigate("home");
      return;
    }
    shell.renderNav();
  }

  function paintIncomingChrome() {
    applyPosNav();
    var count = incomingPlatformCount();
    var badge = document.querySelector("[data-pf-notifications] .erv-notification-badge");
    if (badge && count > 0) {
      badge.hidden = false;
      var shown = parseInt(String(badge.textContent).replace("+", ""), 10);
      if (!Number.isFinite(shown) || count > shown) badge.textContent = count > 9 ? "9+" : String(count);
    }
    renderIncomingBanner();
  }

  function ordersList() {
    var ops = global.ErvenowMerchantOrderOps;
    var q = String(state.orderQuery || "").trim().toLowerCase();
    var filter = state.orderFilter || "active";
    return allBoardOrders()
      .filter(function (o) {
        var st = ops && ops.boardStatus ? ops.boardStatus(o) : normalizeStatus(o.board_status || o.delivery_status);
        if (!st) return false;
        if (filter === "active") {
          if (st === "delivered") return false;
        } else if (st !== filter) return false;
        if (state.orderDate && orderDayKey(o.created_at) !== state.orderDate) return false;
        if (!q) return true;
        var blob = [o.order_number, o.id, o.customer_phone, o.customer_name, orderSourceLabel(o)].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      })
      .sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  }

  function countOrdersInGroup(group) {
    var orders = (state.board && state.board.orders) || (state.dashboard && state.dashboard.orders) || [];
    return orders.filter(function (o) {
      return inOrderGroup(o.board_status || o.delivery_status, group);
    }).length;
  }

  function todayOrders() {
    var orders = allBoardOrders();
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    return orders.filter(function (o) {
      return o.created_at && new Date(o.created_at) >= start;
    });
  }

  function filterOrdersByRange(range) {
    var orders = (state.dashboard && state.dashboard.orders) || [];
    var now = new Date();
    var start = new Date(now);
    if (range === "today") start.setHours(0, 0, 0, 0);
    else if (range === "week") start.setDate(start.getDate() - 7);
    else if (range === "month") start.setMonth(start.getMonth() - 1);
    return orders.filter(function (o) {
      return o.created_at && new Date(o.created_at) >= start;
    });
  }

  function completionBannerHtml() {
    var store = state.store || {};
    if (!store.needs_completion && store.is_published) return "";
    var ready = state.publishReadiness || {};
    var checks = ready.checks || [];
    var list = checks
      .map(function (c) {
        return (
          "<li>" +
          (c.ok ? "✓ " : "○ ") +
          esc(c.label) +
          "</li>"
        );
      })
      .join("");
    return (
      '<div class="mp-card mp-complete-banner" id="mpCompleteBanner">' +
      "<h3>أكمل صفحتك</h3>" +
      "<p>تم اعتماد منشأتك في ERVENOW. أكمل الحد الأدنى ثم اضغط اعتماد ونشر لتظهر للعملاء.</p>" +
      (list ? "<ul class='mp-complete-checks'>" + list + "</ul>" : "") +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="store">تعديل الهوية والفئة</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="products">المنتجات</button>' +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpPublishBtn">اعتماد ونشر المتجر</button>' +
      "</div></div>"
    );
  }

  function renderDashboard() {
    var agg = (state.dashboard && state.dashboard.aggregates) || {};
    var wallet = (state.dashboard && state.dashboard.wallet) || {};
    var store = (state.dashboard && state.dashboard.store) || state.store || {};
    var today = todayOrders();
    var todaySales = today.reduce(function (s, o) {
      return s + (Number(o.total) || Number(o.order_total) || 0);
    }, 0);
    var active =
      countOrdersInGroup("new") + countOrdersInGroup("preparing") + countOrdersInGroup("ready");

    return (
      (W ? W.sectionHeader("الرئيسية", "ملخص تشغيل المتجر") : "") +
      completionBannerHtml() +
      (W
        ? W.kpiGrid([
            { label: "🆕 طلبات جديدة", value: String(countOrdersInGroup("new")) },
            { label: "🔥 طلبات نشطة", value: String(active) },
            { label: "✅ مكتملة", value: String(countOrdersInGroup("done")) },
            { label: "💰 المبيعات", value: fmtMoney(todaySales), suffix: "ر.س" },
            { label: "💳 الرصيد", value: fmtMoney(wallet.balance), suffix: "ر.س" },
            {
              label: "🏪 حالة المتجر",
              value: store.status === "approved" ? (store.is_published === false ? "معتمد — غير منشور" : "منشور") : esc(store.status || "—"),
            },
          ])
        : "") +
      '<div class="mp-card"><h3>اختصارات التشغيل</h3><div class="mp-classic-links">' +
      '<button type="button" class="mp-btn mp-btn--primary" data-pf-section="orders">الطلبات</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="pos">الكاشير</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="products">المنتجات</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="wallet">المحفظة</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="store">المتجر</button>' +
      "</div></div>"
    );
  }

  function kpiCard(lbl, val) {
    return (
      '<div class="mp-kpi"><span class="mp-kpi__lbl">' +
      esc(lbl) +
      '</span><span class="mp-kpi__val">' +
      esc(val) +
      "</span></div>"
    );
  }

  function orderActionButtonsHtml(order) {
    var wf = global.ErvenowMerchantOrderWorkflow;
    var ops = global.ErvenowMerchantOrderOps;
    var st = ops && ops.boardStatus ? ops.boardStatus(order) : normalizeStatus(order.board_status || order.delivery_status);
    var id = esc(order.id);
    var parts = [];
    var next = wf && wf.nextActionFor ? wf.nextActionFor(st) : null;
    if (next) {
      parts.push(
        '<button type="button" class="mp-btn mp-btn--primary mp-order-action" data-order-id="' +
          id +
          '" data-next-status="' +
          esc(next.status) +
          '">' +
          esc(next.label) +
          "</button>"
      );
    }
    if (st && st !== "cancelled") {
      parts.push(
        '<button type="button" class="mp-btn mp-btn--ghost mp-order-print" data-order-id="' +
          id +
          '">طباعة الفاتورة</button>'
      );
    }
    if (st === "ready" || st === "picked_up") {
      parts.push(
        '<button type="button" class="mp-btn mp-btn--ghost mp-order-driver" data-order-id="' +
          id +
          '">بيانات المندوب</button>'
      );
    }
    if (st === "picked_up" || st === "delivering" || st === "ready") {
      var track = wf && wf.trackUrlForOrder ? wf.trackUrlForOrder(order.id) : "/track?id=" + encodeURIComponent(order.id);
      parts.push(
        '<a class="mp-btn mp-btn--ghost" href="' +
          esc(track) +
          '" target="_blank" rel="noopener">تتبع</a>'
      );
    }
    parts.push(
      '<button type="button" class="mp-btn mp-btn--ghost mp-order-detail" data-order-id="' +
        id +
        '">التفاصيل</button>'
    );
    return parts.join(" ");
  }

  function renderOrders() {
    var wf = global.ErvenowMerchantOrderWorkflow;
    var ops = global.ErvenowMerchantOrderOps;
    var rows = ordersList();
    var counts = ops
      ? ops.countsFromBoard(state.board, allBoardOrders())
      : { pending: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, delivered: 0 };
    var filter = state.orderFilter || "active";
    var counters = (ops && ops.COUNTERS ? ops.COUNTERS : [])
      .map(function (c) {
        var on = filter === c.key;
        return (
          '<button type="button" class="mp-ob-counter' +
          (on ? " is-active" : "") +
          '" data-order-filter="' +
          c.key +
          '" aria-pressed="' +
          (on ? "true" : "false") +
          '"><span class="mp-ob-counter__emoji">' +
          c.emoji +
          '</span><span class="mp-ob-counter__lbl">' +
          esc(c.ar) +
          '</span><span class="mp-ob-counter__val">' +
          (counts[c.key] || 0) +
          "</span></button>"
        );
      })
      .join("");
    var filterLabel =
      filter === "active"
        ? "الطلبات النشطة (بدون المُسلّمة)"
        : "عرض: " +
          (((ops && ops.COUNTERS) || []).find(function (c) {
            return c.key === filter;
          }) || { ar: filter }).ar;

    function cardHtml(o) {
      var st = ops && ops.boardStatus ? ops.boardStatus(o) : normalizeStatus(o.board_status || o.delivery_status);
      var pill = wf && wf.pillHtml ? wf.pillHtml(st) : "";
      var fulfill = ops && ops.fulfillmentOf ? ops.fulfillmentOf(o) : "";
      return (
        '<article class="mp-ob-card">' +
        '<div class="mp-ob-card__head"><h3>' +
        esc(o.order_number || o.id) +
        "</h3>" +
        pill +
        "</div>" +
        '<p><strong>العضو:</strong> ' +
        esc(o.customer_name || "عضو ERVENOW") +
        "</p>" +
        '<p><strong>عدد الأصناف:</strong> ' +
        (Number(o.item_count) || 0) +
        "</p>" +
        (fulfill ? "<p><strong>الاستلام:</strong> " + esc(fulfill) + "</p>" : "") +
        '<p><strong>الإجمالي:</strong> ' +
        fmtMoney(o.order_value != null ? o.order_value : o.total || o.order_total) +
        " ر.س</p>" +
        '<p><strong>الدفع:</strong> ' +
        esc(wf && wf.paymentLabel ? wf.paymentLabel(o.payment_status) : o.payment_status || "—") +
        " · " +
        esc(o.financial_status_label || "") +
        "</p>" +
        '<div class="mp-ob-fin">' +
        "<span>عمولة " +
        fmtMoney(o.commission) +
        '</span><span>صافي ' +
        fmtMoney(o.store_net) +
        "</span></div>" +
        '<div class="mp-ob-card__actions">' +
        orderActionButtonsHtml(o) +
        "</div></article>"
      );
    }

    var tableRows = rows.length
      ? rows
          .map(function (o) {
            var st = ops && ops.boardStatus ? ops.boardStatus(o) : normalizeStatus(o.board_status || o.delivery_status);
            var pill = wf && wf.pillHtml ? wf.pillHtml(st) : "";
            return (
              "<tr><td>" +
              fmtDate(o.created_at) +
              "</td><td>" +
              esc(o.order_number || o.id) +
              ' <span class="mp-order-source">' +
              esc(orderSourceLabel(o)) +
              "</span></td><td>" +
              esc(o.customer_name || "—") +
              "</td><td>" +
              pill +
              "</td><td>" +
              esc(wf && wf.paymentLabel ? wf.paymentLabel(o.payment_status) : "—") +
              "</td><td>" +
              fmtMoney(o.order_value != null ? o.order_value : o.total || o.order_total) +
              '</td><td class="mp-orders__tools">' +
              orderActionButtonsHtml(o) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="mp-empty">لا طلبات في هذا القسم</td></tr>';

    var cards = rows.length
      ? '<div class="mp-ob-cards">' + rows.map(cardHtml).join("") + "</div>"
      : '<p class="mp-empty mp-ob-empty">لا طلبات في هذا القسم</p>';

    return (
      '<div class="mp-orders">' +
      '<div class="mp-orders__bar">' +
      '<h2 class="mp-section-title">الطلبات</h2>' +
      '<label class="mp-orders__date">تاريخ<input id="mpOrderDate" type="date" value="' +
      esc(state.orderDate || "") +
      '" /></label>' +
      (state.orderDate
        ? '<button type="button" class="mp-btn mp-btn--ghost" id="mpOrderDateClear">كل الأيام</button>'
        : "") +
      '<input id="mpOrderSearch" class="mp-orders__search" type="search" placeholder="بحث برقم الطلب أو الجوال" value="' +
      esc(state.orderQuery || "") +
      '" />' +
      "</div>" +
      '<div class="mp-ob-counters" role="tablist" aria-label="عدادات الحالات">' +
      counters +
      "</div>" +
      '<p class="mp-section-sub" id="mpOrderFilterLabel">' +
      esc(filterLabel) +
      "</p>" +
      '<div class="mp-card mp-table-wrap mp-orders__table mp-orders__table--desktop"><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الطلب</th><th>العضو</th><th>الحالة</th><th>الدفع</th><th>الإجمالي</th><th>إجراءات</th>" +
      "</tr></thead><tbody>" +
      tableRows +
      "</tbody></table></div>" +
      '<div class="mp-orders__cards-mobile">' +
      cards +
      "</div></div>"
    );
  }

  var MAX_PRODUCT_IMAGES = 6;
  var productGallery = { slots: [], dirty: false };
  var productEditorSnap = null;

  function productImageUrlList(p) {
    if (!p) return [];
    var urls = [];
    if (Array.isArray(p.image_urls) && p.image_urls.length) {
      p.image_urls.forEach(function (u) {
        var s = String(u || "").trim();
        if (s && urls.indexOf(s) < 0) urls.push(s);
      });
      return urls.slice(0, MAX_PRODUCT_IMAGES);
    }
    var primary = String(p.image_url || p.thumbnail_url || "").trim();
    return primary ? [primary] : [];
  }

  function productCategoryLabel(p) {
    var slug = String((p && p.category) || "").trim();
    if (!slug) return "بدون قسم";
    var cats = state.categories || [];
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var v = String(c.value || c.slug || c.id || c || "").trim();
      if (v === slug) return c.label || c.name_ar || c.name || v;
    }
    return slug;
  }

  function revokeGalleryPreview(slot) {
    if (slot && slot.preview && String(slot.preview).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(slot.preview);
      } catch (_e) {}
    }
  }

  function resetProductGallery() {
    (productGallery.slots || []).forEach(revokeGalleryPreview);
    productGallery = { slots: [], dirty: false };
  }

  function blobToDataUrlLocal(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function gallerySlotToDataUrl(slot) {
    if (!slot) return null;
    if (slot.kind === "file" && slot.file) {
      if (!global.compressImageToDataUrl) throw new Error("تعذر ضغط الصورة");
      return global.compressImageToDataUrl(slot.file, 0.72, 1280);
    }
    if (slot.kind === "dataUrl" && slot.dataUrl) return slot.dataUrl;
    var url = slot.url;
    if (!url) return null;
    var res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("تعذر قراءة صورة موجودة — أعد رفع الصور المتبقية");
    var blob = await res.blob();
    return blobToDataUrlLocal(blob);
  }

  function paintProductGallery() {
    var box = document.getElementById("mpPGallery");
    if (!box) return;
    var slots = productGallery.slots || [];
    if (!slots.length) {
      box.innerHTML = '<p class="mp-gallery__empty">لا صور بعد — الصورة الأولى هي الرئيسية</p>';
      return;
    }
    box.innerHTML = slots
      .map(function (slot, idx) {
        var src = slot.preview || slot.url || slot.dataUrl || "";
        var label = idx === 0 ? "رئيسية" : "إضافية " + idx;
        return (
          '<div class="mp-gallery__item">' +
          (src
            ? '<img src="' + esc(src) + '" alt="" />'
            : '<div class="mp-gallery__ph" aria-hidden="true">🖼</div>') +
          '<span class="mp-gallery__badge">' +
          esc(label) +
          "</span>" +
          '<button type="button" class="mp-btn mp-btn--ghost mp-gallery__rm" data-gallery-rm="' +
          idx +
          '">إزالة</button></div>'
        );
      })
      .join("");
    box.querySelectorAll("[data-gallery-rm]").forEach(function (btn) {
      btn.onclick = function () {
        var i = Number(btn.getAttribute("data-gallery-rm"));
        if (!Number.isFinite(i) || i < 0 || i >= productGallery.slots.length) return;
        revokeGalleryPreview(productGallery.slots[i]);
        productGallery.slots.splice(i, 1);
        productGallery.dirty = true;
        paintProductGallery();
      };
    });
  }

  function addGalleryFiles(fileList, replaceMain) {
    if (!fileList || !fileList.length) return;
    productGallery.dirty = true;
    var files = [];
    for (var i = 0; i < fileList.length; i++) files.push(fileList[i]);
    var start = 0;
    if (replaceMain && files[0]) {
      var mainSlot = { kind: "file", file: files[0], preview: URL.createObjectURL(files[0]) };
      if (productGallery.slots.length) {
        revokeGalleryPreview(productGallery.slots[0]);
        productGallery.slots[0] = mainSlot;
      } else {
        productGallery.slots.push(mainSlot);
      }
      start = 1;
    }
    for (var j = start; j < files.length && productGallery.slots.length < MAX_PRODUCT_IMAGES; j++) {
      productGallery.slots.push({
        kind: "file",
        file: files[j],
        preview: URL.createObjectURL(files[j]),
      });
    }
    paintProductGallery();
  }

  function snapshotProductEditorIfOpen() {
    var nameEl = document.getElementById("mpPName");
    if (!nameEl) return;
    productEditorSnap = {
      editId: document.getElementById("mpEditId") ? document.getElementById("mpEditId").value : "",
      name: nameEl.value,
      desc: document.getElementById("mpPDesc") ? document.getElementById("mpPDesc").value : "",
      price: document.getElementById("mpPPrice") ? document.getElementById("mpPPrice").value : "",
      offer: document.getElementById("mpPOffer") ? document.getElementById("mpPOffer").value : "",
      category: document.getElementById("mpPCategory") ? document.getElementById("mpPCategory").value : "",
      stock: document.getElementById("mpPStock") ? document.getElementById("mpPStock").value : "",
      sort: document.getElementById("mpPSort") ? document.getElementById("mpPSort").value : "0",
      active: document.getElementById("mpPActive") ? !!document.getElementById("mpPActive").checked : true,
      gallerySlots: productGallery.slots,
      galleryDirty: productGallery.dirty,
    };
  }

  function restoreProductEditorIfOpen() {
    if (!productEditorSnap || !document.getElementById("mpPName")) return;
    var s = productEditorSnap;
    document.getElementById("mpEditId").value = s.editId || "";
    document.getElementById("mpPName").value = s.name || "";
    if (document.getElementById("mpPDesc")) document.getElementById("mpPDesc").value = s.desc || "";
    if (document.getElementById("mpPPrice")) document.getElementById("mpPPrice").value = s.price || "";
    if (document.getElementById("mpPOffer")) document.getElementById("mpPOffer").value = s.offer || "";
    if (document.getElementById("mpPCategory")) document.getElementById("mpPCategory").value = s.category || "";
    if (document.getElementById("mpPStock")) document.getElementById("mpPStock").value = s.stock || "";
    if (document.getElementById("mpPSort")) document.getElementById("mpPSort").value = s.sort != null && s.sort !== "" ? s.sort : "0";
    if (document.getElementById("mpPActive")) document.getElementById("mpPActive").checked = s.active !== false;
    productGallery.slots = s.gallerySlots || [];
    productGallery.dirty = !!s.galleryDirty;
    paintProductGallery();
  }

  function productCardHtml(p, opts) {
    opts = opts || {};
    var img = p.image_url || p.thumbnail_url || "";
    var offer = p.offer_price != null && Number(p.offer_price) > 0 ? Number(p.offer_price) : null;
    var priceHtml = offer
      ? '<span class="mp-product-card__offer">' +
        fmtMoney(offer) +
        ' ر.س</span> <s>' +
        fmtMoney(p.price) +
        "</s>"
      : fmtMoney(p.price) + " ر.س";
    var extraCount = Array.isArray(p.image_urls) && p.image_urls.length > 1 ? p.image_urls.length - 1 : 0;
    var ratingN = p.rating != null && Number(p.rating) > 0 ? Number(p.rating) : null;
    var sortN = p.sort_order != null && p.sort_order !== "" ? Number(p.sort_order) : 0;
    var status = p.active === false ? "مخفي" : "ظاهر";
    var extraHint = extraCount > 0 ? '<span class="mp-product-card__extra">+' + extraCount + " صور</span>" : "";
    return (
      '<article class="mp-product-card">' +
      (img
        ? '<img src="' + esc(img) + '" alt="" loading="lazy" />'
        : '<div style="aspect-ratio:1;background:#f5ebe0"></div>') +
      extraHint +
      '<div class="mp-product-card__body"><p class="mp-product-card__name">' +
      esc(p.name) +
      '</p><p class="mp-product-card__meta">' +
      esc(productCategoryLabel(p)) +
      " · " +
      esc(status) +
      " · ترتيب " +
      (Number.isFinite(sortN) ? String(sortN) : "0") +
      "</p><p class=\"mp-product-card__price\">" +
      priceHtml +
      "</p>" +
      (ratingN != null
        ? '<p class="mp-product-card__rating">📊 ' + ratingN.toFixed(1) + "</p>"
        : "") +
      (opts.manage
        ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
          '<button type="button" class="mp-btn mp-btn--ghost mp-prod-edit" data-id="' +
          esc(p.id) +
          '">تعديل</button>' +
          '<button type="button" class="mp-btn mp-btn--ghost mp-prod-del" data-id="' +
          esc(p.id) +
          '">إخفاء</button></div>'
        : "") +
      "</div></article>"
    );
  }

  function starsHtml(rating) {
    var n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(n);
  }

  function renderProducts() {
    var grid = state.products.length
      ? '<div class="mp-product-grid">' +
        state.products.map(function (p) {
          return productCardHtml(p, { manage: true });
        }).join("") +
        "</div>"
      : '<p class="mp-empty">لا منتجات بعد</p>';

    var catOpts = (state.categories || [])
      .map(function (c) {
        var v = c.value || c.slug || c.id || c;
        var l = c.label || c.name_ar || c.name || v;
        return '<option value="' + esc(v) + '">' + esc(l) + "</option>";
      })
      .join("");

    return (
      '<h2 class="mp-section-title">المنتجات</h2>' +
      '<p class="mp-section-sub">Products — إدارة الكتالوج الحالي</p>' +
      '<div class="mp-card mp-form" id="mpProductForm">' +
      "<h3>إضافة / تعديل منتج</h3>" +
      '<input type="hidden" id="mpEditId" />' +
      "<label>اسم المنتج</label><input id='mpPName' type='text' />" +
      "<label>الوصف</label><textarea id='mpPDesc' rows='2'></textarea>" +
      "<label>السعر (ريال)</label><input id='mpPPrice' type='number' min='0' step='0.01' />" +
      "<label>سعر العرض (اختياري)</label><input id='mpPOffer' type='number' min='0' step='0.01' />" +
      "<label>ترتيب العرض</label><input id='mpPSort' type='number' step='1' value='0' />" +
      "<label>القسم</label><select id='mpPCategory'><option value=''>— بدون —</option>" +
      catOpts +
      "</select>" +
      "<label>المخزون (اختياري)</label><input id='mpPStock' type='number' min='0' step='1' />" +
      "<label><input id='mpPActive' type='checkbox' checked /> متاح للبيع</label>" +
      "<label>صورة رئيسية</label><input id='mpPImage' type='file' accept='image/*' />" +
      "<label>صور إضافية (حتى 5)</label><input id='mpPImages' type='file' accept='image/*' multiple />" +
      '<p class="mp-section-sub">المجموع حتى 6 صور مع الرئيسية — المعرض يُحمَّل عند التحرير فقط.</p>' +
      '<div id="mpPGallery" class="mp-gallery"></div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSaveProduct">حفظ المنتج</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" id="mpResetProduct">مسح</button>' +
      "</div></div>" +
      '<div class="mp-card"><h3>جميع المنتجات</h3>' +
      grid +
      "</div>"
    );
  }

  function renderReviews() {
    var store = state.store || {};
    var avg = Number(store.average_rating) || 0;
    var count = Number(store.rating_count) || 0;
    var rows = state.reviews.length
      ? state.reviews
          .map(function (r) {
            return (
              '<div class="mp-review-item"><div class="mp-review-item__stars">' +
              starsHtml(r.rating) +
              "</div>" +
              (r.comment
                ? '<p class="mp-review-item__text">' + esc(r.comment) + "</p>"
                : '<p class="mp-review-item__text mp-empty">بدون تعليق نصي</p>') +
              '<div class="mp-review-item__date">' +
              fmtDate(r.created_at) +
              "</div></div>"
            );
          })
          .join("")
      : '<p class="mp-empty">لا توجد تقييمات بعد.</p>';
    return (
      '<h2 class="mp-section-title">تقييمات العملاء</h2>' +
      '<p class="mp-section-sub">Reviews</p>' +
      '<div class="mp-kpi-grid">' +
      kpiCard("متوسط التقييم", count > 0 ? avg.toFixed(1) + " ★" : "—") +
      kpiCard("عدد التقييمات", String(count)) +
      "</div>" +
      '<div class="mp-card"><h3>آخر التقييمات</h3>' +
      rows +
      "</div>"
    );
  }

  function renderVisitorPreview() {
    var store = state.store || {};
    var href = state.storeId ? "/store.html?id=" + encodeURIComponent(state.storeId) + "&preview=1" : "#";
    var grid = state.products.length
      ? '<div class="mp-product-grid">' +
        state.products
          .filter(function (p) {
            return p.active !== false;
          })
          .slice(0, 8)
          .map(function (p) {
            return productCardHtml(p);
          })
          .join("") +
        "</div>"
      : '<p class="mp-empty">لا منتجات بعد.</p>';
    return (
      '<h2 class="mp-section-title">معاينة المتجر</h2>' +
      '<p class="mp-section-sub">Visitor Preview</p>' +
      '<div class="mp-card"><p><strong>' +
      esc(store.name || store.store_name || "متجرك") +
      "</strong></p>" +
      '<a class="mp-btn mp-btn--primary" href="' +
      esc(href) +
      '" target="_blank" rel="noopener">فتح صفحة المتجر</a>' +
      "<h3>عينة من المنتجات</h3>" +
      grid +
      "</div>"
    );
  }

  function storeAdminTab() {
    try {
      var t = sessionStorage.getItem("ervenow_store_admin_tab") || "products";
      if (t === "cashiers") return "products";
      if (t !== "categories" && t !== "offers") return "products";
      return t;
    } catch (_) {
      return "products";
    }
  }

  function renderCashiers() {
    var rows = (state.cashiers || [])
      .map(function (c) {
        return (
          "<tr><td>" +
          esc(c.name) +
          "</td><td>" +
          esc(c.phone) +
          "</td><td>" +
          esc(c.branch_id || "—") +
          "</td><td>" +
          (c.active === false ? "موقوف" : "نشط") +
          "</td><td>cashier</td><td>" +
          '<button type="button" class="mp-btn mp-btn--ghost" data-cashier-toggle="' +
          esc(c.id) +
          '" data-cashier-active="' +
          (c.active === false ? "1" : "0") +
          '">' +
          (c.active === false ? "تفعيل" : "إيقاف") +
          "</button></td></tr>"
        );
      })
      .join("");
    return (
      '<h2 class="mp-section-title">الموظفون</h2>' +
      '<p class="mp-section-sub">نظام الكاشير الحالي — الدور دائماً cashier</p>' +
      '<div class="mp-card mp-form">' +
      "<h3>إضافة كاشير</h3>" +
      "<p class=\"mp-section-sub\">الدور دائمًا cashier. لا يُستخدم رقم صاحب المتجر.</p>" +
      "<label>الاسم</label><input id='mpCashierName' type='text' />" +
      "<label>رقم الجوال</label><input id='mpCashierPhone' type='tel' inputmode='tel' />" +
      "<label>الفرع (اختياري)</label><input id='mpCashierBranch' type='text' />" +
      '<div class="mp-form-actions"><button type="button" class="mp-btn mp-btn--primary" id="mpSaveCashier">حفظ الموظف</button></div></div>' +
      '<div class="mp-card mp-table-wrap"><table class="mp-table"><thead><tr><th>الاسم</th><th>الجوال</th><th>الفرع</th><th>الحالة</th><th>الدور</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="mp-empty">لا موظفين بعد</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderStoreAdmin(tab) {
    var current = tab || "products";
    if (current !== "categories" && current !== "offers") current = "products";
    try {
      sessionStorage.setItem("ervenow_store_admin_tab", current);
    } catch (_) {}
    var tabs = [
      ["products", "المنتجات"],
      ["categories", "الأقسام"],
      ["offers", "العروض"],
    ];
    var bar = tabs
      .map(function (pair) {
        return (
          '<button type="button" class="mp-btn' +
          (pair[0] === current ? " mp-btn--primary" : " mp-btn--ghost") +
          '" data-store-tab="' +
          pair[0] +
          '">' +
          pair[1] +
          "</button>"
        );
      })
      .join("");
    var body =
      current === "categories" ? renderCategories() : current === "offers" ? renderOffers() : renderProducts();
    return (
      '<h2 class="mp-section-title">المنتجات</h2>' +
      '<div class="mp-store-tabs" role="tablist">' +
      bar +
      "</div>" +
      body
    );
  }

  function renderOffers() {
    var withOffer = state.products.filter(function (p) {
      return p.offer_price != null && Number(p.offer_price) > 0;
    });
    var without = state.products.filter(function (p) {
      return !(p.offer_price != null && Number(p.offer_price) > 0);
    });
    return (
      '<h2 class="mp-section-title">العروض</h2>' +
      '<p class="mp-section-sub">Offers — منتجات بسعر عرض نشط</p>' +
      '<div class="mp-card"><h3>عروض نشطة (' +
      withOffer.length +
      ")</h3>" +
      (withOffer.length
        ? '<div class="mp-product-grid">' +
          withOffer.map(function (p) {
            return productCardHtml(p);
          }).join("") +
          "</div>"
        : '<p class="mp-empty">لا عروض نشطة — أضف سعر عرض من قسم المنتجات</p>') +
      "</div>" +
      '<div class="mp-card"><h3>بدون عرض حالياً (' +
      without.length +
      ")</h3>" +
      (without.length
        ? '<div class="mp-product-grid">' +
          without
            .slice(0, 12)
            .map(function (p) {
              return productCardHtml(p);
            })
            .join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderWallet() {
    var wallet = (state.dashboard && state.dashboard.wallet) || {};
    var txs = (state.dashboard && state.dashboard.transactions) || [];
    var txRows = txs.length
      ? txs
          .slice(0, 30)
          .map(function (t) {
            return (
              "<tr><td>" +
              fmtDate(t.created_at) +
              "</td><td>" +
              esc(t.description || t.type || "—") +
              "</td><td>" +
              fmtMoney(t.amount) +
              " ر.س</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="3" class="mp-empty">لا عمليات بعد</td></tr>';

    return (
      '<h2 class="mp-section-title">المحفظة</h2>' +
      '<p class="mp-section-sub">Wallet — الرصيد والعمليات (النظام الحالي)</p>' +
      '<div class="mp-kpi-grid">' +
      kpiCard("الرصيد المتاح", fmtMoney(wallet.balance) + " ر.س") +
      kpiCard("إجمالي الأرباح", fmtMoney(wallet.total_earned) + " ر.س") +
      kpiCard("العمولات", fmtMoney(wallet.total_commission) + " ر.س") +
      "</div>" +
      '<div class="mp-card mp-table-wrap"><h3>آخر العمليات</h3><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>" +
      txRows +
      "</tbody></table></div>" +
      renderWithdrawals()
    );
  }

  function renderPos() {
    return '<div id="mpPosMount"></div>';
  }

  function posSettingCardHtml() {
    return (
      '<div class="mp-card mp-form"><h3>استخدام كاشير ERVENOW</h3>' +
      '<label class="mp-pay-row" for="mpPosEnabled"><input id="mpPosEnabled" type="checkbox"' +
      (state.posEnabled !== false ? " checked" : "") +
      " /> يظهر «الكاشير POS» في القائمة. إيقافه لا يوقف استقبال طلبات المنصة.</label></div>"
    );
  }

  function rangeStart(range) {
    var start = new Date();
    if (range === "today") start.setHours(0, 0, 0, 0);
    else if (range === "week") start.setDate(start.getDate() - 7);
    else if (range === "month") start.setMonth(start.getMonth() - 1);
    else start.setHours(0, 0, 0, 0);
    return start;
  }

  function expensesInRange(range) {
    var start = rangeStart(range);
    return (state.expenses || []).filter(function (row) {
      var raw = row.spent_at || row.created_at;
      if (!raw) return false;
      var d = /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? new Date(String(raw) + "T12:00:00") : new Date(raw);
      return !Number.isNaN(d.getTime()) && d >= start;
    });
  }

  function expenseSum(rows) {
    return rows.reduce(function (s, row) {
      return s + (Number(row.amount) || 0);
    }, 0);
  }

  function renderExpenses() {
    var rows = state.expenses || [];
    var total = expenseSum(rows);
    var body = rows.length
      ? rows
          .map(function (row) {
            return (
              "<tr><td>" +
              esc(row.spent_at || "—") +
              "</td><td>" +
              esc(row.item || row.note || "—") +
              "</td><td>" +
              esc(row.note || "—") +
              "</td><td>" +
              fmtMoney(row.amount) +
              " ر.س</td><td>" +
              esc(row.cashier_name || "—") +
              '</td><td><button type="button" class="mp-btn mp-btn--ghost mp-expense-del" data-expense-id="' +
              esc(row.id) +
              '">حذف</button></td></tr>'
            );
          })
          .join("")
      : '<tr><td colspan="6" class="mp-empty">لا مصروفات محفوظة بعد</td></tr>';
    return (
      '<h2 class="mp-section-title">المصروفات</h2>' +
      '<p class="mp-section-sub">فاتورة المصروف تُحفظ باسم الكاشير وتُخصم من صافي الربح. لا تمس المحفظة.</p>' +
      '<div class="mp-kpi-grid">' +
      kpiCard("إجمالي المصروفات", fmtMoney(total) + " ر.س") +
      "</div>" +
      '<form class="mp-card mp-form mp-expense-form" id="mpExpenseForm">' +
      "<label>فاتورة السعر<input id=\"mpExpenseAmount\" type=\"number\" min=\"0.01\" step=\"0.01\" inputmode=\"decimal\" required /></label>" +
      "<label>الصنف<input id=\"mpExpenseItem\" type=\"text\" maxlength=\"80\" required placeholder=\"مثل: إيجار، مشتريات\" /></label>" +
      "<label>الملاحظات<textarea id=\"mpExpenseNote\" maxlength=\"400\" rows=\"3\" placeholder=\"ملاحظة اختيارية\"></textarea></label>" +
      '<div class="mp-form-actions"><button type="submit" class="mp-btn mp-btn--primary">حفظ</button></div>' +
      "</form>" +
      '<div class="mp-card"><h3>السجل</h3><div class="mp-table-wrap"><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الصنف</th><th>الملاحظات</th><th>السعر</th><th>الكاشير</th><th></th></tr></thead><tbody>" +
      body +
      "</tbody></table></div></div>"
    );
  }

  function renderReports() {
    var ranges = [
      { key: "today", label: "اليوم" },
      { key: "week", label: "الأسبوع" },
      { key: "month", label: "الشهر" },
    ];
    var tabs = ranges
      .map(function (r) {
        return (
          '<button type="button" class="mp-tab' +
          (state.reportRange === r.key ? " is-active" : "") +
          '" data-report-range="' +
          r.key +
          '">' +
          esc(r.label) +
          "</button>"
        );
      })
      .join("");
    var filtered = filterOrdersByRange(state.reportRange);
    var sales = filtered.reduce(function (s, o) {
      return s + (Number(o.total) || Number(o.order_total) || 0);
    }, 0);
    var spent = expenseSum(expensesInRange(state.reportRange));
    var net = sales - spent;

    return (
      '<h2 class="mp-section-title">التقارير</h2>' +
      '<p class="mp-section-sub">صافي الربح = إجمالي المبيعات − المصروفات</p>' +
      '<div class="mp-tabs">' +
      tabs +
      "</div>" +
      '<div class="mp-kpi-grid">' +
      kpiCard("عدد الطلبات", String(filtered.length)) +
      kpiCard("إجمالي المبيعات", fmtMoney(sales) + " ر.س") +
      kpiCard("المصروفات", fmtMoney(spent) + " ر.س") +
      kpiCard("صافي الربح", fmtMoney(net) + " ر.س") +
      "</div>" +
      '<div class="mp-card"><h3>تفاصيل الطلبات</h3><div class="mp-table-wrap"><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الطلب</th><th>الحالة</th><th>الإجمالي</th></tr></thead><tbody>" +
      (filtered.length
        ? filtered
            .map(function (o) {
              return (
                "<tr><td>" +
                fmtDate(o.created_at) +
                "</td><td>" +
                esc(o.order_number || o.id) +
                "</td><td>" +
                esc(o.delivery_status || "—") +
                "</td><td>" +
                fmtMoney(o.total || o.order_total) +
                " ر.س</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="4" class="mp-empty">لا بيانات في هذه الفترة</td></tr>') +
      "</tbody></table></div></div>" +
      renderExpenses()
    );
  }

  function platformCheckoutAllows(key) {
    if (!checkoutPlatform || typeof checkoutPlatform !== "object") return true;
    if (Object.prototype.hasOwnProperty.call(checkoutPlatform, key)) return !!checkoutPlatform[key];
    return true;
  }

  function storeCategorySlug() {
    var store = state.store || {};
    var raw = String(store.category || "").split(",")[0].trim();
    var type = String(store.type || "").toLowerCase();
    if (!raw || raw.toLowerCase() === type) return "";
    return raw;
  }

  function savedLocationValue(store) {
    store = store || {};
    var url = String(store.maps_url || "").trim();
    if (url) return url;
    if (store.lat != null && store.lng != null && String(store.lat) !== "" && String(store.lng) !== "") {
      return String(store.lat) + "," + String(store.lng);
    }
    return "";
  }

  function mediaPreviewHtml(url, alt) {
    var src = String(url || "").trim();
    if (!src) return '<p class="mp-media-empty">لم يُرفع بعد — سيبقى هنا بعد الحفظ</p>';
    return '<img class="mp-media-preview" src="' + esc(src) + '" alt="' + esc(alt) + '" />';
  }

  function hubPaySelectHtml() {
    var hm =
      state.hub && state.hub.checkout_payment_methods && typeof state.hub.checkout_payment_methods === "object"
        ? state.hub.checkout_payment_methods
        : {};
    var hasSaved = Object.keys(hm).length > 0;
    var opts = HUB_PAY_ROWS.filter(function (row) {
      return platformCheckoutAllows(row.key);
    })
      .map(function (row) {
        var selected = hasSaved && hm[row.key] !== false;
        return (
          '<option value="' +
          esc(row.key) +
          '"' +
          (selected ? " selected" : "") +
          ">" +
          esc(row.label) +
          "</option>"
        );
      })
      .join("");
    return (
      '<label for="mpHubPay">وسائل الدفع</label>' +
      '<select id="mpHubPay" multiple size="6">' +
      opts +
      "</select>" +
      '<p class="mp-section-sub">اختر من القائمة ما يناسب المتجر. يمكن تحديد أكثر من وسيلة.</p>'
    );
  }

  function findBoardOrder(id) {
    var list = ordersList();
    var hit = list.find(function (o) {
      return String(o.id) === String(id);
    });
    if (hit) return hit;
    return (state.board && state.board.orders ? state.board.orders : []).find(function (o) {
      return String(o.id) === String(id);
    });
  }

  function closeOrderDetailModal() {
    var ops = global.ErvenowMerchantOrderOps;
    if (ops && ops.destroyMap) ops.destroyMap();
    var existing = document.getElementById("mpOrderModal");
    if (existing) existing.remove();
  }

  function showOrderDetailModal(order, extraHtml) {
    if (!order) return;
    var ops = global.ErvenowMerchantOrderOps;
    closeOrderDetailModal();
    var el = document.createElement("div");
    el.id = "mpOrderModal";
    el.className = "mp-modal";
    el.innerHTML =
      '<div class="mp-modal__backdrop" id="mpOrderModalBackdrop"></div>' +
      '<div class="mp-modal__box" role="dialog" aria-modal="true">' +
      '<button type="button" class="mp-modal__close" id="mpOrderModalClose" aria-label="إغلاق">×</button>' +
      "<h3>طلب " +
      esc(order.order_number || order.id) +
      "</h3>" +
      (extraHtml || "") +
      (ops && ops.detailBodyHtml ? ops.detailBodyHtml(order) : "") +
      '<div class="mp-modal__actions" id="mpOrderModalActions">' +
      orderActionButtonsHtml(order) +
      "</div></div>";
    document.body.appendChild(el);
    function close() {
      closeOrderDetailModal();
    }
    document.getElementById("mpOrderModalBackdrop").onclick = close;
    document.getElementById("mpOrderModalClose").onclick = close;
    bindOrderActionButtons(el);
    if (ops && ops.mountDropMap) ops.mountDropMap("mpOrderMap", order);
  }

  function renderStore() {
    var hub = state.hub || {};
    var store = state.store || {};
    var currentCat = storeCategorySlug();
    var seenCat = {};
    var catOpts = (state.facilityCategories || [])
      .map(function (c) {
        var v = String(c.slug || c.value || c.id || c || "").trim();
        if (!v || seenCat[v]) return "";
        seenCat[v] = true;
        var l = c.label || c.name_ar || c.name || v;
        return (
          '<option value="' +
          esc(v) +
          '"' +
          (v === currentCat ? " selected" : "") +
          ">" +
          esc(l) +
          "</option>"
        );
      })
      .join("");
    if (currentCat && !seenCat[currentCat]) {
      catOpts =
        '<option value="' +
        esc(currentCat) +
        '" selected>' +
        esc(store.category_label_ar || currentCat) +
        "</option>" +
        catOpts;
    }
    var locVal = savedLocationValue(store);
    var locLocked = !!locVal;
    var locHref = /^https?:\/\//i.test(locVal)
      ? locVal
      : locVal
        ? "https://www.google.com/maps?q=" + encodeURIComponent(locVal)
        : "";
    var addressLine = store.address || store.location_text || locVal || "—";
    var previewHref = state.storeId
      ? "/store.html?id=" + encodeURIComponent(state.storeId) + "&preview=1"
      : "#";
    return (
      '<h2 class="mp-section-title">المتجر</h2>' +
      '<p class="mp-section-sub">هوية المتجر والموقع والنشر</p>' +
      completionBannerHtml() +
      '<div class="mp-classic-links" style="margin-bottom:12px">' +
      '<a class="mp-btn mp-btn--primary" href="' +
      esc(previewHref) +
      '" target="_blank" rel="noopener">معاينة المتجر</a>' +
      "</div>" +
      '<div class="mp-card mp-form"><h3>الهوية والبروفايل</h3>' +
      "<p><strong>الاسم:</strong> " +
      esc(store.name || store.store_name) +
      "</p>" +
      "<p><strong>حالة النشر:</strong> " +
      esc(
        store.is_published === false
          ? "غير منشور"
          : store.status === "approved"
            ? "معتمد"
            : store.status || "—"
      ) +
      "</p>" +
      "<label for='mpHubCategory'>الفئة</label>" +
      "<select id='mpHubCategory'><option value=''>— اختر الفئة —</option>" +
      catOpts +
      "</select>" +
      "<label for='mpHubBio'>الوصف</label>" +
      "<textarea id='mpHubBio' rows='3'>" +
      esc(hub.bio || store.bio || "") +
      "</textarea>" +
      "<label for='mpHubLogo'>الشعار</label>" +
      mediaPreviewHtml(store.logo_url, "شعار المتجر") +
      "<input id='mpHubLogo' type='file' accept='image/*' />" +
      "<label for='mpHubBanner'>الغلاف</label>" +
      mediaPreviewHtml(hub.banner_url, "غلاف المتجر") +
      "<input id='mpHubBanner' type='file' accept='image/*' />" +
      '<div class="mp-form-actions"><button type="button" class="mp-btn mp-btn--primary" id="mpSaveHub">حفظ</button></div></div>' +
      '<div class="mp-card mp-form" id="mpLocCard"><h3>الموقع</h3>' +
      "<p><strong>العنوان الحالي:</strong> " +
      esc(addressLine) +
      "</p>" +
      (locVal
        ? '<p class="mp-loc-saved" id="mpLocSaved"><a href="' +
          esc(locHref) +
          '" target="_blank" rel="noopener">' +
          esc(locVal) +
          "</a></p>"
        : "") +
      '<div id="mpLocEditor"' +
      (locLocked ? " hidden" : "") +
      ">" +
      "<label for='mpStoreLoc'>رابط Google Maps أو lat,lng</label>" +
      "<input id='mpStoreLoc' type='text' inputmode='text' value='" +
      esc(locVal) +
      "' placeholder='الصق رابط Google Maps أو 24.7,46.6' />" +
      '<div class="mp-form-actions">' +
      '<button type="button" class="mp-btn mp-btn--ghost" id="mpStoreLocGps">حدد مكانك</button>' +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSaveStoreLoc">حفظ</button>' +
      "</div></div>" +
      (locLocked
        ? '<div class="mp-form-actions"><button type="button" class="mp-btn mp-btn--ghost" id="mpLocEdit">تعديل</button></div>'
        : "") +
      "</div>"
    );
  }

  function renderSettings() {
    var mode = state.posMode === "B" ? "B" : "A";
    return (
      '<h2 class="mp-section-title">الإعدادات</h2>' +
      '<p class="mp-section-sub">تشغيل الكاشير ووسائل الدفع</p>' +
      posSettingCardHtml() +
      '<div class="mp-card mp-form"><h3>نوع الكاشير</h3>' +
      '<div class="mp-store-tabs" role="radiogroup" aria-label="نوع الكاشير">' +
      '<label class="mp-pay-row"><input type="radio" name="mpPosMode" value="A"' +
      (mode === "A" ? " checked" : "") +
      " /> A — مرئي</label>" +
      '<label class="mp-pay-row"><input type="radio" name="mpPosMode" value="B"' +
      (mode === "B" ? " checked" : "") +
      " /> B — تجاري</label>" +
      '<label class="mp-pay-row"><input type="radio" name="mpPosMode" value="C" disabled /> C — متقدم / قريبًا</label>' +
      "</div></div>" +
      '<div class="mp-card mp-form">' +
      hubPaySelectHtml() +
      '<div class="mp-form-actions"><button type="button" class="mp-btn mp-btn--primary" id="mpSaveHub">حفظ وسائل الدفع</button></div></div>'
    );
  }

  function renderSection(id) {
    var section = canonicalSection(id);
    switch (section) {
      case "home":
      case "dashboard":
        return renderDashboard();
      case "orders":
        return renderOrders();
      case "store":
        return renderStore();
      case "products":
      case "categories":
      case "offers":
      case "store-admin":
        return renderStoreAdmin(storeAdminTab());
      case "employees":
        return renderCashiers();
      case "reviews":
        return renderReviews();
      case "visitor-preview":
        return renderStore();
      case "wallet":
      case "withdrawals":
        return renderWallet();
      case "pos":
        return renderPos();
      case "reports":
      case "expenses":
        return renderReports();
      case "notifications":
        return renderNotifications();
      case "settings":
        return renderSettings();
      default:
        return "";
    }
  }

  function renderMain() {
    snapshotProductEditorIfOpen();
    var main = shell ? shell.getMainEl() : null;
    if (!main) return;
    var sectionId = canonicalSection(shell ? shell.getActiveSection() : state.activeSection);
    state.activeSection = sectionId;
    if (sectionId !== "orders") closeOrderDetailModal();
    syncOrderLiveForSection();
    document.querySelectorAll(".mp-section").forEach(function (el) {
      el.classList.remove("is-active");
    });
    var section = document.getElementById("mpSection-" + sectionId);
    if (!section) {
      section = document.createElement("div");
      section.className = "mp-section is-active";
      section.id = "mpSection-" + sectionId;
      main.appendChild(section);
    } else {
      section.classList.add("is-active");
    }
    section.innerHTML = renderSection(sectionId);
    restoreProductEditorIfOpen();
    var catSel = document.getElementById("mpHubCategory");
    if (catSel) {
      var cur = String((state.store && state.store.category) || "").split(",")[0];
      if (cur) catSel.value = cur;
    }
    updateHeader();
    wireSectionEvents();
    if (sectionId === "pos" && global.ErvenowMerchantPos) {
      var posHost = document.getElementById("mpPosMount");
      if (posHost) {
        ErvenowMerchantPos.mount(posHost, {
          products: state.products || [],
          categories: (state.merchantCategories && state.merchantCategories.length
            ? state.merchantCategories.filter(function (c) { return c.is_active !== false; })
            : state.categories) || [],
          store: state.store || {},
          storeId: state.storeId,
          canManage: true,
          posMode: state.posMode === "B" ? "B" : "A",
        });
      }
    }
    paintIncomingChrome();
    if (sectionId === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("mpNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "merchant-notif", { enableTypeFilters: true });
    }
    lazyLoadSection(sectionId);
  }

  function lazyLoadSection(sectionId) {
    var sid = canonicalSection(sectionId);
    if ((sid === "orders" || sid === "home") && !sectionFresh("orders", 15000)) {
      loadOrderBoard().then(function () {
        if (activeCanonical() === sid) renderMain();
      });
    }
    if ((sid === "products" || sid === "pos") && !sectionFresh("products", 20000)) {
      loadProductsCatalog().then(function () {
        if (activeCanonical() === sid) renderMain();
      });
    }
    if ((sid === "products" || sid === "pos") && !sectionFresh("categories", 20000)) {
      loadMerchantCategories().then(function () {
        sectionCacheAt.categories = Date.now();
        if (activeCanonical() === sid) renderMain();
      });
    }
    if (sid === "employees" && !sectionFresh("cashiers", 20000)) {
      loadCashiers().then(function () {
        sectionCacheAt.cashiers = Date.now();
        if (activeCanonical() === "employees") renderMain();
      });
    }
    if (sid === "reports" && !sectionFresh("expenses", 20000)) {
      loadExpenses().then(function () {
        sectionCacheAt.expenses = Date.now();
        if (activeCanonical() === "reports") renderMain();
      });
    }
    if ((sid === "wallet" || sid === "withdrawals") && !sectionFresh("withdrawals", 20000)) {
      loadWithdrawals().then(function () {
        sectionCacheAt.withdrawals = Date.now();
        if (activeCanonical() === "wallet") renderMain();
      });
    }
    if ((sid === "store" || sid === "settings") && !sectionFresh("facilityCats", 60000)) {
      loadFacilityCategories().then(function () {
        sectionCacheAt.facilityCats = Date.now();
        if (activeCanonical() === sid) renderMain();
      });
    }
    if (sid === "settings" && !checkoutPlatformLoaded) {
      api("/api/core/checkout-payment-methods")
        .then(function (j) {
          checkoutPlatform = (j && j.methods) || j || {};
          checkoutPlatformLoaded = true;
          if (activeCanonical() === "settings") renderMain();
        })
        .catch(function () {});
    }
    if (sid === "reviews" && state.storeId && !sectionFresh("reviews", 20000)) {
      api("/api/store/reviews?store_id=" + encodeURIComponent(state.storeId) + "&limit=20")
        .then(function (j) {
          state.reviews = (j && j.reviews) || [];
          sectionCacheAt.reviews = Date.now();
          if (activeCanonical() === "reviews") renderMain();
        })
        .catch(function () {});
    }
  }

  function resetProductForm() {
    ["mpEditId", "mpPName", "mpPDesc", "mpPPrice", "mpPOffer", "mpPCategory", "mpPStock"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === "SELECT") el.value = "";
      else el.value = id === "mpEditId" ? "" : el.type === "number" ? "" : "";
    });
    var sortEl = document.getElementById("mpPSort");
    if (sortEl) sortEl.value = "0";
    var img = document.getElementById("mpPImage");
    if (img) img.value = "";
    var imgs = document.getElementById("mpPImages");
    if (imgs) imgs.value = "";
    var active = document.getElementById("mpPActive");
    if (active) active.checked = true;
    resetProductGallery();
    paintProductGallery();
    productEditorSnap = null;
  }

  function fillProductForm(p) {
    document.getElementById("mpEditId").value = p.id || "";
    document.getElementById("mpPName").value = p.name || "";
    document.getElementById("mpPDesc").value = p.description || "";
    document.getElementById("mpPPrice").value = p.price != null ? p.price : "";
    document.getElementById("mpPOffer").value =
      p.offer_price != null && Number(p.offer_price) > 0 ? p.offer_price : "";
    document.getElementById("mpPCategory").value = p.category ? String(p.category) : "";
    var stockEl = document.getElementById("mpPStock");
    if (stockEl) stockEl.value = p.stock != null ? p.stock : "";
    var sortEl = document.getElementById("mpPSort");
    if (sortEl) sortEl.value = p.sort_order != null && p.sort_order !== "" ? String(p.sort_order) : "0";
    var activeEl = document.getElementById("mpPActive");
    if (activeEl) activeEl.checked = p.active !== false;
    var img = document.getElementById("mpPImage");
    if (img) img.value = "";
    var imgs = document.getElementById("mpPImages");
    if (imgs) imgs.value = "";
    resetProductGallery();
    productGallery.slots = productImageUrlList(p).map(function (url) {
      return { kind: "url", url: url };
    });
    productGallery.dirty = false;
    paintProductGallery();
  }

  async function saveProduct() {
    if (!state.storeId) return;
    var editId = String(document.getElementById("mpEditId").value || "").trim();
    var body = {
      store_id: state.storeId,
      name: String(document.getElementById("mpPName").value || "").trim(),
      description: String(document.getElementById("mpPDesc").value || "").trim(),
      price: Number(document.getElementById("mpPPrice").value),
      category: String(document.getElementById("mpPCategory").value || "").trim() || null,
      sort_order: Number(document.getElementById("mpPSort") && document.getElementById("mpPSort").value) || 0,
    };
    var offer = document.getElementById("mpPOffer").value;
    if (offer !== "" && Number(offer) > 0) {
      var op = Number(offer);
      if (op >= body.price) {
        showMsg("سعر العرض يجب أن يكون أقل من السعر الأساسي", false);
        return;
      }
      body.offer_price = op;
    } else if (editId) {
      body.offer_price = null;
    }
    var stockEl = document.getElementById("mpPStock");
    if (stockEl && stockEl.value !== "") body.stock = Number(stockEl.value);
    else if (editId) body.stock = null;
    var activeEl = document.getElementById("mpPActive");
    if (activeEl) body.active = !!activeEl.checked;
    if (!body.name || !Number.isFinite(body.price)) {
      showMsg("اسم المنتج والسعر مطلوبان", false);
      return;
    }
    try {
      if (productGallery.dirty && productGallery.slots.length) {
        var b64s = [];
        var names = [];
        for (var gi = 0; gi < productGallery.slots.length; gi++) {
          var dataUrl = await gallerySlotToDataUrl(productGallery.slots[gi]);
          if (!dataUrl) continue;
          b64s.push(dataUrl);
          var slot = productGallery.slots[gi];
          names.push((slot.file && slot.file.name) || "product-" + (gi + 1) + ".jpg");
        }
        if (b64s.length) {
          body.images_base64 = b64s;
          body.images_file_names = names;
        }
      }
    } catch (ce) {
      showMsg(String(ce.message || ce), false);
      return;
    }
    try {
      if (editId) {
        await api("/api/store/products/" + encodeURIComponent(editId), { method: "PUT", body: body });
      } else {
        await api("/api/store/products", { method: "POST", body: body });
      }
      showMsg("تم حفظ المنتج", true);
      resetProductForm();
      var prod = await api(
        "/api/store/products?store_id=" + encodeURIComponent(state.storeId) + "&limit=80&offset=0"
      );
      state.products = prod.products || [];
      try {
        var ready = await api("/api/store/publish-readiness");
        state.publishReadiness = ready;
      } catch (_r) {}
      renderMain();
    } catch (e) {
      showMsg(e.message || String(e), false);
    }
  }

  function bindOrderActionButtons(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll(".mp-order-action").forEach(function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute("data-order-id");
        var st = btn.getAttribute("data-next-status");
        btn.disabled = true;
        try {
          if (st === "preparing") {
            await api("/api/order/" + encodeURIComponent(id) + "/action", {
              method: "POST",
              body: { action: "start_preparing" },
            });
          } else if (st === "ready") {
            await api("/api/order/" + encodeURIComponent(id) + "/action", {
              method: "POST",
              body: { action: "mark_ready" },
            });
          } else if (global.ErvenowMerchantOrderWorkflow) {
            await ErvenowMerchantOrderWorkflow.patchOrderStatus(id, st);
          } else {
            await api("/api/order/" + encodeURIComponent(id) + "/status", {
              method: "PATCH",
              body: { delivery_status: st },
            });
          }
          showMsg("تم تحديث الطلب", true);
          closeOrderDetailModal();
          await loadOrderBoard();
          noteFreshPlatformOrders();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
          btn.disabled = false;
        }
      };
    });
    scope.querySelectorAll(".mp-order-detail").forEach(function (btn) {
      btn.onclick = function () {
        showOrderDetailModal(findBoardOrder(btn.getAttribute("data-order-id")));
      };
    });
    scope.querySelectorAll(".mp-order-print").forEach(function (btn) {
      btn.onclick = function () {
        var o = findBoardOrder(btn.getAttribute("data-order-id"));
        var wf = global.ErvenowMerchantOrderWorkflow;
        if (o && wf && wf.printThermal80) wf.printThermal80(o, state.store || {});
      };
    });
    scope.querySelectorAll(".mp-order-driver").forEach(function (btn) {
      btn.onclick = function () {
        var o = findBoardOrder(btn.getAttribute("data-order-id"));
        showOrderDetailModal(o);
      };
    });
  }

  function wireSectionEvents() {
    var orderSearch = document.getElementById("mpOrderSearch");
    if (orderSearch) {
      orderSearch.oninput = function () {
        state.orderQuery = orderSearch.value || "";
        renderMain();
        var again = document.getElementById("mpOrderSearch");
        if (again) {
          again.focus();
          var end = again.value.length;
          try { again.setSelectionRange(end, end); } catch (_) {}
        }
      };
    }
    var orderDate = document.getElementById("mpOrderDate");
    if (orderDate) {
      orderDate.onchange = function () {
        state.orderDate = orderDate.value || "";
        loadOrderBoard().then(function () {
          renderMain();
        });
      };
    }
    var orderDateClear = document.getElementById("mpOrderDateClear");
    if (orderDateClear) {
      orderDateClear.onclick = function () {
        state.orderDate = "";
        loadOrderBoard().then(function () {
          renderMain();
        });
      };
    }
    document.querySelectorAll("[data-order-filter]").forEach(function (btn) {
      btn.onclick = function () {
        var next = btn.getAttribute("data-order-filter");
        state.orderFilter = state.orderFilter === next ? "active" : next;
        renderMain();
      };
    });
    bindOrderActionButtons(document);
    var expenseForm = document.getElementById("mpExpenseForm");
    if (expenseForm) {
      expenseForm.onsubmit = function (ev) {
        ev.preventDefault();
        var amountEl = document.getElementById("mpExpenseAmount");
        var itemEl = document.getElementById("mpExpenseItem");
        var noteEl = document.getElementById("mpExpenseNote");
        api("/api/store/expenses", {
          method: "POST",
          body: {
            amount: amountEl ? amountEl.value : "",
            item: itemEl ? itemEl.value : "",
            note: noteEl ? noteEl.value : "",
          },
        })
          .then(function () {
            showMsg("تم حفظ المصروف", true);
            return loadExpenses();
          })
          .then(function () {
            sectionCacheAt.expenses = Date.now();
            renderMain();
          })
          .catch(function (e) {
            showMsg((e && e.message) || "تعذر حفظ المصروف", false);
          });
      };
    }
    document.querySelectorAll(".mp-expense-del").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-expense-id");
        if (!id || !global.confirm("حذف هذا المصروف؟")) return;
        api("/api/store/expenses/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () {
            showMsg("تم حذف المصروف", true);
            return loadExpenses();
          })
          .then(function () {
            sectionCacheAt.expenses = Date.now();
            renderMain();
          })
          .catch(function (e) {
            showMsg((e && e.message) || "تعذر حذف المصروف", false);
          });
      };
    });
    document.querySelectorAll("[data-report-range]").forEach(function (btn) {
      btn.onclick = function () {
        state.reportRange = btn.getAttribute("data-report-range");
        renderMain();
      };
    });
    document.querySelectorAll("[data-pf-section]").forEach(function (btn) {
      if (btn.tagName === "BUTTON" && btn.getAttribute("data-pf-section")) {
        btn.onclick = function () {
          navigate(btn.getAttribute("data-pf-section"));
        };
      }
    });
    document.querySelectorAll('input[name="mpPosMode"]').forEach(function (input) {
      input.onchange = async function () {
        if (!input.checked || input.value === "C") return;
        try {
          var saved = await api("/api/store/pos-settings", { method: "PATCH", body: { pos_mode: input.value } });
          state.posMode = saved && saved.pos_mode === "B" ? "B" : "A";
          showMsg(state.posMode === "B" ? "الكاشير التجاري B" : "الكاشير المرئي A", true);
        } catch (e) {
          showMsg(e.message || String(e), false);
          renderMain();
        }
      };
    });
    var posToggle = document.getElementById("mpPosEnabled");
    if (posToggle) {
      posToggle.onchange = async function () {
        var enabled = !!posToggle.checked;
        posToggle.disabled = true;
        try {
          await api("/api/store/pos-settings", { method: "PATCH", body: { enabled: enabled } });
          state.posEnabled = enabled;
          showMsg(enabled ? "تم تفعيل كاشير ERVENOW" : "تم إخفاء الكاشير. طلبات المنصة مستمرة.", true);
          applyPosNav();
        } catch (e) {
          posToggle.checked = !enabled;
          state.posEnabled = !enabled;
          showMsg(e.message || String(e), false);
        } finally {
          posToggle.disabled = false;
        }
      };
    }
    var saveHub = document.getElementById("mpSaveHub");
    if (saveHub) {
      saveHub.onclick = async function () {
        if (!state.storeId) return;
        var bioEl = document.getElementById("mpHubBio");
        var body = {};
        if (bioEl) body.bio = String(bioEl.value || "").trim();
        var paySel = document.getElementById("mpHubPay");
        if (paySel) {
          var payBody = {};
          Array.prototype.forEach.call(paySel.options, function (opt) {
            payBody[opt.value] = !!opt.selected;
          });
          body.checkout_payment_methods = payBody;
        }
        var bannerEl = document.getElementById("mpHubBanner");
        var logoEl = document.getElementById("mpHubLogo");
        var bf = bannerEl && bannerEl.files && bannerEl.files[0];
        var lf = logoEl && logoEl.files && logoEl.files[0];
        try {
          if (bf && global.compressImageToDataUrl) {
            body.banner_base64 = await global.compressImageToDataUrl(bf, 0.72, 1600);
          }
          if (lf && global.compressImageToDataUrl) {
            body.logo_base64 = await global.compressImageToDataUrl(lf, 0.78, 800);
          }
          var catSel = document.getElementById("mpHubCategory");
          var catVal = catSel ? String(catSel.value || "").trim() : "";
          if (catVal) {
            if (String((state.store && state.store.type) || "").toLowerCase() === "restaurant") {
              body.restaurant_category = catVal;
            } else {
              body.category = catVal;
            }
          }
          await api("/api/store/merchant-hub", { method: "PATCH", body: body, timeoutMs: 60000 });
          showMsg("تم حفظ الإعدادات", true);
          var r = await api("/api/store/my-store");
          state.hub = r.merchant_hub || state.hub;
          state.store = r.store || state.store;
          state.publishReadiness = r.publish_readiness || state.publishReadiness;
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    }
    var saveLoc = document.getElementById("mpSaveStoreLoc");
    if (saveLoc) {
      saveLoc.onclick = async function () {
        if (!state.storeId) return;
        var raw = String(document.getElementById("mpStoreLoc").value || "").trim();
        if (!raw) return showMsg("أدخل رابط Maps أو lat,lng", false);
        var body = {};
        if (/^https?:\/\//i.test(raw) || /maps\.|goo\.gl|google\.com/i.test(raw)) body.maps_url = raw;
        else if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(raw)) {
          var parts = raw.split(",");
          body.lat = Number(parts[0].trim());
          body.lng = Number(parts[1].trim());
        } else body.maps_url = raw;
        try {
          await api("/api/store/location", { method: "PATCH", body: body, timeoutMs: 30000 });
          showMsg("تم حفظ الموقع", true);
          var r = await api("/api/store/my-store");
          state.store = r.store || state.store;
          state.publishReadiness = r.publish_readiness || state.publishReadiness;
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    }
    var gpsBtn = document.getElementById("mpStoreLocGps");
    if (gpsBtn && navigator.geolocation) {
      gpsBtn.onclick = function () {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            var inp = document.getElementById("mpStoreLoc");
            if (inp) inp.value = pos.coords.latitude + "," + pos.coords.longitude;
          },
          function () {
            showMsg("تعذر الوصول للموقع — فعّل GPS", false);
          },
          { enableHighAccuracy: true, timeout: 12000 }
        );
      };
    }
    var locEdit = document.getElementById("mpLocEdit");
    if (locEdit) {
      locEdit.onclick = function () {
        var editor = document.getElementById("mpLocEditor");
        if (editor) editor.hidden = false;
        var input = document.getElementById("mpStoreLoc");
        if (input) input.focus();
      };
    }
    var publishBtn = document.getElementById("mpPublishBtn");
    if (publishBtn) {
      publishBtn.onclick = async function () {
        var ready = state.publishReadiness || {};
        if (!ready.ok) {
          var missing = (ready.checks || [])
            .filter(function (c) {
              return !c.ok;
            })
            .map(function (c) {
              return c.label;
            });
          showMsg(missing.length ? "أكمل قبل النشر: " + missing.join("، ") : "أكمل بيانات المتجر ثم أعد المحاولة", false);
          return;
        }
        publishBtn.disabled = true;
        try {
          var j = await api("/api/store/publish", { method: "POST", body: {}, timeoutMs: 30000 });
          showMsg(j.message || "تم اعتماد ونشر المتجر", true);
          var r = await api("/api/store/my-store");
          state.store = r.store || state.store;
          state.hub = r.merchant_hub || state.hub;
          state.publishReadiness = r.publish_readiness || state.publishReadiness;
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
          publishBtn.disabled = false;
        }
      };
    }

    var saveBtn = document.getElementById("mpSaveProduct");
    if (saveBtn) saveBtn.onclick = saveProduct;
    var resetBtn = document.getElementById("mpResetProduct");
    if (resetBtn) resetBtn.onclick = resetProductForm;
    var mainImg = document.getElementById("mpPImage");
    if (mainImg) {
      mainImg.onchange = function () {
        addGalleryFiles(mainImg.files, true);
        mainImg.value = "";
      };
    }
    var extraImgs = document.getElementById("mpPImages");
    if (extraImgs) {
      extraImgs.onchange = function () {
        addGalleryFiles(extraImgs.files, false);
        extraImgs.value = "";
      };
    }
    if (document.getElementById("mpPGallery") && !productEditorSnap) paintProductGallery();
    document.querySelectorAll(".mp-prod-edit").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-id");
        var p = state.products.find(function (x) {
          return String(x.id) === String(id);
        });
        if (p) {
          fillProductForm(p);
          document.getElementById("mpProductForm").scrollIntoView({ behavior: "smooth" });
        }
      };
    });
    document.querySelectorAll(".mp-prod-del").forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm("إخفاء المنتج من المتجر؟")) return;
        try {
          await api("/api/store/products/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "DELETE",
          });
          showMsg("تم الإخفاء", true);
          var prod = await api(
            "/api/store/products?store_id=" + encodeURIComponent(state.storeId) + "&limit=80&offset=0"
          );
          state.products = prod.products || [];
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    });

    var saveCat = document.getElementById("mpSaveCategory");
    if (saveCat) {
      saveCat.onclick = async function () {
        if (!state.storeId) return;
        var editSlug = String(document.getElementById("mpCatEditSlug").value || "").trim();
        var slug = String(document.getElementById("mpCatSlug").value || "")
          .trim()
          .toLowerCase();
        var name = String(document.getElementById("mpCatName").value || "").trim();
        var icon = String(document.getElementById("mpCatIcon").value || "").trim();
        if (!slug || !name) {
          showMsg("المعرّف والاسم مطلوبان", false);
          return;
        }
        try {
          if (editSlug) {
            await api("/api/store/merchant-categories/" + encodeURIComponent(editSlug), {
              method: "PUT",
              body: { store_id: state.storeId, name_ar: name, icon: icon || null },
            });
          } else {
            await api("/api/store/merchant-categories", {
              method: "POST",
              body: { store_id: state.storeId, slug: slug, name_ar: name, icon: icon || null },
            });
          }
          showMsg("تم حفظ الفئة", true);
          await loadMerchantCategories();
          var cats = await api(
            "/api/store/product-category-options?store_id=" + encodeURIComponent(state.storeId)
          );
          state.categories = cats.options || cats.categories || [];
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    }
    var resetCat = document.getElementById("mpResetCategory");
    if (resetCat) {
      resetCat.onclick = function () {
        document.getElementById("mpCatEditSlug").value = "";
        document.getElementById("mpCatSlug").value = "";
        document.getElementById("mpCatName").value = "";
        document.getElementById("mpCatIcon").value = "";
        document.getElementById("mpCatSlug").disabled = false;
      };
    }
    document.querySelectorAll(".mp-cat-edit").forEach(function (btn) {
      btn.onclick = function () {
        var slug = btn.getAttribute("data-slug");
        var row = (state.merchantCategories || []).find(function (c) {
          return String(c.slug) === String(slug);
        });
        if (!row) return;
        document.getElementById("mpCatEditSlug").value = row.slug;
        document.getElementById("mpCatSlug").value = row.slug;
        document.getElementById("mpCatSlug").disabled = true;
        document.getElementById("mpCatName").value = row.label || "";
        document.getElementById("mpCatIcon").value = row.icon || "";
        document.getElementById("mpCatForm").scrollIntoView({ behavior: "smooth" });
      };
    });
    document.querySelectorAll(".mp-cat-del").forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm("حذف هذه الفئة؟")) return;
        try {
          await api(
            "/api/store/merchant-categories/" +
              encodeURIComponent(btn.getAttribute("data-slug")) +
              "?store_id=" +
              encodeURIComponent(state.storeId),
            { method: "DELETE" }
          );
          showMsg("تم الحذف", true);
          await loadMerchantCategories();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    });
    function reorderCategory(slug, dir) {
      var list = (state.merchantCategories || []).slice();
      var idx = list.findIndex(function (c) {
        return String(c.slug) === String(slug);
      });
      if (idx < 0) return null;
      var swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= list.length) return null;
      var tmp = list[idx];
      list[idx] = list[swap];
      list[swap] = tmp;
      return list.map(function (c, i) {
        return { slug: c.slug, sort_order: i };
      });
    }
    document.querySelectorAll(".mp-cat-up, .mp-cat-down").forEach(function (btn) {
      btn.onclick = async function () {
        var slug = btn.getAttribute("data-slug");
        var order = reorderCategory(slug, btn.classList.contains("mp-cat-up") ? "up" : "down");
        if (!order) return;
        try {
          await api("/api/store/merchant-categories/reorder", {
            method: "PATCH",
            body: { store_id: state.storeId, order: order },
          });
          await loadMerchantCategories();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    });

    document.querySelectorAll("[data-store-tab]").forEach(function (btn) {
      btn.onclick = function () {
        var tab = btn.getAttribute("data-store-tab") || "products";
        if (tab === "cashiers") {
          if (shell && shell.navigate) shell.navigate("employees");
          else renderMain();
          return;
        }
        try { sessionStorage.setItem("ervenow_store_admin_tab", tab); } catch (_) {}
        if (shell && shell.navigate) shell.navigate("products");
        else renderMain();
      };
    });
    var saveCashier = document.getElementById("mpSaveCashier");
    if (saveCashier) {
      saveCashier.onclick = async function () {
        try {
          await api("/api/store/cashiers", {
            method: "POST",
            body: {
              store_id: state.storeId,
              name: document.getElementById("mpCashierName").value,
              phone: document.getElementById("mpCashierPhone").value,
              branch_id: document.getElementById("mpCashierBranch").value,
            },
          });
          showMsg("تم حفظ الكاشير", true);
          await loadCashiers();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    }
    document.querySelectorAll("[data-cashier-toggle]").forEach(function (btn) {
      btn.onclick = async function () {
        try {
          await api("/api/store/cashiers/" + encodeURIComponent(btn.getAttribute("data-cashier-toggle")), {
            method: "PATCH",
            body: { store_id: state.storeId, active: btn.getAttribute("data-cashier-active") !== "1" },
          });
          await loadCashiers();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        }
      };
    });

    var submitWd = document.getElementById("mpSubmitWithdraw");
    if (submitWd) {
      submitWd.onclick = async function () {
        var amount = Number(document.getElementById("mpWithdrawAmount").value);
        var iban = String(document.getElementById("mpWithdrawIban").value || "").trim();
        if (!Number.isFinite(amount) || amount < 10) {
          showMsg("المبلغ يجب أن يكون 10 ريال أو أكثر", false);
          return;
        }
        if (!iban) {
          showMsg("الآيبان مطلوب", false);
          return;
        }
        submitWd.disabled = true;
        try {
          await api("/api/store/withdrawals", { method: "POST", body: { amount: amount, iban: iban } });
          showMsg("تم إرسال طلب السحب", true);
          document.getElementById("mpWithdrawAmount").value = "";
          document.getElementById("mpWithdrawIban").value = "";
          await loadWithdrawals();
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
        } finally {
          submitWd.disabled = false;
        }
      };
    }
  }

  function sectionFresh(key, ttl) {
    var at = sectionCacheAt[key] || 0;
    return at > 0 && Date.now() - at < ttl;
  }

  function navigate(section) {
    if (shell) shell.navigate(section);
  }

  function paintBootStatus(text) {
    var main = shell && shell.getMainEl ? shell.getMainEl() : null;
    if (!main || state.store) return;
    main.innerHTML = '<p class="mp-section-sub" style="padding:16px">' + esc(text) + "</p>";
  }

  async function boot() {
    paintBootStatus("جارٍ فتح لوحة المتجر…");
    try {
      await loadCoreData();
      seedSeenOrders();
      ensureIncomingHost();
      if (state.posEnabled === false && canonicalSection(shell && shell.getActiveSection()) === "pos") {
        shell.navigate("home");
      } else {
        renderMain();
      }
      if (shell) {
        shell.mountNotifications().then(function (apiNotif) {
          notifCenterApi = apiNotif;
          paintIncomingChrome();
        }).catch(function () {});
      }
    } catch (e) {
      showMsg(e.message || "تعذّر تحميل البيانات", false);
    }
  }

  async function init() {
    var bootHash = (global.location.hash || "").replace(/^#/, "");
    if (bootHash === "complete") {
      try {
        global.history.replaceState(null, "", currentPortalPath() + "#settings");
      } catch (_) {}
    }
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      showMsg("Portal Framework غير محمّل", false);
      return;
    }
    var baseCfg = ErvenowPortalFramework.RoleContext.getConfig("merchant");
    var cfgPromise =
      ErvenowPortalFramework.PortalPlatformModules
        ? ErvenowPortalFramework.PortalPlatformModules.filterConfig(baseCfg)
        : Promise.resolve(baseCfg);
    var mePromise = global.ErvenowAuthGuard
      ? ErvenowAuthGuard.ensureApprovedAccount({ loginUrl: "/login?role=store" })
      : Promise.resolve(null);
    var portalCfg = await cfgPromise;
    if (!shell) {
      shell = ErvenowPortalFramework.PortalShell.create({
        role: "merchant",
        config: portalCfg,
        app: "#mpApp",
        loginEl: "#mpLogin",
        hashBase: currentPortalPath(),
        homeHref: OFFICIAL_PORTAL_PATH + "#home",
        walletHref: OFFICIAL_PORTAL_PATH + "#wallet",
        notifKey: "merchant-portal-header",
        operationalV2: true,
        portalTitle: "بوابة المتجر",
        showBottomNav: false,
        onNavigate: function (section) {
          state.activeSection = section;
          renderMain();
        },
      });
      W = shell.getWidgets();
      shell.mountChrome();
      shell.mountNotifications();
      global.addEventListener("ervenow:provider-location-updated", function (ev) {
        var d = (ev && ev.detail) || {};
        var store = d.response && d.response.store;
        if (store) state.store = store;
        updateHeader();
      });
    }

    if (!global.ErvenowAuthGuard) {
      shell.showLogin();
      return;
    }
    var me = await mePromise;
    if (!me) {
      shell.showLogin();
      return;
    }
    var role = String((me.profile && me.profile.role) || "").toLowerCase();
    if (role !== "store" && role !== "merchant" && role !== "restaurant" && role !== "admin") {
      showMsg("هذه المعاينة للتجار فقط. سجّل دخولك كمتجر.", false);
      shell.showLogin();
      return;
    }
    shell.showApp();
    await boot();
  }

  global.ErvenowMerchantPreview = {
    init: init,
    navigate: navigate,
    stop: stopOrderBoardLive,
    refreshOrders: refreshOrderBoardLive,
    showMsg: showMsg,
  };
})(typeof window !== "undefined" ? window : global);
