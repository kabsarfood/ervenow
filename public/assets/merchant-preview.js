/**
 * ERVENOW — Merchant Portal Preview (experimental unified portal)
 * Uses existing APIs only — no backend changes.
 */
(function (global) {
  "use strict";

  var shell = null;
  var W = null;
  var boardSocket = null;
  var boardRefreshTimer = null;
  var boardPollTimer = null;
  var notifCenterApi = null;
  var BOARD_POLL_MS = 8000;

  var state = {
    storeId: null,
    store: null,
    hub: null,
    dashboard: null,
    board: null,
    products: [],
    categories: [],
    merchantCategories: [],
    withdrawals: [],
    withdrawalMeta: { balance: 0, available: 0, pending_reserved: 0, total_withdrawn: 0 },
    reviews: [],
    activeSection: "dashboard",
    orderFilter: "new",
    reportRange: "today",
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

  async function loadOrderBoard() {
    try {
      state.board = await api("/api/store/order-board");
    } catch (_) {
      state.board = state.board || { orders: [], status_counts: {} };
    }
  }

  function storeIdFromSocketMsg(msg) {
    if (!msg) return null;
    if (msg.store_id != null) return msg.store_id;
    if (msg.patch && msg.patch.store_id != null) return msg.patch.store_id;
    return null;
  }

  function orderSectionsNeedRefresh() {
    var section = shell ? shell.getActiveSection() : state.activeSection;
    return section === "dashboard" || section === "orders";
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
    if (orderSectionsNeedRefresh()) renderMain();
  }

  function disconnectOrderBoardSocket() {
    if (boardSocket) {
      try {
        boardSocket.disconnect();
      } catch (_) {}
      boardSocket = null;
    }
  }

  function connectOrderBoardSocket() {
    if (boardSocket || typeof global.io === "undefined") return;
    if (!state.storeId) return;
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

  function startOrderBoardPolling() {
    stopOrderBoardPolling();
    boardPollTimer = setInterval(function () {
      refreshOrderBoardLive().catch(function () {});
    }, BOARD_POLL_MS);
  }

  function stopOrderBoardPolling() {
    if (boardPollTimer) {
      clearInterval(boardPollTimer);
      boardPollTimer = null;
    }
  }

  function startOrderBoardLive() {
    connectOrderBoardSocket();
    startOrderBoardPolling();
  }

  function stopOrderBoardLive() {
    if (boardRefreshTimer) {
      clearTimeout(boardRefreshTimer);
      boardRefreshTimer = null;
    }
    stopOrderBoardPolling();
    disconnectOrderBoardSocket();
  }

  async function loadCoreData() {
    var my = await api("/api/store/my-store");
    state.store = my.store || my;
    state.hub = my.merchant_hub || null;
    state.storeId = state.store && state.store.id;
    var dash = await api("/api/store/merchant-dashboard");
    state.dashboard = dash;
    try {
      state.board = await api("/api/store/order-board");
    } catch (_) {
      state.board = { orders: dash.orders || [], status_counts: {} };
    }
    if (state.storeId) connectOrderBoardSocket();
    if (state.storeId) {
      var prod = await api(
        "/api/store/products?store_id=" + encodeURIComponent(state.storeId) + "&limit=80&offset=0"
      );
      state.products = prod.products || [];
      try {
        var cats = await api(
          "/api/store/product-category-options?store_id=" + encodeURIComponent(state.storeId)
        );
        state.categories = cats.options || cats.categories || [];
      } catch (_c) {
        state.categories = [];
      }
    }
    updateHeader();
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
    var statusHtml =
      '<span class="pf-status-pill' +
      (active ? "" : " is-paused") +
      '"><span aria-hidden="true">' +
      (active ? "🟢" : "⏸") +
      "</span><span>" +
      (active ? "نشط" : "موقوف") +
      "</span></span>";
    shell.updateHeader({
      subtitle: name,
      sidebarName: name,
      toolsHtml: statusHtml,
    });
    if (global.ErvenowPortalProviderLocation) {
      ErvenowPortalProviderLocation.syncButtonLabel(state.store);
    }
  }

  function ordersList() {
    var orders = (state.board && state.board.orders) || (state.dashboard && state.dashboard.orders) || [];
    return orders.filter(function (o) {
      var st = o.board_status || o.delivery_status;
      return inOrderGroup(st, state.orderFilter);
    });
  }

  function countOrdersInGroup(group) {
    var orders = (state.board && state.board.orders) || (state.dashboard && state.dashboard.orders) || [];
    return orders.filter(function (o) {
      return inOrderGroup(o.board_status || o.delivery_status, group);
    }).length;
  }

  function todayOrders() {
    var orders = (state.dashboard && state.dashboard.orders) || [];
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
      (W ? W.sectionHeader("لوحة التحكم", "Dashboard — نظرة سريعة على أداء منشأتك اليوم") : "") +
      (W
        ? W.kpiGrid([
            { label: "📦 طلبات اليوم", value: String(today.length) },
            { label: "💰 مبيعات اليوم", value: fmtMoney(todaySales), suffix: "ر.س" },
            { label: "💳 الرصيد", value: fmtMoney(wallet.balance), suffix: "ر.س" },
            {
              label: "⭐ التقييم",
              value: store.average_rating != null ? Number(store.average_rating).toFixed(1) : "—",
            },
            { label: "🛍 المنتجات", value: String(agg.products_active_count || state.products.length || 0) },
            { label: "🔥 الطلبات النشطة", value: String(active) },
          ])
        : "") +
      '<div class="mp-card"><h3>اختصارات</h3><div class="mp-classic-links">' +
      '<button type="button" class="mp-btn mp-btn--primary" data-pf-section="orders">الطلبات</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="products">المنتجات</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="withdrawals">السحب</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pf-section="settings">الإعدادات</button>' +
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

  function renderOrders() {
    var wf = global.ErvenowMerchantOrderWorkflow;
    var rows = ordersList();
    var tabs = [
      { key: "new", label: "جديدة" },
      { key: "preparing", label: "قيد التجهيز" },
      { key: "ready", label: "الجاهزة" },
      { key: "done", label: "المكتملة" },
    ];
    var tabsHtml = tabs
      .map(function (t) {
        return (
          '<button type="button" class="mp-tab' +
          (state.orderFilter === t.key ? " is-active" : "") +
          '" data-order-filter="' +
          t.key +
          '">' +
          esc(t.label) +
          '<span class="mp-tab__count">(' +
          countOrdersInGroup(t.key) +
          ")</span></button>"
        );
      })
      .join("");

    var tableRows = rows.length
      ? rows
          .map(function (o) {
            var st = normalizeStatus(o.board_status || o.delivery_status);
            var pill = wf && wf.pillHtml ? wf.pillHtml(st) : '<span class="mp-pill">' + esc(st) + "</span>";
            var next = wf && wf.nextActionFor ? wf.nextActionFor(st) : null;
            var actionBtn = next
              ? '<button type="button" class="mp-btn mp-btn--primary mp-order-action" data-order-id="' +
                esc(o.id) +
                '" data-next-status="' +
                esc(next.status) +
                '">' +
                esc(next.label) +
                "</button>"
              : "—";
            var tools =
              '<button type="button" class="mp-btn mp-btn--ghost mp-order-detail" data-order-id="' +
              esc(o.id) +
              '">تفاصيل</button>';
            if (st === "ready" || st === "preparing" || st === "accepted") {
              tools +=
                ' <button type="button" class="mp-btn mp-btn--ghost mp-order-print" data-order-id="' +
                esc(o.id) +
                '">طباعة</button>';
            }
            if (st === "picked_up" || st === "delivering") {
              tools +=
                ' <a class="mp-btn mp-btn--ghost" href="/track?id=' +
                encodeURIComponent(o.id) +
                '" target="_blank" rel="noopener">تتبع</a>';
            }
            return (
              "<tr><td>" +
              fmtDate(o.created_at) +
              "</td><td>" +
              esc(o.order_number || o.id) +
              "</td><td>" +
              pill +
              "</td><td>" +
              esc(wf && wf.paymentLabel ? wf.paymentLabel(o.payment_status) : o.payment_status || "—") +
              "</td><td>" +
              fmtMoney(o.total || o.order_total) +
              "</td><td>" +
              actionBtn +
              "</td><td>" +
              tools +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="mp-empty">لا طلبات في هذا القسم</td></tr>';

    return (
      '<h2 class="mp-section-title">الطلبات</h2>' +
      '<p class="mp-section-sub">Orders — إدارة دورة الطلب من البوابة</p>' +
      '<div class="mp-tabs" role="tablist">' +
      tabsHtml +
      "</div>" +
      '<div class="mp-card mp-table-wrap"><table class="mp-table"><thead><tr>' +
      "<th>التاريخ</th><th>الطلب</th><th>الحالة</th><th>الدفع</th><th>الإجمالي</th><th>إجراء</th><th>أدوات</th>" +
      "</tr></thead><tbody>" +
      tableRows +
      "</tbody></table></div>"
    );
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
    return (
      '<article class="mp-product-card">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" />' : '<div style="aspect-ratio:1;background:#f5ebe0"></div>') +
      '<div class="mp-product-card__body"><p class="mp-product-card__name">' +
      esc(p.name) +
      '</p><p class="mp-product-card__price">' +
      priceHtml +
      "</p>" +
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
      "<label>القسم</label><select id='mpPCategory'><option value=''>— بدون —</option>" +
      catOpts +
      "</select>" +
      "<label>المخزون (اختياري)</label><input id='mpPStock' type='number' min='0' step='1' />" +
      "<label><input id='mpPActive' type='checkbox' checked /> متاح للبيع</label>" +
      "<label>صورة المنتج</label><input id='mpPImage' type='file' accept='image/*' />" +
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
    var href = state.storeId ? "/store.html?store_id=" + encodeURIComponent(state.storeId) + "&preview=1" : "#";
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
      '<div class="mp-classic-links">' +
      '<button type="button" class="mp-btn mp-btn--primary" data-pf-section="withdrawals">طلب سحب</button>' +
      "</div>"
    );
  }

  function renderPos() {
    return (
      '<h2 class="mp-section-title">الكاشير</h2>' +
      '<p class="mp-section-sub">POS</p>' +
      '<div class="mp-pos-placeholder">' +
      "<h2>ERVENOW POS Core</h2>" +
      "<p>Coming Soon</p>" +
      "</div>"
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

    return (
      '<h2 class="mp-section-title">التقارير</h2>' +
      '<p class="mp-section-sub">Reports — من بيانات الطلبات المتاحة</p>' +
      '<div class="mp-tabs">' +
      tabs +
      "</div>" +
      '<div class="mp-kpi-grid">' +
      kpiCard("عدد الطلبات", String(filtered.length)) +
      kpiCard("إجمالي المبيعات", fmtMoney(sales) + " ر.س") +
      kpiCard("متوسط السلة", filtered.length ? fmtMoney(sales / filtered.length) + " ر.س" : "—") +
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
      "</tbody></table></div></div>"
    );
  }

  function platformCheckoutAllows(key) {
    if (!checkoutPlatform || typeof checkoutPlatform !== "object") return true;
    if (Object.prototype.hasOwnProperty.call(checkoutPlatform, key)) return !!checkoutPlatform[key];
    return true;
  }

  function hubPayCheckboxesHtml() {
    var hm =
      state.hub && state.hub.checkout_payment_methods && typeof state.hub.checkout_payment_methods === "object"
        ? state.hub.checkout_payment_methods
        : {};
    return HUB_PAY_ROWS.map(function (row) {
      var allowed = platformCheckoutAllows(row.key);
      var checked = hm[row.key] !== false;
      return (
        '<label class="mp-pay-row">' +
        '<input type="checkbox" id="mpHubPay_' +
        row.key +
        '"' +
        (checked ? " checked" : "") +
        (allowed ? "" : " disabled") +
        " /> " +
        esc(row.label) +
        "</label>"
      );
    }).join("");
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

  function showOrderDetailModal(order) {
    if (!order) return;
    var wf = global.ErvenowMerchantOrderWorkflow;
    var items = wf && wf.itemsFromBreakdown ? wf.itemsFromBreakdown(order) : [];
    var itemsHtml = items.length
      ? "<ul>" +
        items
          .map(function (it) {
            return (
              "<li>" +
              esc(it.name || it.title || it.product_name || "صنف") +
              " × " +
              (Number(it.qty || it.quantity) || 1) +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "";
    var driver = order.driver;
    var existing = document.getElementById("mpOrderModal");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "mpOrderModal";
    el.className = "mp-modal";
    el.innerHTML =
      '<div class="mp-modal__backdrop"></div><div class="mp-modal__box" role="dialog">' +
      '<button type="button" class="mp-modal__close" id="mpOrderModalClose" aria-label="إغلاق">×</button>' +
      "<h3>طلب " +
      esc(order.order_number || order.id) +
      "</h3>" +
      "<p><strong>العضو:</strong> " +
      esc(order.customer_name || "—") +
      "</p>" +
      "<p><strong>الجوال:</strong> " +
      esc(order.customer_phone || "—") +
      "</p>" +
      "<p><strong>العنوان:</strong> " +
      esc(order.drop_address || order.delivery_address || "—") +
      "</p>" +
      itemsHtml +
      (driver
        ? "<p><strong>المندوب:</strong> " + esc(driver.name || "—") + " · " + esc(driver.phone || "—") + "</p>"
        : "<p><strong>المندوب:</strong> لم يُعيَّن بعد</p>") +
      "<p><strong>قيمة الطلب:</strong> " +
      fmtMoney(order.order_value != null ? order.order_value : order.total || order.order_total) +
      " ر.س</p>" +
      "<p><strong>صافي المتجر:</strong> " +
      fmtMoney(order.store_net != null ? order.store_net : order.total || order.order_total) +
      " ر.س</p>" +
      "</div>";
    document.body.appendChild(el);
    function close() {
      el.remove();
    }
    el.querySelector(".mp-modal__backdrop").onclick = close;
    document.getElementById("mpOrderModalClose").onclick = close;
  }

  function renderSettings() {
    var hub = state.hub || {};
    var store = state.store || {};
    return (
      '<h2 class="mp-section-title">الإعدادات</h2>' +
      '<p class="mp-section-sub">Settings — إدارة المنشأة من البوابة</p>' +
      '<div class="mp-card mp-form"><h3>الهوية والبروفايل</h3>' +
      "<p><strong>الاسم:</strong> " +
      esc(store.name || store.store_name) +
      "</p>" +
      "<label for='mpHubBio'>الوصف</label>" +
      "<textarea id='mpHubBio' rows='3'>" +
      esc(hub.bio || store.bio || "") +
      "</textarea>" +
      "<label for='mpHubLogo'>الشعار (صورة)</label>" +
      "<input id='mpHubLogo' type='file' accept='image/*' />" +
      "<label for='mpHubBanner'>الغلاف (صورة)</label>" +
      "<input id='mpHubBanner' type='file' accept='image/*' />" +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSaveHub">حفظ الهوية</button></div>' +
      '<div class="mp-card mp-form"><h3>الموقع</h3>' +
      "<p><strong>العنوان الحالي:</strong> " +
      esc(store.address || store.location_text || store.location || "—") +
      "</p>" +
      "<label for='mpStoreLoc'>رابط Google Maps أو lat,lng</label>" +
      "<input id='mpStoreLoc' type='text' placeholder='https://maps.google.com/... أو 24.7,46.6' />" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button type="button" class="mp-btn mp-btn--ghost" id="mpStoreLocGps">موقعي الحالي (GPS)</button>' +
      '<button type="button" class="mp-btn mp-btn--primary" id="mpSaveStoreLoc">حفظ الموقع</button>' +
      "</div></div>" +
      '<div class="mp-card mp-form"><h3>وسائل الدفع (ERVENOW PAY)</h3>' +
      '<div id="mpHubPayGrid">' +
      hubPayCheckboxesHtml() +
      "</div>" +
      '<p class="mp-section-sub">يُحفظ مع الهوية أعلاه.</p></div>'
    );
  }

  function renderSection(id) {
    switch (id) {
      case "dashboard":
        return renderDashboard();
      case "orders":
        return renderOrders();
      case "products":
        return renderProducts();
      case "categories":
        return renderCategories();
      case "offers":
        return renderOffers();
      case "reviews":
        return renderReviews();
      case "visitor-preview":
        return renderVisitorPreview();
      case "wallet":
        return renderWallet();
      case "withdrawals":
        return renderWithdrawals();
      case "pos":
        return renderPos();
      case "reports":
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
    var main = shell ? shell.getMainEl() : null;
    if (!main) return;
    var sectionId = shell ? shell.getActiveSection() : state.activeSection;
    state.activeSection = sectionId;
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
    if (shell) shell.renderNav();
    updateHeader();
    wireSectionEvents();
    if (sectionId === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("mpNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "merchant-notif", { enableTypeFilters: true });
    }
    if (sectionId === "categories") {
      loadMerchantCategories().then(function () {
        var sec = document.getElementById("mpSection-categories");
        if (sec) {
          sec.innerHTML = renderCategories();
          wireSectionEvents();
        }
      });
    }
    if (sectionId === "withdrawals") {
      loadWithdrawals().then(function () {
        var sec = document.getElementById("mpSection-withdrawals");
        if (sec) {
          sec.innerHTML = renderWithdrawals();
          wireSectionEvents();
        }
      });
    }
    if (sectionId === "settings") {
      api("/api/core/checkout-payment-methods")
        .then(function (j) {
          checkoutPlatform = (j && j.methods) || j || {};
          var sec = document.getElementById("mpSection-settings");
          if (sec) {
            sec.innerHTML = renderSettings();
            wireSectionEvents();
          }
        })
        .catch(function () {});
    }
    if (sectionId === "reviews" && state.storeId) {
      api("/api/store/reviews?store_id=" + encodeURIComponent(state.storeId) + "&limit=20")
        .then(function (j) {
          state.reviews = (j && j.reviews) || [];
          var sec = document.getElementById("mpSection-reviews");
          if (sec) {
            sec.innerHTML = renderReviews();
            wireSectionEvents();
          }
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
    var img = document.getElementById("mpPImage");
    if (img) img.value = "";
    var active = document.getElementById("mpPActive");
    if (active) active.checked = true;
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
    var activeEl = document.getElementById("mpPActive");
    if (activeEl) activeEl.checked = p.active !== false;
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
    };
    var offer = document.getElementById("mpPOffer").value;
    if (offer !== "" && Number(offer) > 0) body.offer_price = Number(offer);
    else body.offer_price = null;
    var stockEl = document.getElementById("mpPStock");
    if (stockEl && stockEl.value !== "") body.stock = Number(stockEl.value);
    var activeEl = document.getElementById("mpPActive");
    if (activeEl) body.active = !!activeEl.checked;
    var imgInput = document.getElementById("mpPImage");
    if (imgInput && imgInput.files && imgInput.files[0] && global.compressImageToDataUrl) {
      body.image_base64 = await global.compressImageToDataUrl(imgInput.files[0], 0.78, 1200);
      body.image_file_name = imgInput.files[0].name || "product.jpg";
    }
    if (!body.name || !Number.isFinite(body.price)) {
      showMsg("اسم المنتج والسعر مطلوبان", false);
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
      renderMain();
    } catch (e) {
      showMsg(e.message || String(e), false);
    }
  }

  function wireSectionEvents() {
    document.querySelectorAll("[data-order-filter]").forEach(function (btn) {
      btn.onclick = function () {
        state.orderFilter = btn.getAttribute("data-order-filter");
        renderMain();
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
    document.querySelectorAll(".mp-order-action").forEach(function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute("data-order-id");
        var st = btn.getAttribute("data-next-status");
        btn.disabled = true;
        try {
          if (global.ErvenowMerchantOrderWorkflow) {
            await ErvenowMerchantOrderWorkflow.patchOrderStatus(id, st);
          } else {
            await api("/api/order/" + encodeURIComponent(id) + "/status", {
              method: "PATCH",
              body: { delivery_status: st },
            });
          }
          showMsg("تم تحديث الطلب", true);
          state.board = await api("/api/store/order-board");
          state.dashboard = await api("/api/store/merchant-dashboard");
          renderMain();
        } catch (e) {
          showMsg(e.message || String(e), false);
          btn.disabled = false;
        }
      };
    });
    document.querySelectorAll(".mp-order-detail").forEach(function (btn) {
      btn.onclick = function () {
        showOrderDetailModal(findBoardOrder(btn.getAttribute("data-order-id")));
      };
    });
    document.querySelectorAll(".mp-order-print").forEach(function (btn) {
      btn.onclick = function () {
        var o = findBoardOrder(btn.getAttribute("data-order-id"));
        var wf = global.ErvenowMerchantOrderWorkflow;
        if (o && wf && wf.printThermal80) wf.printThermal80(o, state.store || {});
      };
    });
    var saveHub = document.getElementById("mpSaveHub");
    if (saveHub) {
      saveHub.onclick = async function () {
        if (!state.storeId) return;
        var body = { bio: String(document.getElementById("mpHubBio").value || "").trim() };
        var payBody = {};
        HUB_PAY_ROWS.forEach(function (row) {
          var cb = document.getElementById("mpHubPay_" + row.key);
          if (!cb) return;
          payBody[row.key] = cb.disabled ? false : !!cb.checked;
        });
        body.checkout_payment_methods = payBody;
        var bf = document.getElementById("mpHubBanner").files && document.getElementById("mpHubBanner").files[0];
        var lf = document.getElementById("mpHubLogo").files && document.getElementById("mpHubLogo").files[0];
        try {
          if (bf && global.compressImageToDataUrl) {
            body.banner_base64 = await global.compressImageToDataUrl(bf, 0.72, 1600);
          }
          if (lf && global.compressImageToDataUrl) {
            body.logo_base64 = await global.compressImageToDataUrl(lf, 0.78, 800);
          }
          await api("/api/store/merchant-hub", { method: "PATCH", body: body });
          showMsg("تم حفظ الإعدادات", true);
          var r = await api("/api/store/my-store");
          state.hub = r.merchant_hub || state.hub;
          state.store = r.store || state.store;
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
          await api("/api/store/location", { method: "PATCH", body: body });
          showMsg("تم حفظ الموقع", true);
          var r = await api("/api/store/my-store");
          state.store = r.store || state.store;
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

    var saveBtn = document.getElementById("mpSaveProduct");
    if (saveBtn) saveBtn.onclick = saveProduct;
    var resetBtn = document.getElementById("mpResetProduct");
    if (resetBtn) resetBtn.onclick = resetProductForm;
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

  function navigate(section) {
    if (shell) shell.navigate(section);
  }

  async function boot() {
    try {
      await loadCoreData();
      await loadMerchantCategories();
      renderMain();
      notifCenterApi = await shell.mountNotifications();
      startOrderBoardLive();
    } catch (e) {
      showMsg(e.message || "تعذّر تحميل البيانات", false);
    }
  }

  async function init() {
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      showMsg("Portal Framework غير محمّل", false);
      return;
    }
    var portalCfg = ErvenowPortalFramework.RoleContext.getConfig("merchant");
    if (ErvenowPortalFramework.PortalPlatformModules) {
      portalCfg = await ErvenowPortalFramework.PortalPlatformModules.filterConfig(portalCfg);
    }
    if (!shell) {
      shell = ErvenowPortalFramework.PortalShell.create({
        role: "merchant",
        config: portalCfg,
        app: "#mpApp",
        loginEl: "#mpLogin",
        hashBase: "/merchant-preview",
        notifKey: "merchant-preview-header",
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
    var me = await ErvenowAuthGuard.ensureApprovedAccount({ loginUrl: "/login?role=store" });
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
  };
})(typeof window !== "undefined" ? window : global);
