/**
 * ERVENOW — Portal operational notifications (order cards + actions)
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return "—";
    }
  }

  function parsePayload(raw) {
    if (raw == null) return {};
    if (typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        var p = JSON.parse(raw);
        return p && typeof p === "object" ? p : {};
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function orderFields(n) {
    var p = parsePayload(n && n.payload);
    var d = p.data && typeof p.data === "object" ? p.data : p;
    return {
      orderId: p.order_id || p.booking_id || d.order_id || d.booking_id || null,
      customer: p.customer_name || d.customer_name || d.name || p.name || "—",
      service: p.service_label || p.service_type_label || d.service_label || n.title || "—",
      location: p.location || d.location || d.service_district || d.district || d.pickup_address || d.drop_address || "—",
      price: p.price != null ? p.price : p.total != null ? p.total : d.price != null ? d.price : d.total,
      serviceType: p.service_type || d.service_type || null,
    };
  }

  function isOrderNotification(n) {
    if (!n) return false;
    var type = String(n.type || "").toLowerCase();
    if (type === "order" || type === "booking" || type === "service_order") return true;
    var p = parsePayload(n.payload);
    return !!(p.order_id || p.booking_id);
  }

  function mount(host, opts) {
    opts = opts || {};
    if (!host) return null;

    var state = {
      open: false,
      items: [],
      unread: 0,
      loading: false,
    };

    function renderBell() {
      host.innerHTML =
        '<button type="button" class="pf-ops-bell" data-pf-ops-bell aria-label="الإشعارات" aria-expanded="' +
        (state.open ? "true" : "false") +
        '">' +
        "🔔" +
        (state.unread > 0
          ? '<span class="pf-ops-bell__badge">' + esc(state.unread > 99 ? "99+" : state.unread) + "</span>"
          : "") +
        "</button>";
    }

    function panelParent() {
      return host.closest(".pf-main-wrap") || host.closest(".pf-shell") || document.body;
    }

    function removePanel() {
      var el = document.querySelector("[data-pf-ops-panel]");
      if (el) el.remove();
    }

    function renderPanel() {
      removePanel();
      if (!state.open) return;
      var wrap = document.createElement("div");
      wrap.className = "pf-ops-panel";
      wrap.setAttribute("data-pf-ops-panel", "1");
      var orderItems = state.items.filter(isOrderNotification);
      var otherItems = state.items.filter(function (n) {
        return !isOrderNotification(n);
      });
      var cards = orderItems
        .slice(0, 12)
        .map(function (n) {
          var f = orderFields(n);
          var priceTxt = f.price != null && f.price !== "" ? fmtMoney(f.price) + " ر.س" : "—";
          var actions =
            '<div class="pf-ops-order__actions">' +
            (opts.onAcceptOrder && f.orderId
              ? '<button type="button" class="pf-btn pf-btn--primary" data-pf-ops-accept="' +
                esc(f.orderId) +
                '">حجز الطلب</button>'
              : opts.onReserveBooking && f.orderId
                ? '<button type="button" class="pf-btn pf-btn--primary" data-pf-ops-reserve="' +
                  esc(f.orderId) +
                  '">حجز الطلب</button>'
                : "") +
            (f.orderId && opts.onDetails
              ? '<button type="button" class="pf-btn" data-pf-ops-details="' + esc(f.orderId) + '">التفاصيل</button>'
              : "") +
            "</div>";
          return (
            '<article class="pf-ops-order' +
            (n.is_read ? "" : " is-unread") +
            '">' +
            '<p class="pf-ops-order__eyebrow">طلب جديد</p>' +
            "<p><strong>العضو:</strong> " +
            esc(f.customer) +
            "</p>" +
            "<p><strong>الخدمة:</strong> " +
            esc(f.service) +
            "</p>" +
            "<p><strong>الموقع:</strong> " +
            esc(f.location) +
            "</p>" +
            "<p><strong>السعر:</strong> " +
            esc(priceTxt) +
            "</p>" +
            '<p class="pf-ops-order__meta">' +
            esc(fmtTime(n.created_at)) +
            "</p>" +
            actions +
            "</article>"
          );
        })
        .join("");
      var others = otherItems
        .slice(0, 6)
        .map(function (n) {
          return (
            '<div class="pf-ops-notif-simple">' +
            "<strong>" +
            esc(n.title || "إشعار") +
            "</strong>" +
            "<p>" +
            esc(n.message || "") +
            "</p></div>"
          );
        })
        .join("");
      wrap.innerHTML =
        '<div class="pf-ops-panel__backdrop" data-pf-ops-close></div>' +
        '<section class="pf-ops-panel__sheet" role="dialog" aria-label="إشعارات التشغيل">' +
        '<header class="pf-ops-panel__head">' +
        "<h3>إشعارات التشغيل</h3>" +
        '<button type="button" class="pf-btn" data-pf-ops-close>إغلاق</button>' +
        "</header>" +
        '<div class="pf-ops-panel__body">' +
        (state.loading ? '<p class="pf-empty">جارٍ التحميل…</p>' : "") +
        (cards || '<p class="pf-empty">لا توجد طلبات في الإشعارات حالياً.</p>') +
        (others ? '<div class="pf-ops-panel__others">' + others + "</div>" : "") +
        "</div></section>";
      panelParent().appendChild(wrap);
    }

    async function loadItems() {
      if (!global.PlatformAPI || !PlatformAPI.api) return;
      state.loading = true;
      renderPanel();
      try {
        var countRes = await PlatformAPI.api("/api/notifications/unread-count");
        state.unread = Number((countRes && countRes.unread_count) || 0);
        var listRes = await PlatformAPI.api("/api/notifications?limit=40");
        var rows = (listRes && (listRes.items || listRes.notifications || listRes.data)) || [];
        state.items = rows.map(function (row) {
          return {
            id: row.id,
            title: row.title,
            message: row.message,
            type: row.type,
            payload: parsePayload(row.payload),
            is_read: !!row.is_read,
            created_at: row.created_at,
          };
        });
      } catch (_) {
        state.items = [];
      }
      state.loading = false;
      renderBell();
      if (state.open) renderPanel();
    }

    async function markRead(id) {
      if (!id || !global.PlatformAPI) return;
      try {
        await PlatformAPI.api("/api/notifications/read/" + encodeURIComponent(id), { method: "POST" });
      } catch (_) {}
      state.unread = Math.max(0, state.unread - 1);
      renderBell();
    }

    function toggle(open) {
      state.open = open != null ? !!open : !state.open;
      renderBell();
      if (state.open) {
        loadItems();
      } else {
        removePanel();
      }
    }

    host.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-pf-ops-bell]")) {
        toggle();
      }
    });

    document.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-pf-ops-close]")) {
        toggle(false);
        return;
      }
      var acceptBtn = ev.target.closest("[data-pf-ops-accept]");
      if (acceptBtn && opts.onAcceptOrder) {
        ev.preventDefault();
        var aid = acceptBtn.getAttribute("data-pf-ops-accept");
        acceptBtn.disabled = true;
        Promise.resolve(opts.onAcceptOrder(aid))
          .then(function () {
            toggle(false);
            return loadItems();
          })
          .finally(function () {
            acceptBtn.disabled = false;
          });
        return;
      }
      var reserveBtn = ev.target.closest("[data-pf-ops-reserve]");
      if (reserveBtn && opts.onReserveBooking) {
        ev.preventDefault();
        var rid = reserveBtn.getAttribute("data-pf-ops-reserve");
        reserveBtn.disabled = true;
        Promise.resolve(opts.onReserveBooking(rid))
          .then(function () {
            toggle(false);
            return loadItems();
          })
          .finally(function () {
            reserveBtn.disabled = false;
          });
        return;
      }
      var detailsBtn = ev.target.closest("[data-pf-ops-details]");
      if (detailsBtn && opts.onDetails) {
        ev.preventDefault();
        opts.onDetails(detailsBtn.getAttribute("data-pf-ops-details"));
        toggle(false);
      }
    });

    renderBell();
    loadItems();

    if (global.ErvenowNotificationSounds) {
      /* sounds loaded by preview pages */
    }

    return {
      open: function () {
        toggle(true);
      },
      close: function () {
        toggle(false);
      },
      refresh: loadItems,
      getUnread: function () {
        return state.unread;
      },
    };
  }

  global.ErvenowPortalFramework = global.ErvenowPortalFramework || {};
  global.ErvenowPortalFramework.PortalNotificationsOps = {
    mount: mount,
    orderFields: orderFields,
    isOrderNotification: isOrderNotification,
  };
})(typeof window !== "undefined" ? window : globalThis);
