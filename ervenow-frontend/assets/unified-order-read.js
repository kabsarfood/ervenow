/**
 * ترجمة شارة الحالة الموحدة حسب الدور — ليست مصدر المنطق.
 * القيم التشغيلية: order.workflow + order.status_unified من الـ API.
 */
(function (global) {
  "use strict";

  var CUSTOMER = {
    store: {
      created: "تم استلام طلبك",
      accepted: "تم قبول طلبك",
      preparing: "جاري تجهيز طلبك",
      ready: "طلبك جاهز للاستلام",
      assigned: "تم تعيين مندوب لطلبك",
      picked_up: "المندوب استلم طلبك من المتجر",
      in_progress: "جاري تجهيز طلبك",
      in_transit: "طلبك في الطريق إليك",
      completed: "تم تسليم طلبك",
      cancelled: "تم إلغاء الطلب",
      unknown: "جاري متابعة طلبك",
    },
    service: {
      created: "تم تسجيل طلب الخدمة",
      assigned: "تم تعيين مزود الخدمة",
      scheduled: "تم جدولة موعد الخدمة",
      in_transit: "مزود الخدمة في الطريق",
      in_progress: "جاري تنفيذ الخدمة",
      completed: "اكتملت الخدمة",
      cancelled: "تم إلغاء طلب الخدمة",
      unknown: "جاري متابعة طلب الخدمة",
    },
    transport: {
      created: "تم تسجيل طلب النقل",
      assigned: "تم تعيين مزود النقل",
      in_transit: "مزود النقل في الطريق",
      in_progress: "جاري تنفيذ النقل",
      completed: "اكتمل طلب النقل",
      cancelled: "تم إلغاء طلب النقل",
      unknown: "جاري متابعة طلب النقل",
    },
    internal_delivery: {
      created: "تم تسجيل طلب التوصيل",
      assigned: "تم تعيين مندوب",
      in_transit: "طلبك في الطريق إليك",
      completed: "تم التسليم",
      cancelled: "تم إلغاء الطلب",
      unknown: "جاري متابعة التوصيل",
    },
    delivery: {
      created: "تم تسجيل طلب التوصيل",
      assigned: "تم تعيين مندوب",
      in_transit: "طلبك في الطريق إليك",
      completed: "تم التسليم",
      cancelled: "تم إلغاء الطلب",
      unknown: "جاري متابعة التوصيل",
    },
  };

  var MERCHANT = {
    store: {
      created: "طلب جديد",
      accepted: "مقبول",
      preparing: "جاري التجهيز",
      ready: "جاهز للاستلام",
      assigned: "بانتظار استلام المندوب",
      picked_up: "استلمه المندوب",
      in_transit: "قيد التوصيل",
      completed: "تم التسليم",
      cancelled: "ملغى",
      unknown: "قيد المتابعة",
    },
  };

  var DRIVER = {
    store: {
      ready: "جاهز للاستلام",
      assigned: "معيّن لك",
      picked_up: "تم الاستلام من المتجر",
      in_transit: "في الطريق للعميل",
      completed: "تم التسليم",
      unknown: "قيد المتابعة",
    },
    internal_delivery: {
      created: "طلب توصيل جديد",
      assigned: "معيّن لك",
      picked_up: "تم استلام الشحنة",
      in_transit: "في الطريق للعميل",
      completed: "تم التسليم",
      unknown: "قيد المتابعة",
    },
    delivery: {
      created: "طلب توصيل جديد",
      assigned: "معيّن لك",
      in_transit: "في الطريق للعميل",
      completed: "تم التسليم",
      unknown: "قيد المتابعة",
    },
  };

  var SERVICE = {
    service: {
      created: "طلب جديد",
      assigned: "معيّن لك",
      scheduled: "مجدول",
      in_transit: "في الطريق",
      in_progress: "قيد التنفيذ",
      completed: "مكتمل",
      cancelled: "ملغى",
      unknown: "قيد المتابعة",
    },
  };

  var TRANSPORT = {
    transport: {
      created: "طلب نقل جديد",
      assigned: "معيّن لك",
      in_transit: "في الطريق",
      in_progress: "قيد التنفيذ",
      completed: "مكتمل",
      cancelled: "ملغى",
      unknown: "قيد المتابعة",
    },
  };

  var BY_ROLE = {
    customer: CUSTOMER,
    merchant: MERCHANT,
    driver: DRIVER,
    service: SERVICE,
    transport: TRANSPORT,
    admin: CUSTOMER,
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function statusLabel(role, workflow, statusUnified) {
    var r = String(role || "customer").toLowerCase();
    var wf = String(workflow || "unknown").toLowerCase();
    var st = String(statusUnified || "unknown").toLowerCase();
    var maps = BY_ROLE[r] || CUSTOMER;
    var row = maps[wf] || CUSTOMER[wf] || CUSTOMER.unknown || {};
    return row[st] || row.unknown || st || "—";
  }

  function badgeHtml(order, role) {
    if (!order || !order.status_unified) return "";
    var text = statusLabel(role, order.workflow, order.status_unified);
    return (
      '<span class="erv-unified-badge" data-unified-status="' +
      esc(order.status_unified) +
      '">' +
      esc(text) +
      "</span>"
    );
  }

  if (!global.document.querySelector("style[data-erv-unified-badge]")) {
    var style = global.document.createElement("style");
    style.setAttribute("data-erv-unified-badge", "1");
    style.textContent =
      ".erv-unified-badge{display:inline-block;margin-inline-start:6px;padding:3px 8px;border-radius:999px;font-size:0.72rem;font-weight:800;line-height:1.45;background:rgba(61,34,19,0.08);color:inherit;vertical-align:middle;white-space:nowrap}";
    global.document.head.appendChild(style);
  }

  function observeActions(order, role, uiActions) {
    try {
      if (!global.localStorage || localStorage.getItem("erv_unified_actions_log") !== "1") return;
      var allowed = (order && order.available_actions) || [];
      var ui = uiActions || [];
      var extraUi = ui.filter(function (a) {
        return allowed.indexOf(a) === -1;
      });
      var missingUi = allowed.filter(function (a) {
        return ui.indexOf(a) === -1;
      });
      if (!extraUi.length && !missingUi.length) return;
      console.info("[erv-unified-actions]", {
        id: order && (order.order_number || order.id),
        role: role,
        status_unified: order && order.status_unified,
        available_actions: allowed,
        ui_actions: ui,
        ui_not_in_policy: extraUi,
        policy_not_in_ui: missingUi,
      });
    } catch (_e) {}
  }

  global.ErvenowUnifiedOrderRead = {
    statusLabel: statusLabel,
    badgeHtml: badgeHtml,
    observeActions: observeActions,
  };
})(typeof window !== "undefined" ? window : globalThis);
