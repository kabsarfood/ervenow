/**
 * ERVENOW — Customer Portal Preview
 * Built on Portal Framework v1 — existing APIs only.
 */
(function (global) {
  "use strict";

  var shell = null;
  var W = null;

  var state = {
    me: null,
    orders: [],
    wallet: null,
    transactions: [],
    offers: [],
    unreadCount: 0,
    ordersTab: "open",
    locationLabel: "لم يُحدَّد بعد",
    accountOk: false,
    walletOk: false,
    notifOk: false,
  };

  var HUB_LINKS = [
    { icon: "🍽️", label: "مطاعم", href: "/restaurants" },
    { icon: "🏪", label: "متاجر", href: "/stores" },
    { icon: "🛠️", label: "خدمات", href: "/services" },
    { icon: "🚚", label: "توصيل", href: "/delivery-services.html" },
    { icon: "🔥", label: "العروض", href: "/start-now.html#offers" },
  ];

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

  function customerName() {
    var u = (state.me && state.me.user) || {};
    var p = (state.me && state.me.profile) || {};
    return p.name || u.name || p.phone || u.phone || "عضو ERVENOW";
  }

  function customerInitials() {
    var n = customerName();
    var parts = n.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] || "") + (parts[1][0] || "");
    return n.slice(0, 2);
  }

  function orderStatusKey(o) {
    return String((o && o.delivery_status) || (o && o.status) || "")
      .toLowerCase()
      .trim();
  }

  function orderFinanceStatus(o) {
    return String((o && o.status) || "")
      .toLowerCase()
      .trim();
  }

  function isCancelledOrder(o) {
    var ds = orderStatusKey(o);
    var st = orderFinanceStatus(o);
    if (/cancel/.test(ds) || /cancel/.test(st)) return true;
    return (
      ds === "cancelled_by_customer" ||
      ds === "canceled_by_customer" ||
      st === "cancelled" ||
      st === "canceled"
    );
  }

  function isDeliveredOrder(o) {
    var ds = orderStatusKey(o);
    return ds === "delivered" || ds === "completed" || ds === "closed";
  }

  function orderStatusMeta(o) {
    if (isCancelledOrder(o)) return { label: "ملغى", cls: "pf-badge--wait", bucket: "closed" };
    if (isDeliveredOrder(o)) return { label: "تم التسليم", cls: "pf-badge--done", bucket: "closed" };
    var ds = orderStatusKey(o);
    if (o.driver_id && (ds === "accepted" || ds === "picked" || ds === "delivering")) {
      return { label: "قيد التوصيل", cls: "", bucket: "open" };
    }
    if (!o.driver_id && (ds === "new" || ds === "pending" || ds === "draft")) {
      return { label: "بانتظار مندوب", cls: "pf-badge--wait", bucket: "open" };
    }
    return { label: ds || "قيد المعالجة", cls: "", bucket: "open" };
  }

  function isOrderClosed(o) {
    return orderStatusMeta(o).bucket === "closed";
  }

  function orderSortTime(o) {
    var t = (o && (o.updated_at || o.created_at)) || "";
    var n = Date.parse(t);
    return Number.isFinite(n) ? n : 0;
  }

  function splitOrders(orders) {
    var open = [];
    var closed = [];
    (orders || []).forEach(function (o) {
      if (isOrderClosed(o)) closed.push(o);
      else open.push(o);
    });
    open.sort(function (a, b) {
      return orderSortTime(b) - orderSortTime(a);
    });
    closed.sort(function (a, b) {
      return orderSortTime(b) - orderSortTime(a);
    });
    return { open: open, closed: closed };
  }

  function readDraftLocation() {
    try {
      var raw = global.localStorage && global.localStorage.getItem("ervenow:order-draft");
      if (!raw) return null;
      var draft = JSON.parse(raw);
      var loc = draft && draft.customer_location;
      if (!loc) return null;
      var addr = String(loc.address || loc.label || "").trim();
      if (addr) return addr;
      if (Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
        return Number(loc.lat).toFixed(4) + "، " + Number(loc.lng).toFixed(4);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function resolveLocationLabel() {
    var draft = readDraftLocation();
    if (draft) return draft;
    for (var i = 0; i < (state.orders || []).length; i++) {
      var o = state.orders[i];
      var drop = String((o && (o.drop_address || o.customer_address)) || "").trim();
      if (drop) return drop;
    }
    return "لم يُحدَّد بعد";
  }

  function collectAddresses() {
    var list = [];
    var seen = {};
    function add(label, source) {
      var key = String(label || "").trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      list.push({ label: key, source: source });
    }
    var draft = readDraftLocation();
    if (draft) add(draft, "الموقع الحالي (مسودة الطلب)");
    (state.orders || []).forEach(function (o) {
      add(o.drop_address, "عنوان توصيل سابق");
      add(o.customer_address, "عنوان سابق");
      add(o.pickup_address, "عنوان استلام سابق");
    });
    return list;
  }

  function renderOrderCard(o, compact) {
    var meta = orderStatusMeta(o);
    var num = o.order_number || o.id || "—";
    var total = o.total_with_vat != null ? o.total_with_vat : o.order_total || o.total_amount;
    var trackId = o.id || o.order_number;
    return (
      '<article class="pf-order-card">' +
      '<div class="pf-order-card__top"><strong>#' +
      esc(num) +
      '</strong><span class="pf-badge ' +
      esc(meta.cls) +
      '">' +
      esc(meta.label) +
      "</span></div>" +
      '<p style="margin:0 0 6px;font-size:0.82rem;color:var(--pf-muted);font-weight:700">' +
      esc(fmtDate(o.created_at)) +
      (total != null ? " · " + esc(fmtMoney(total)) + " ر.س" : "") +
      "</p>" +
      (compact
        ? ""
        : '<p style="margin:0 0 10px;font-size:0.82rem">' +
          esc(o.drop_address || o.customer_address || "—") +
          "</p>") +
      '<a class="pf-btn pf-btn--primary" href="/track?id=' +
      encodeURIComponent(trackId) +
      '">تتبع</a></article>'
    );
  }

  function renderHome() {
    var parts = splitOrders(state.orders);
    var recent = (state.orders || [])
      .slice()
      .sort(function (a, b) {
        return orderSortTime(b) - orderSortTime(a);
      })
      .slice(0, 5);
    var hub = HUB_LINKS.map(function (h) {
      return (
        '<a class="pf-hub-tile" href="' +
        esc(h.href) +
        '"><span>' +
        esc(h.icon) +
        "</span><span>" +
        esc(h.label) +
        "</span></a>"
      );
    }).join("");
    return (
      W.sectionHeader("منصة العضو", "Home — تجربة موحّدة للعضو") +
      '<div class="pf-loc-card"><span style="font-size:1.4rem">📍</span><div>' +
      '<p style="margin:0 0 4px;font-size:0.72rem;font-weight:800;color:var(--pf-muted)">الموقع الحالي</p>' +
      "<p style=\"margin:0;font-weight:700\">" +
      esc(state.locationLabel) +
      '</p><a class="pf-btn" href="/delivery-map.html" style="margin-top:8px;font-size:0.78rem;min-height:40px">تحديث الموقع</a></div></div>' +
      '<form class="pf-search" action="/start-now.html" method="get">' +
      '<input type="search" name="q" placeholder="ابحث عن مطعم، متجر، أو خدمة…" aria-label="بحث" />' +
      '<button type="submit" class="pf-btn pf-btn--primary">🔍</button></form>' +
      '<div class="pf-hub-grid">' +
      hub +
      "</div>" +
      '<h3 style="margin:0 0 10px;font-size:0.95rem">بطاقات سريعة</h3>' +
      W.quickActions([
        { label: "طلباتي", sub: parts.open.length + " نشطة", section: "orders" },
        {
          label: "محفظتي",
          sub: fmtMoney((state.wallet && state.wallet.balance) || 0) + " ر.س",
          section: "wallet",
        },
        { label: "الإشعارات", sub: state.unreadCount + " غير مقروء", href: "/notifications" },
        { label: "العروض", sub: (state.offers || []).length + " عرض", href: "/start-now.html" },
      ]) +
      W.recentActivity({
        title: "آخر الطلبات",
        viewAllSection: "orders",
        emptyText: "لا توجد طلبات بعد.",
        items: recent.map(function (o) {
          return renderOrderCard(o, true);
        }),
      }) +
      W.healthStatus([
        { label: "الحساب", ok: state.accountOk },
        { label: "المحفظة", ok: state.walletOk },
        { label: "الإشعارات", ok: state.notifOk },
      ])
    );
  }

  function renderOrders() {
    var parts = splitOrders(state.orders);
    var tab = state.ordersTab;
    var list =
      tab === "closed"
        ? parts.closed
        : tab === "track"
          ? parts.open.filter(function (o) {
              return !isCancelledOrder(o);
            })
          : parts.open;
    var listHtml = list.length
      ? list.map(function (o) {
          return renderOrderCard(o, false);
        }).join("")
      : '<p class="pf-empty">لا توجد طلبات في هذا القسم.</p>';
    return (
      W.sectionHeader("طلباتي", "Orders — الحالية · السابقة · التتبع") +
      '<div class="pf-tabs">' +
      '<button type="button" class="pf-tab' +
      (tab === "open" ? " is-active" : "") +
      '" data-orders-tab="open">الطلبات الحالية (' +
      parts.open.length +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "closed" ? " is-active" : "") +
      '" data-orders-tab="closed">الطلبات السابقة (' +
      parts.closed.length +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "track" ? " is-active" : "") +
      '" data-orders-tab="track">تتبع الطلبات</button></div>' +
      listHtml +
      '<p style="margin-top:12px"><a class="pf-btn" href="/my-orders">فتح صفحة الطلبات الكلاسيكية</a></p>'
    );
  }

  function renderWallet() {
    var bal = (state.wallet && state.wallet.balance) != null ? state.wallet.balance : 0;
    var rows = (state.transactions || [])
      .slice(0, 20)
      .map(function (t) {
        var amt = Number(t.amount) || 0;
        var sign = amt >= 0 ? "+" : "";
        return (
          "<tr><td>" +
          esc(fmtDate(t.created_at)) +
          "</td><td>" +
          esc(t.type || t.description || "—") +
          "</td><td>" +
          esc(sign + fmtMoney(amt)) +
          " ر.س</td></tr>"
        );
      })
      .join("");
    return (
      W.sectionHeader("المحفظة", "Wallet — الرصيد · العمليات · الشحن") +
      W.kpiGrid([{ label: "الرصيد المتاح", value: fmtMoney(bal), suffix: "ر.س" }]) +
      '<div class="pf-card">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<a class="pf-btn pf-btn--primary" href="/wallet.html">شحن المحفظة</a>' +
      '<a class="pf-btn" href="/wallet.html#redeem">استرداد كود</a>' +
      '<a class="pf-btn" href="/wallet.html">المحفظة الكاملة</a></div>' +
      '<h3 class="pf-card__title">آخر العمليات</h3>' +
      (rows
        ? '<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<p class="pf-empty">لا توجد عمليات بعد.</p>') +
      "</div>"
    );
  }

  function renderAddresses() {
    var addrs = collectAddresses();
    var html = addrs.length
      ? addrs
          .map(function (a) {
            return (
              '<div class="pf-order-card"><p style="margin:0 0 4px;font-weight:800">' +
              esc(a.label) +
              '</p><p style="margin:0;font-size:0.78rem;color:var(--pf-muted)">' +
              esc(a.source) +
              "</p></div>"
            );
          })
          .join("")
      : '<p class="pf-empty">لا توجد عناوين محفوظة — حدّد موقعك عند الطلب الأول.</p>';
    return (
      W.sectionHeader("العناوين", "Addresses — العناوين من الطلبات والموقع الحالي") +
      html +
      '<p style="margin-top:12px"><a class="pf-btn pf-btn--primary" href="/delivery-map.html">تحديث الموقع</a> ' +
      '<a class="pf-btn" href="/cart.html">السلة والتوصيل</a></p>'
    );
  }

  function renderAccount() {
    var u = (state.me && state.me.user) || {};
    var p = (state.me && state.me.profile) || {};
    var access = (state.me && state.me.access) || {};
    return (
      W.sectionHeader("الحساب", "Account — البيانات الشخصية والتفضيلات") +
      '<div class="pf-card">' +
      "<p><strong>الاسم:</strong> " +
      esc(p.name || u.name || "—") +
      "</p>" +
      "<p><strong>الجوال:</strong> " +
      esc(u.phone || p.phone || "—") +
      "</p>" +
      "<p><strong>الدور:</strong> " +
      esc(p.role || "customer") +
      "</p>" +
      "<p><strong>الحالة:</strong> " +
      esc(p.status || "—") +
      "</p>" +
      "<p><strong>صلاحية الطلب:</strong> " +
      (access.can_place_orders ? "مفعّلة" : "معلّقة") +
      "</p>" +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
      '<a class="pf-btn" href="/login?role=customer">إدارة الحساب</a>' +
      '<a class="pf-btn pf-btn--primary" href="/start-now.html">استكشاف الخدمات</a></div></div>'
    );
  }

  function renderSection(id) {
    if (id === "home") return renderHome();
    if (id === "orders") return renderOrders();
    if (id === "wallet") return renderWallet();
    if (id === "addresses") return renderAddresses();
    if (id === "account") return renderAccount();
    return '<p class="pf-empty">قسم غير معروف.</p>';
  }

  function paintHeader() {
    shell.updateHeader({
      name: customerName(),
      sidebarName: customerName(),
      subtitle: "📍 " + state.locationLabel,
      avatarText: customerInitials(),
    });
  }

  function wireSectionEvents() {
    var main = shell.getMainEl();
    if (!main) return;
    main.querySelectorAll("[data-orders-tab]").forEach(function (btn) {
      btn.onclick = function () {
        state.ordersTab = btn.getAttribute("data-orders-tab") || "open";
        renderMain(shell.getActiveSection());
      };
    });
  }

  function renderMain(section) {
    shell.setContent(renderSection(section));
    paintHeader();
    wireSectionEvents();
  }

  async function loadData() {
    state.accountOk = false;
    state.walletOk = false;
    state.notifOk = false;
    state.me = await api("/api/core/me");
    state.accountOk = !!(state.me && state.me.profile);

    try {
      var ordersRes = await api("/api/order/orders");
      state.orders = Array.isArray(ordersRes.orders) ? ordersRes.orders : [];
    } catch (_) {
      state.orders = [];
    }
    try {
      state.wallet = await api("/api/wallet");
      state.walletOk = true;
    } catch (_) {
      state.wallet = null;
    }
    try {
      var txRes = await api("/api/wallet/transactions");
      state.transactions = Array.isArray(txRes.transactions) ? txRes.transactions : [];
      if (!state.walletOk && state.transactions.length) state.walletOk = true;
    } catch (_) {
      state.transactions = [];
    }
    try {
      var offRes = await api("/api/core/platform-offers");
      state.offers = Array.isArray(offRes.offers) ? offRes.offers : [];
    } catch (_) {
      state.offers = [];
    }
    try {
      var uc = await api("/api/notifications/unread-count");
      state.unreadCount = Number(uc.count) || 0;
      state.notifOk = true;
    } catch (_) {
      state.unreadCount = 0;
    }
    state.locationLabel = resolveLocationLabel();
  }

  async function init() {
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      console.error("Portal Framework غير محمّل");
      return;
    }

    shell = ErvenowPortalFramework.PortalShell.create({
      role: "customer",
      app: "#cpApp",
      loginEl: "#cpLogin",
      hashBase: "/customer-preview",
      notifKey: "customer-preview-header",
      operationalV2: true,
      portalTitle: "منصة العضو",
      showBottomNav: false,
      onNavigate: function (section) {
        renderMain(section);
      },
    });
    W = shell.getWidgets();
    shell.mountChrome();

    global.addEventListener("ervenow:auth-changed", function () {
      global.location.reload();
    });

    if (!global.PlatformAPI || !PlatformAPI.getToken()) {
      shell.showLogin();
      return;
    }

    try {
      if (global.ErvenowAuthGuard) {
        var me = await ErvenowAuthGuard.ensureApprovedAccount({ loginUrl: "/login?role=customer" });
        var role = String((me.profile && me.profile.role) || "").toLowerCase();
        if (role !== "customer" && role !== "admin") {
          shell.showLogin();
          var loginEl = document.getElementById("cpLogin");
          if (loginEl && loginEl.querySelector("p")) {
            loginEl.querySelector("p").textContent =
              "هذا الحساب ليس عضواً — استخدم حساب عضو للمعاينة.";
          }
          return;
        }
      }
      await loadData();
      shell.showApp();
      renderMain(shell.getActiveSection());
      shell.mountNotifications().then(function () {
        state.notifOk = true;
        if (shell.getActiveSection() === "home") renderMain("home");
      });
    } catch (e) {
      shell.showLogin();
      shell.showMessage((e && e.message) || "تعذّر تحميل البوابة", false);
    }
  }

  global.ErvenowCustomerPreview = { init: init };
})(typeof window !== "undefined" ? window : global);
