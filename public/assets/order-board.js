/**
 * ERVENOW Order Management Board V1
 */
(function () {
  "use strict";

  var wf = window.ErvenowMerchantOrderWorkflow;
  var storeId = null;
  var storeMeta = null;
  var allOrders = [];
  var statusCounts = {};
  var activeFilter = null;
  var boardSocket = null;
  var refreshTimer = null;
  var detailMap = null;

  var COUNTER_DEFS = [
    { key: "pending", emoji: "🟡", label: "Pending", ar: "جديد" },
    { key: "accepted", emoji: "🔵", label: "Accepted", ar: "مقبول" },
    { key: "preparing", emoji: "🟠", label: "Preparing", ar: "تجهيز" },
    { key: "ready", emoji: "🟢", label: "Ready", ar: "جاهز" },
    { key: "picked_up", emoji: "🚚", label: "Picked Up", ar: "مع المندوب" },
    { key: "delivered", emoji: "✅", label: "Delivered", ar: "مُسلّم" },
  ];

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function showMsg(text, ok) {
    var el = document.getElementById("obMsg");
    if (!el) return;
    el.style.display = "block";
    el.className = "msg " + (ok ? "ok" : "err");
    el.textContent = text;
  }

  function normalizeBoardStatus(raw) {
    var s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s || s === "cancelled" || s === "cancelled_by_customer") return null;
    if (s === "new" || s === "draft") return "pending";
    if (s === "picked" || s === "delivering") return "picked_up";
    return s;
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusPill(order) {
    var s = normalizeBoardStatus(order.board_status || order.delivery_status) || "pending";
    var lbl = wf ? wf.labelFor(s) : s;
    return '<span class="ob-pill ob-pill--' + esc(s) + '">' + esc(lbl) + "</span>";
  }

  function finPill(order) {
    var key = order.financial_status || "pending";
    var lbl = order.financial_status_label || "معلق";
    return '<span class="ob-pill ob-pill--fin-' + esc(key) + '">' + esc(lbl) + "</span>";
  }

  function paymentText(order) {
    if (wf && wf.paymentLabel) return wf.paymentLabel(order.payment_status);
    var s = String(order.payment_status || "").toLowerCase();
    return s === "paid" ? "مدفوع" : s === "pending" ? "معلق" : order.payment_status || "—";
  }

  function orderTime(order) {
    if (wf && wf.formatTime12) return wf.formatTime12(order.created_at);
    return order.created_at || "—";
  }

  function filteredOrders() {
    if (!activeFilter) {
      return allOrders.filter(function (o) {
        var s = normalizeBoardStatus(o.board_status || o.delivery_status);
        return s && s !== "delivered";
      });
    }
    return allOrders.filter(function (o) {
      return normalizeBoardStatus(o.board_status || o.delivery_status) === activeFilter;
    });
  }

  function renderCounters() {
    var root = document.getElementById("obCounters");
    if (!root) return;
    root.innerHTML = COUNTER_DEFS.map(function (c) {
      var n = Number(statusCounts[c.key]) || 0;
      var on = activeFilter === c.key ? " is-active" : "";
      return (
        '<button type="button" class="ob-counter ob-counter--' +
        c.key +
        on +
        '" data-filter="' +
        c.key +
        '" aria-pressed="' +
        (on ? "true" : "false") +
        '">' +
        '<span class="ob-counter__emoji">' +
        c.emoji +
        "</span>" +
        '<span class="ob-counter__lbl">' +
        esc(c.label) +
        " · " +
        esc(c.ar) +
        "</span>" +
        '<span class="ob-counter__val">' +
        n +
        "</span></button>"
      );
    }).join("");

    root.querySelectorAll(".ob-counter").forEach(function (btn) {
      btn.onclick = function () {
        var f = btn.getAttribute("data-filter");
        activeFilter = activeFilter === f ? null : f;
        updateFilterLabel();
        renderCards();
        renderCounters();
      };
    });
  }

  function updateFilterLabel() {
    var el = document.getElementById("obFilterLabel");
    if (!el) return;
    if (!activeFilter) {
      el.textContent = "الطلبات النشطة (بدون المُسلّمة)";
      return;
    }
    var def = COUNTER_DEFS.find(function (c) {
      return c.key === activeFilter;
    });
    el.textContent = def ? "عرض: " + def.ar + " (" + def.label + ")" : "—";
  }

  function actionButtonsHtml(order) {
    var s = normalizeBoardStatus(order.board_status || order.delivery_status);
    var id = esc(order.id);
    var parts = [];

    if (wf) {
      var act = wf.nextActionFor(s);
      if (act) {
        parts.push(
          '<button type="button" class="btn btn-primary ob-action-patch" data-order-id="' +
            id +
            '" data-next="' +
            esc(act.status) +
            '">' +
            esc(act.label) +
            "</button>"
        );
      }
    }

    if (s === "ready") {
      parts.push(
        '<button type="button" class="btn btn-ghost ob-action-print" data-order-id="' +
          id +
          '">طباعة الفاتورة</button>'
      );
      parts.push(
        '<button type="button" class="btn btn-ghost ob-action-driver" data-order-id="' +
          id +
          '">عرض بيانات المندوب</button>'
      );
    }
    if (s === "picked_up" || s === "delivering") {
      var track = wf && wf.trackUrlForOrder ? wf.trackUrlForOrder(order.id) : "/track?id=" + encodeURIComponent(order.id);
      parts.push('<a class="btn btn-primary" href="' + esc(track) + '">تتبع المندوب</a>');
    }

    parts.push(
      '<button type="button" class="btn btn-ghost ob-action-detail" data-order-id="' +
        id +
        '">التفاصيل</button>'
    );

    return parts.join("");
  }

  function renderCards() {
    var grid = document.getElementById("obGrid");
    var empty = document.getElementById("obEmpty");
    if (!grid) return;
    var list = filteredOrders();
    grid.innerHTML = "";

    if (!list.length) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    list.forEach(function (o) {
      var card = document.createElement("article");
      card.className = "ob-card";
      card.innerHTML =
        '<div class="ob-card__head"><h3 class="ob-card__num">' +
        esc(o.order_number || o.id) +
        "</h3>" +
        statusPill(o) +
        "</div>" +
        '<p class="ob-card__row"><strong>العضو:</strong> ' +
        esc(o.customer_name || "عضو ERVENOW") +
        "</p>" +
        '<p class="ob-card__row"><strong>عدد الأصناف:</strong> ' +
        (Number(o.item_count) || 0) +
        "</p>" +
        '<p class="ob-card__row"><strong>الإجمالي:</strong> ' +
        fmtMoney(o.order_value != null ? o.order_value : o.total_with_vat || o.order_total) +
        " ريال</p>" +
        '<p class="ob-card__row"><strong>وقت الطلب:</strong> ' +
        esc(orderTime(o)) +
        "</p>" +
        '<p class="ob-card__row"><strong>طريقة الدفع:</strong> ' +
        esc(paymentText(o)) +
        "</p>" +
        '<div class="ob-card__fin">' +
        "<div><span>قيمة الطلب</span><strong>" +
        fmtMoney(o.order_value) +
        "</strong></div>" +
        "<div><span>العمولة</span><strong>" +
        fmtMoney(o.commission) +
        "</strong></div>" +
        "<div><span>صافي المتجر</span><strong>" +
        fmtMoney(o.store_net) +
        "</strong></div>" +
        "<div><span>الحالة المالية</span>" +
        finPill(o) +
        "</div></div>" +
        '<div class="ob-card__actions">' +
        actionButtonsHtml(o) +
        "</div>";
      grid.appendChild(card);
    });

    bindCardActions();
  }

  function findOrder(id) {
    return allOrders.find(function (o) {
      return String(o.id) === String(id);
    });
  }

  function bindCardActions() {
    document.querySelectorAll(".ob-action-patch").forEach(function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute("data-order-id");
        var next = btn.getAttribute("data-next");
        if (!id || !next || !wf) return;
        btn.disabled = true;
        try {
          await wf.patchOrderStatus(id, next);
          showMsg("تم تحديث حالة الطلب", true);
          scheduleRefresh();
        } catch (e) {
          showMsg(String((e && e.message) || e || "تعذر التحديث"), false);
          btn.disabled = false;
        }
      };
    });

    document.querySelectorAll(".ob-action-print").forEach(function (btn) {
      btn.onclick = function () {
        var o = findOrder(btn.getAttribute("data-order-id"));
        if (o && wf && wf.printThermal80) wf.printThermal80(o, storeMeta);
      };
    });

    document.querySelectorAll(".ob-action-driver").forEach(function (btn) {
      btn.onclick = function () {
        var o = findOrder(btn.getAttribute("data-order-id"));
        openDriverInfo(o);
      };
    });

    document.querySelectorAll(".ob-action-detail").forEach(function (btn) {
      btn.onclick = function () {
        openDetail(findOrder(btn.getAttribute("data-order-id")));
      };
    });
  }

  function openDriverInfo(order) {
    if (!order) return;
    var d = order.driver;
    var html = d
      ? '<div class="ob-driver-box"><p><strong>المندوب:</strong> ' +
        esc(d.name || "—") +
        "</p><p><strong>الجوال:</strong> " +
        (d.phone
          ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + "</a>"
          : "—") +
        "</p></div>"
      : '<p class="sub">لم يُعيَّن مندوب بعد — سيُبلَّغ أقرب مندوب عند «جاهز للاستلام».</p>';
    openDetail(order, html);
  }

  function destroyDetailMap() {
    if (detailMap) {
      try {
        detailMap.remove();
      } catch (_e) {}
      detailMap = null;
    }
  }

  function initDetailMap(lat, lng) {
    destroyDetailMap();
    var el = document.getElementById("obDetailMap");
    if (!el || typeof L === "undefined" || !lat || !lng) return;
    detailMap = L.map(el, { zoomControl: true, attributionControl: false }).setView([lat, lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(detailMap);
    L.marker([lat, lng]).addTo(detailMap);
    setTimeout(function () {
      if (detailMap) detailMap.invalidateSize();
    }, 200);
  }

  function openDetail(order, extraHtml) {
    if (!order) return;
    var backdrop = document.getElementById("obModalBackdrop");
    var body = document.getElementById("obModalBody");
    var actions = document.getElementById("obModalActions");
    var title = document.getElementById("obModalTitle");
    if (!backdrop || !body) return;

    title.textContent = "طلب " + (order.order_number || order.id);
    var items = wf && wf.itemsFromBreakdown ? wf.itemsFromBreakdown(order) : [];
    var itemsHtml = items.length
      ? "<ul class='ob-items'>" +
        items
          .map(function (it) {
            var qty = Number(it.qty || it.quantity || 1) || 1;
            var name = it.name || it.title || it.product_name || "صنف";
            var price = it.price != null ? fmtMoney(it.price) + " ريال" : "";
            return "<li><span>" + esc(name) + " × " + qty + "</span><span>" + esc(price) + "</span></li>";
          })
          .join("") +
        "</ul>"
      : "<p class='sub'>لا تفاصيل أصناف.</p>";

    var lat = Number(order.drop_lat);
    var lng = Number(order.drop_lng);
    var hasMap = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;

    body.innerHTML =
      (extraHtml || "") +
      "<dl>" +
      "<dt>رقم الطلب</dt><dd>" +
      esc(order.order_number || order.id) +
      "</dd>" +
      "<dt>اسم العضو</dt><dd>" +
      esc(order.customer_name) +
      "</dd>" +
      "<dt>الجوال</dt><dd>" +
      (order.customer_phone
        ? '<a href="tel:' + esc(order.customer_phone) + '">' + esc(order.customer_phone) + "</a>"
        : "—") +
      "</dd>" +
      "<dt>العنوان</dt><dd>" +
      esc(order.drop_address || "—") +
      "</dd>" +
      "<dt>طريقة الدفع</dt><dd>" +
      esc(paymentText(order)) +
      "</dd>" +
      "<dt>الإجمالي</dt><dd>" +
      fmtMoney(order.order_value) +
      " ريال</dd>" +
      "<dt>العمولة</dt><dd>" +
      fmtMoney(order.commission) +
      " ريال</dd>" +
      "<dt>صافي المتجر</dt><dd>" +
      fmtMoney(order.store_net) +
      " ريال</dd>" +
      "<dt>الحالة</dt><dd>" +
      statusPill(order) +
      " " +
      finPill(order) +
      "</dd>" +
      "<dt>وقت الطلب</dt><dd>" +
      esc(orderTime(order)) +
      "</dd>" +
      "<dt>ملاحظات</dt><dd>" +
      esc(order.notes || (order.breakdown && order.breakdown.notes) || "—") +
      "</dd>" +
      "</dl>" +
      "<div><strong>الأصناف</strong>" +
      itemsHtml +
      "</div>" +
      (hasMap ? '<div id="obDetailMap" aria-label="موقع التسليم"></div>' : "");

    if (actions) {
      actions.innerHTML = actionButtonsHtml(order);
      bindCardActions();
    }

    backdrop.classList.add("is-open");
    backdrop.setAttribute("aria-hidden", "false");
    if (hasMap) initDetailMap(lat, lng);
  }

  function closeDetail() {
    var backdrop = document.getElementById("obModalBackdrop");
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.setAttribute("aria-hidden", "true");
    }
    destroyDetailMap();
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      loadBoard();
    }, 350);
  }

  function storeIdFromSocketMsg(msg) {
    if (!msg) return null;
    if (msg.store_id != null) return msg.store_id;
    if (msg.patch && msg.patch.store_id != null) return msg.patch.store_id;
    return null;
  }

  function connectSocket() {
    if (boardSocket || typeof io === "undefined") return;
    try {
      boardSocket = io({
        path: "/socket.io/",
        transports: ["websocket", "polling"],
        auth: {
          token:
            (window.PlatformAPI && PlatformAPI.getToken && PlatformAPI.getToken()) ||
            localStorage.getItem("ervenow_access_token") ||
            "",
        },
      });
      boardSocket.on("order:patch", function (msg) {
        if (!msg || !storeId) return;
        if (String(storeIdFromSocketMsg(msg) || "") === String(storeId)) scheduleRefresh();
      });
      boardSocket.on("order:new", function (msg) {
        if (!msg || !storeId) return;
        if (String(storeIdFromSocketMsg(msg) || "") === String(storeId)) scheduleRefresh();
      });
    } catch (_e) {}
  }

  async function loadBoard() {
    if (!window.PlatformAPI || !PlatformAPI.getToken || !PlatformAPI.getToken()) return;
    try {
      var data = await PlatformAPI.api("/api/store/order-board");
      document.getElementById("obHint").style.display = "none";
      document.getElementById("obMain").style.display = "block";

      storeMeta = data.store || {};
      storeId = storeMeta.id || null;
      allOrders = data.orders || [];
      statusCounts = data.status_counts || {};

      document.getElementById("obHeroTitle").textContent = "📋 " + (storeMeta.name || "لوحة الطلبات");
      document.getElementById("obStoreLine").textContent = storeMeta.phone ? "الجوال: " + storeMeta.phone : "";

      var pub = document.getElementById("obPublicLink");
      if (storeMeta.id && window.ErvenowStoreShell) {
        var url = ErvenowStoreShell.buildPublicStoreUrl
          ? ErvenowStoreShell.buildPublicStoreUrl(storeMeta.id)
          : "/store.html?id=" + encodeURIComponent(storeMeta.id);
        pub.href = url;
        if (ErvenowStoreShell.setPublicStoreUrl) ErvenowStoreShell.setPublicStoreUrl(url);
      }

      if (window.ErvenowStoreShell && ErvenowStoreShell.refreshWallet && data.wallet) {
        ErvenowStoreShell.refreshWallet(Number(data.wallet.balance) || 0);
      }

      renderCounters();
      updateFilterLabel();
      renderCards();
      connectSocket();
    } catch (e) {
      showMsg(String((e && e.message) || e || "تعذر التحميل"), false);
    }
  }

  document.getElementById("obRefreshBtn").addEventListener("click", function () {
    loadBoard();
  });
  document.getElementById("obModalClose").addEventListener("click", closeDetail);
  document.getElementById("obModalBackdrop").addEventListener("click", function (ev) {
    if (ev.target === document.getElementById("obModalBackdrop")) closeDetail();
  });

  loadBoard();
})();
