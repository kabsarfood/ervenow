/**
 * دورة حياة طلب المتجر — أزرار وPATCH موحّد
 */
(function (global) {
  "use strict";

  var LABELS = {
    draft: "مسودة",
    pending: "قيد الانتظار",
    new: "جديد",
    accepted: "مقبول",
    preparing: "قيد التجهيز",
    ready: "جاهز للاستلام",
    picked: "تم الاستلام",
    picked_up: "استلم المندوب",
    delivering: "قيد التوصيل",
    delivered: "تم التسليم",
    cancelled: "ملغى",
    cancelled_by_customer: "ملغى من العضو",
  };

  var NEXT_ACTION = {
    pending: { status: "accepted", label: "قبول الطلب" },
    accepted: { status: "preparing", label: "بدء التجهيز" },
    preparing: { status: "ready", label: "جاهز للاستلام" },
  };

  function normalizeStatus(s) {
    var x = String(s || "")
      .trim()
      .toLowerCase();
    if (x === "picked") return "picked_up";
    return x;
  }

  function labelFor(status) {
    var s = normalizeStatus(status);
    return LABELS[s] || status || "—";
  }

  function nextActionFor(status) {
    return NEXT_ACTION[normalizeStatus(status)] || null;
  }

  function pillHtml(status) {
    var s = normalizeStatus(status);
    var kind = s === "delivered" ? "ok" : s === "ready" || s === "delivering" || s === "accepted" ? "warn" : "muted";
    return (
      '<span class="md-pill md-pill--' +
      kind +
      '">' +
      String(labelFor(s))
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;") +
      "</span>"
    );
  }

  async function patchOrderStatus(orderId, status) {
    if (!global.PlatformAPI || typeof global.PlatformAPI.api !== "function") {
      throw new Error("PlatformAPI غير متاح");
    }
    return global.PlatformAPI.api("/api/order/" + encodeURIComponent(orderId) + "/status", {
      method: "PATCH",
      body: { delivery_status: status },
    });
  }

  function paymentLabel(status) {
    var s = String(status || "")
      .trim()
      .toLowerCase();
    if (s === "paid") return "مدفوع";
    if (s === "pending") return "معلق";
    return status || "—";
  }

  function formatTime12(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("ar-SA", { hour: "numeric", minute: "2-digit", hour12: true });
    } catch (_e) {
      return "—";
    }
  }

  function itemsFromBreakdown(order) {
    var b = order && order.breakdown && typeof order.breakdown === "object" ? order.breakdown : {};
    return Array.isArray(b.items) ? b.items : [];
  }

  function trackUrlForOrder(orderId) {
    var origin = global.location && global.location.origin ? global.location.origin : "";
    return origin + "/track?id=" + encodeURIComponent(String(orderId));
  }

  function printThermal80(order, store) {
    if (!order) return;
    store = store || {};
    var items = itemsFromBreakdown(order);
    var lines = items
      .map(function (it) {
        var qty = Number(it.qty || it.quantity || 1) || 1;
        var name = String(it.name || it.title || it.product_name || "صنف").trim();
        return "<tr><td>" + qty + "</td><td>" + name + "</td></tr>";
      })
      .join("");
    var notes = String(order.notes || (order.breakdown && order.breakdown.notes) || "").trim();
    var total = Number(order.total_with_vat != null ? order.total_with_vat : order.order_total) || 0;
    var num = order.order_number || order.id;
    var trackUrl = trackUrlForOrder(order.id);
    var qr =
      "https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=" + encodeURIComponent(trackUrl);
    var html =
      '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
      "<title>" +
      num +
      '</title><style>' +
      "@page{size:80mm auto;margin:2mm}body{font-family:Cairo,sans-serif;font-size:11px;margin:0;padding:4mm;width:72mm}" +
      "h1{font-size:14px;margin:0 0 4px;text-align:center}h2{font-size:12px;margin:8px 0 4px;text-align:center;font-weight:700}" +
      "table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}hr{border:none;border-top:1px dashed #000;margin:6px 0}" +
      ".tot{font-size:13px;font-weight:800}.qr{text-align:center;margin-top:8px}.qr img{width:90px;height:90px}" +
      "</style></head><body>" +
      "<h1>ERVENOW</h1>" +
      "<h2>" +
      String(store.name || "المتجر").replace(/</g, "&lt;") +
      "</h2>" +
      "<p><strong>رقم الطلب:</strong> " +
      String(num).replace(/</g, "&lt;") +
      "</p>" +
      "<p><strong>الوقت:</strong> " +
      formatTime12(order.created_at) +
      "</p><hr><table>" +
      lines +
      "</table><hr>" +
      (notes ? "<p><strong>ملاحظات:</strong> " + notes.replace(/</g, "&lt;") + "</p>" : "") +
      '<p class="tot">الإجمالي: ' +
      total.toFixed(2) +
      " ريال</p>" +
      '<div class="qr"><img src="' +
      qr +
      '" alt="QR" /></div>' +
      "<script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}<\/script>" +
      "</body></html>";
    var w = global.open("", "_blank", "width=320,height=640");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  global.ErvenowMerchantOrderWorkflow = {
    LABELS: LABELS,
    labelFor: labelFor,
    nextActionFor: nextActionFor,
    pillHtml: pillHtml,
    patchOrderStatus: patchOrderStatus,
    paymentLabel: paymentLabel,
    formatTime12: formatTime12,
    itemsFromBreakdown: itemsFromBreakdown,
    trackUrlForOrder: trackUrlForOrder,
    printThermal80: printThermal80,
  };
})(typeof window !== "undefined" ? window : global);
