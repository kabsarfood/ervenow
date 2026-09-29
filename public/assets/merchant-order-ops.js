/**
 * وظائف مشتركة للوحة الطلبات داخل PortalShell (وإعادة استخدام الخريطة من order-board).
 * لا يغيّر API. لا يضيف رفض طلب.
 */
(function (global) {
  "use strict";

  var COUNTERS = [
    { key: "pending", emoji: "🟡", ar: "جديد" },
    { key: "accepted", emoji: "🔵", ar: "مقبول" },
    { key: "preparing", emoji: "🟠", ar: "تجهيز" },
    { key: "ready", emoji: "🟢", ar: "جاهز" },
    { key: "picked_up", emoji: "🚚", ar: "مع المندوب" },
    { key: "delivered", emoji: "✅", ar: "مُسلّم" },
  ];

  var mapInst = null;
  var leafletPromise = null;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function boardStatus(order) {
    var s = String((order && (order.board_status || order.delivery_status)) || "")
      .trim()
      .toLowerCase();
    if (!s || s === "cancelled" || s === "cancelled_by_customer") return null;
    if (s === "new" || s === "draft") return "pending";
    if (s === "picked" || s === "delivering") return "picked_up";
    return s;
  }

  function dropCoords(order) {
    if (!order) return null;
    var lat = Number(order.drop_lat || order.lat || (order.dropoff && order.dropoff.lat));
    var lng = Number(order.drop_lng || order.lng || (order.dropoff && order.dropoff.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function notesOf(order) {
    if (!order) return "";
    return String(order.notes || (order.breakdown && order.breakdown.notes) || "").trim();
  }

  function fulfillmentOf(order) {
    var data = order && order.data && typeof order.data === "object" ? order.data : {};
    var f = String(data.fulfillment || order.fulfillment || "").toLowerCase();
    if (f === "local") return "محلي";
    if (f === "pickup") return "استلام من المتجر";
    if (f === "delivery" || f === "store_delivery") return "توصيل";
    if (order && order.drop_address) return "توصيل";
    return "";
  }

  function countsFromBoard(board, orders) {
    var c = (board && board.status_counts) || null;
    if (c && typeof c === "object") {
      return {
        pending: Number(c.pending) || 0,
        accepted: Number(c.accepted) || 0,
        preparing: Number(c.preparing) || 0,
        ready: Number(c.ready) || 0,
        picked_up: Number(c.picked_up) || 0,
        delivered: Number(c.delivered) || 0,
      };
    }
    var out = { pending: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, delivered: 0 };
    (orders || []).forEach(function (o) {
      var k = boardStatus(o);
      if (k && Object.prototype.hasOwnProperty.call(out, k)) out[k] += 1;
    });
    return out;
  }

  function destroyMap() {
    if (!mapInst) return;
    try {
      mapInst.remove();
    } catch (_e) {}
    mapInst = null;
  }

  function ensureLeaflet() {
    if (typeof global.L === "object" && global.L && global.L.map) return Promise.resolve();
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve) {
      if (!document.querySelector('link[data-erv-leaflet="1"]')) {
        var css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        css.setAttribute("data-erv-leaflet", "1");
        document.head.appendChild(css);
      }
      if (!document.querySelector('script[data-erv-leaflet="1"]')) {
        var s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.async = true;
        s.setAttribute("data-erv-leaflet", "1");
        s.onload = function () {
          resolve();
        };
        s.onerror = function () {
          resolve();
        };
        document.head.appendChild(s);
      } else {
        var wait = setInterval(function () {
          if (typeof global.L === "object" && global.L && global.L.map) {
            clearInterval(wait);
            resolve();
          }
        }, 50);
        setTimeout(function () {
          clearInterval(wait);
          resolve();
        }, 8000);
      }
    });
    return leafletPromise;
  }

  function attachMap(el, lat, lng) {
    destroyMap();
    if (!el || typeof global.L === "undefined" || !global.L.map) return;
    mapInst = global.L.map(el, { zoomControl: true, attributionControl: false }).setView([lat, lng], 15);
    global.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mapInst);
    global.L.marker([lat, lng]).addTo(mapInst);
    setTimeout(function () {
      if (mapInst) mapInst.invalidateSize();
    }, 200);
  }

  function mountDropMap(hostId, order) {
    var coords = dropCoords(order);
    var el = typeof hostId === "string" ? document.getElementById(hostId) : hostId;
    if (!coords || !el) return Promise.resolve();
    return ensureLeaflet().then(function () {
      attachMap(el, coords.lat, coords.lng);
    });
  }

  function itemsHtml(order) {
    var wf = global.ErvenowMerchantOrderWorkflow;
    var items = wf && wf.itemsFromBreakdown ? wf.itemsFromBreakdown(order) : [];
    if (!items.length) return "<p class='mp-empty'>لا تفاصيل أصناف.</p>";
    return (
      "<ul class='mp-order-items'>" +
      items
        .map(function (it) {
          var qty = Number(it.qty || it.quantity || 1) || 1;
          var name = it.name || it.title || it.product_name || "صنف";
          var price = it.price != null ? fmtMoney(it.price) + " ر.س" : "";
          return (
            "<li><span>" +
            esc(name) +
            " × " +
            qty +
            "</span><span>" +
            esc(price) +
            "</span></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function driverHtml(order) {
    var d = order && order.driver;
    if (!d) {
      return '<p class="mp-section-sub">لم يُعيَّن مندوب بعد — يُبلَّغ أقرب مندوب عند «جاهز للاستلام».</p>';
    }
    return (
      '<div class="mp-order-driver"><p><strong>المندوب:</strong> ' +
      esc(d.name || "—") +
      "</p><p><strong>الجوال:</strong> " +
      (d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + "</a>" : "—") +
      "</p></div>"
    );
  }

  function detailBodyHtml(order) {
    if (!order) return "";
    var wf = global.ErvenowMerchantOrderWorkflow;
    var coords = dropCoords(order);
    var pay = wf && wf.paymentLabel ? wf.paymentLabel(order.payment_status) : order.payment_status || "—";
    var st = boardStatus(order) || "pending";
    var pill = wf && wf.pillHtml ? wf.pillHtml(st) : esc(st);
    var fulfill = fulfillmentOf(order);
    var notes = notesOf(order);
    var time =
      wf && wf.formatTime12 ? wf.formatTime12(order.created_at) : order.created_at || "—";
    return (
      "<dl class='mp-order-dl'>" +
      "<dt>رقم الطلب</dt><dd>" +
      esc(order.order_number || order.id) +
      "</dd>" +
      "<dt>اسم العضو</dt><dd>" +
      esc(order.customer_name || "عضو ERVENOW") +
      "</dd>" +
      "<dt>الجوال</dt><dd>" +
      (order.customer_phone
        ? '<a href="tel:' + esc(order.customer_phone) + '">' + esc(order.customer_phone) + "</a>"
        : "—") +
      "</dd>" +
      "<dt>العنوان</dt><dd>" +
      esc(order.drop_address || order.delivery_address || "—") +
      "</dd>" +
      (fulfill ? "<dt>طريقة الاستلام</dt><dd>" + esc(fulfill) + "</dd>" : "") +
      "<dt>طريقة الدفع</dt><dd>" +
      esc(pay) +
      "</dd>" +
      "<dt>الحالة المالية</dt><dd>" +
      esc(order.financial_status_label || "—") +
      "</dd>" +
      "<dt>الإجمالي</dt><dd>" +
      fmtMoney(order.order_value != null ? order.order_value : order.total || order.order_total) +
      " ر.س</dd>" +
      "<dt>العمولة</dt><dd>" +
      fmtMoney(order.commission) +
      " ر.س</dd>" +
      "<dt>صافي المتجر</dt><dd>" +
      fmtMoney(order.store_net != null ? order.store_net : 0) +
      " ر.س</dd>" +
      "<dt>الحالة</dt><dd>" +
      pill +
      "</dd>" +
      "<dt>وقت الطلب</dt><dd>" +
      esc(time) +
      "</dd>" +
      "<dt>ملاحظات</dt><dd>" +
      esc(notes || "—") +
      "</dd></dl>" +
      driverHtml(order) +
      "<div><strong>الأصناف</strong>" +
      itemsHtml(order) +
      "</div>" +
      (coords ? '<div id="mpOrderMap" class="mp-order-map" aria-label="موقع التسليم"></div>' : "")
    );
  }

  global.ErvenowMerchantOrderOps = {
    COUNTERS: COUNTERS,
    esc: esc,
    fmtMoney: fmtMoney,
    boardStatus: boardStatus,
    dropCoords: dropCoords,
    notesOf: notesOf,
    fulfillmentOf: fulfillmentOf,
    countsFromBoard: countsFromBoard,
    destroyMap: destroyMap,
    ensureLeaflet: ensureLeaflet,
    attachMap: attachMap,
    mountDropMap: mountDropMap,
    detailBodyHtml: detailBodyHtml,
    driverHtml: driverHtml,
    itemsHtml: itemsHtml,
  };
})(typeof window !== "undefined" ? window : global);
