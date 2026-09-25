(function (global) {
  var INSTANCES = {};
  var SOCKET_SCRIPT = "https://cdn.socket.io/4.8.1/socket.io.min.js";
  var USER_ROLE = "customer";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtBadge(n) {
    var x = Number(n) || 0;
    if (x <= 0) return "";
    if (x > 99) return "99+";
    return String(x);
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
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

  function normIncoming(item) {
    if (!item || !item.id) return null;
    return {
      id: String(item.id),
      title: item.title || "إشعار",
      message: item.message || "",
      type: String(item.type || "system").toLowerCase(),
      source: String(item.source || "ervenow").toLowerCase(),
      payload: parsePayload(item.payload),
      is_read: !!item.is_read,
      created_at: item.created_at || new Date().toISOString(),
      read_at: item.read_at || null,
    };
  }

  var NOTIF_TYPE_FILTERS = [
    { key: "all", label: "الكل" },
    { key: "unread", label: "غير مقروء" },
    { key: "order_new", label: "طلب جديد" },
    { key: "order_cancel", label: "إلغاء طلب" },
    { key: "withdraw_approved", label: "اعتماد سحب" },
    { key: "withdraw_rejected", label: "رفض سحب" },
    { key: "system", label: "النظام" },
  ];

  function categorizeNotification(n) {
    if (!n) return "system";
    var p = n.payload || {};
    var ev = String(p.event || p.event_key || "").toLowerCase();
    var type = String(n.type || "").toLowerCase();
    var title = String(n.title || "").toLowerCase();
    var msg = String(n.message || "").toLowerCase();
    if (ev.indexOf("order.new") >= 0 || ev === "merchant.order.new") return "order_new";
    if (ev.indexOf("cancelled") >= 0 || ev.indexOf("order.cancelled") >= 0) return "order_cancel";
    if (ev.indexOf("withdraw.approved") >= 0 || (type === "wallet" && /اعتماد|موافق|approved/.test(title + msg)))
      return "withdraw_approved";
    if (ev.indexOf("withdraw.rejected") >= 0 || (type === "wallet" && /رفض|rejected/.test(title + msg)))
      return "withdraw_rejected";
    if (type === "order") return "order_new";
    return "system";
  }

  function resolveNotificationHref(n, role) {
    if (!n) return null;
    var p = n.payload || {};
    var type = String(n.type || "").toLowerCase();
    var source = String(n.source || "").toLowerCase();
    role = String(role || USER_ROLE || "customer").toLowerCase();
    if (role === "user") role = "customer";
    if (role === "merchant" || role === "restaurant") role = "store";
    if (role === "service") role = "provider";

    if (p.href || p.url || p.link) return String(p.href || p.url || p.link);

    if (p.order_id) {
      var oid = encodeURIComponent(String(p.order_id));
      if (role === "driver") return "/orders?id=" + oid;
      if (role === "store") return "/merchant-preview#orders";
      if (role === "provider") return "/services-provider.html?order=" + oid;
      if (role === "admin") return "/track?order=" + oid;
      return "/track?order=" + oid;
    }

    if (type === "wallet" || type === "payment" || source === "wallet") {
      if (role === "driver") return "/driver-wallet";
      if (role === "store") return "/merchant-preview#wallet";
      if (role === "provider") return "/services-provider.html#wallet";
      return "/wallet.html";
    }

    if (type === "broadcast") return null;
    if (type === "account" && role === "admin") return "/admin-dashboard";
  }

  function ensureSoundsScript() {
    if (document.querySelector('script[data-erv-notification-sounds="1"]')) return;
    var s = document.createElement("script");
    s.src = "/assets/notification-sounds.js";
    s.defer = true;
    s.setAttribute("data-erv-notification-sounds", "1");
    document.head.appendChild(s);
  }

  function playSoundForItem(item) {
    ensureSoundsScript();
    if (global.ErvenowNotificationSounds && typeof ErvenowNotificationSounds.playForItem === "function") {
      ErvenowNotificationSounds.playForItem(item);
    }
  }

  function ensureSocketIoScript() {
    if (typeof global.io === "function") return Promise.resolve();
    if (document.querySelector('script[data-erv-socket-io="1"]')) return Promise.resolve();
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = SOCKET_SCRIPT;
      s.async = true;
      s.setAttribute("data-erv-socket-io", "1");
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  function statusLabel(raw) {
    var s = String(raw || "").toLowerCase();
    var map = {
      new: "جديد",
      pending: "بانتظار القبول",
      preparing: "تحت التجهيز",
      ready: "جاهز",
      accepted: "استلمه المندوب",
      picked_up: "جاري التوصيل",
      delivering: "جاري التوصيل",
      delivered: "تم التسليم",
      cancelled: "ملغى",
      canceled: "ملغى",
    };
    return map[s] || (raw ? String(raw) : "");
  }

  function pushRow(rows, label, value) {
    if (value == null || String(value).trim() === "") return;
    rows.push({ label: label, value: String(value) });
  }

  function numberFromText(text) {
    var m = String(text || "").match(/[A-Z]{1,3}-\d{2}-\d{2,}/);
    return m ? m[0] : "";
  }

  function detailRows(n) {
    var p = (n && n.payload) || {};
    var order = n && n.orderDetail;
    var rows = [];
    pushRow(rows, "رقم الطلب", (order && (order.order_number || order.id)) || p.order_number || numberFromText(n && n.message));
    pushRow(rows, "الحالة", statusLabel((order && (order.delivery_status || order.status)) || p.delivery_status || p.status));
    pushRow(rows, "المتجر", (order && (order.store_name || order.merchant_name)) || p.store_name);
    pushRow(rows, "نوع النشاط", p.store_type);
    pushRow(rows, "مقدم الطلب", p.applicant_name);
    pushRow(rows, "الجوال", (order && (order.customer_phone || order.phone)) || p.phone || p.applicant_phone);
    pushRow(rows, "العنوان", order && (order.drop_address || order.address));
    if (order && order.order_total != null) pushRow(rows, "الإجمالي", String(order.order_total) + " ر.س");
    else if (order && order.total_with_vat != null) pushRow(rows, "الإجمالي", String(order.total_with_vat) + " ر.س");
    var items = order && order.breakdown && order.breakdown.items;
    if (Array.isArray(items) && items.length) {
      pushRow(
        rows,
        "الأصناف",
        items
          .slice(0, 6)
          .map(function (it) {
            return (it.name || it.title || "صنف") + (it.qty || it.quantity ? " × " + (it.qty || it.quantity) : "");
          })
          .join("، ")
      );
    }
    return rows;
  }

  function detailBlockHtml(n) {
    var rows = detailRows(n);
    var loading = n && n.orderLoading ? '<p class="erv-notif-detail-note">جاري جلب تفاصيل الطلب…</p>' : "";
    var fail = n && n.orderDetailError ? '<p class="erv-notif-detail-note">' + esc(n.orderDetailError) + "</p>" : "";
    if (!rows.length && !loading && !fail) return "";
    return (
      '<div class="erv-notif-detail">' +
      loading +
      fail +
      rows
        .map(function (r) {
          return '<div class="erv-notif-detail-row"><span>' + esc(r.label) + "</span><strong>" + esc(r.value) + "</strong></div>";
        })
        .join("") +
      "</div>"
    );
  }

  async function loadOrderDetail(item) {
    var p = (item && item.payload) || {};
    if (!p.order_id || item.orderDetail || item.orderLoading) return;
    if (!global.PlatformAPI || !PlatformAPI.api) return;
    item.orderLoading = true;
    try {
      var res = await PlatformAPI.api("/api/order/" + encodeURIComponent(String(p.order_id)));
      var order = (res && (res.order || (res.data && res.data.order) || res.data)) || null;
      if (order && order.id) item.orderDetail = order;
      else item.orderDetailError = "تعذر عرض تفاصيل الطلب";
    } catch (e) {
      item.orderDetailError = "تعذر عرض تفاصيل الطلب";
    } finally {
      item.orderLoading = false;
    }
  }

  function statusHtml(n) {
    if (n && n.is_read) {
      return '<span class="erv-notification-status is-read">مقروء</span>';
    }
    return '<span class="erv-notification-status is-new">اشعار جديد</span>';
  }

  function itemCardHtml(n, expandedId) {
    var open = String(expandedId || "") === String(n.id);
    var href = resolveNotificationHref(n, USER_ROLE);
    return (
      '<article class="erv-notification-item' +
      (n.is_read ? " is-read" : " is-unread") +
      (open ? " is-open" : "") +
      '" data-id="' +
      esc(n.id) +
      '" role="button" tabindex="0" aria-expanded="' +
      (open ? "true" : "false") +
      '">' +
      '<p class="erv-notification-item-title">' +
      esc(n.title) +
      "</p>" +
      '<p class="erv-notification-item-message' +
      (open ? " is-full" : "") +
      '">' +
      esc(n.message || "—") +
      "</p>" +
      '<p class="erv-notification-item-status-row">' +
      statusHtml(n) +
      "</p>" +
      '<p class="erv-notification-item-meta">' +
      '<span class="erv-notification-item-time">' +
      esc(fmtTime(n.created_at)) +
      "</span>" +
      "</p>" +
      (open ? detailBlockHtml(n) : "") +
      "</article>"
    );
  }

  function panelElId(state) {
    return state.id + "-panel";
  }

  function removePortaledPanel(state) {
    var el = document.getElementById(panelElId(state));
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.documentElement.classList.remove("erv-notif-panel-open");
  }

  function positionPanel(state) {
    var panel = document.getElementById(panelElId(state));
    var bell = document.getElementById(state.id + "-bell");
    if (!panel || !bell) return;
    var r = bell.getBoundingClientRect();
    var vw = window.innerWidth || 360;
    var vh = window.innerHeight || 640;
    var gap = 8;
    var isNarrow = vw <= 640;
    if (isNarrow) {
      panel.style.left = "8px";
      panel.style.right = "8px";
      panel.style.width = "auto";
      var top = Math.round(r.bottom + gap);
      var maxH = Math.max(180, vh - top - 12);
      panel.style.top = top + "px";
      panel.style.bottom = "auto";
      panel.style.maxHeight = Math.min(maxH, Math.round(vh * 0.7)) + "px";
      return;
    }
    var width = Math.min(380, vw - 16);
    panel.style.width = width + "px";
    var right = Math.round(Math.max(8, vw - r.right));
    if (right + width > vw - 8) right = 8;
    panel.style.right = right + "px";
    panel.style.left = "auto";
    var topDesk = r.bottom + gap;
    var spaceBelow = vh - topDesk - 12;
    if (spaceBelow < 200 && r.top > spaceBelow) {
      panel.style.top = "auto";
      panel.style.bottom = Math.round(vh - r.top + gap) + "px";
      panel.style.maxHeight = Math.min(520, Math.round(r.top - 16)) + "px";
    } else {
      panel.style.top = Math.round(topDesk) + "px";
      panel.style.bottom = "auto";
      panel.style.maxHeight = Math.min(520, Math.max(180, spaceBelow)) + "px";
    }
  }

  function renderDropdown(state) {
    var unread = Number(state.unreadCount) || 0;
    var listHtml = "";
    if (!state.items.length) {
      listHtml = '<p class="erv-notification-empty">لا توجد إشعارات حالياً.</p>';
    } else {
      listHtml = state.items.map(function (n) {
        return itemCardHtml(n, state.expandedId);
      }).join("");
    }

    var expanded = state.open ? "true" : "false";
    state.root.innerHTML =
      '<div class="erv-notification-center">' +
      '<button type="button" class="erv-notification-bell" id="' +
      state.id +
      '-bell" aria-label="الإشعارات" aria-expanded="' +
      expanded +
      '" aria-controls="' +
      panelElId(state) +
      '">' +
      "🔔" +
      '<span class="erv-notification-badge" id="' +
      state.id +
      '-badge"' +
      (unread > 0 ? "" : " hidden") +
      ">" +
      esc(fmtBadge(unread)) +
      "</span>" +
      "</button></div>";

    removePortaledPanel(state);
    if (!state.open) return;

    var panel = document.createElement("section");
    panel.id = panelElId(state);
    panel.className = "erv-notification-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "مركز الإشعارات");
    panel.innerHTML =
      '<div class="erv-notification-head">' +
      '<h3 class="erv-notification-title">الإشعارات</h3>' +
      '<button type="button" class="erv-notification-read-all" ' +
      (unread > 0 ? "" : "disabled") +
      ' id="' +
      state.id +
      '-all">تحديد الكل كمقروء</button>' +
      "</div>" +
      '<div class="erv-notification-list" id="' +
      state.id +
      '-list">' +
      listHtml +
      "</div>" +
      '<div class="erv-notification-foot">' +
      '<a class="erv-notification-view-all" href="/notifications">عرض كل الإشعارات</a>' +
      "</div>";
    document.body.appendChild(panel);
    document.documentElement.classList.add("erv-notif-panel-open");
    positionPanel(state);
    if (state.expandedId) {
      var openItem = panel.querySelector('.erv-notification-item[data-id="' + state.expandedId + '"]');
      if (openItem && typeof openItem.scrollIntoView === "function") {
        openItem.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function addOrUpdateItem(state, incoming) {
    var n = normIncoming(incoming);
    if (!n) return { added: false, item: null };
    var idx = state.items.findIndex(function (x) {
      return String(x.id) === String(n.id);
    });
    if (idx >= 0) {
      var prev = state.items[idx];
      state.items[idx] = Object.assign({}, prev, n);
      return { added: false, item: state.items[idx] };
    }
    state.items.unshift(n);
    if (state.items.length > 200) state.items = state.items.slice(0, 200);
    return { added: true, item: n };
  }

  function refreshUnreadCountFromItems(state) {
    state.unreadCount = state.items.reduce(function (sum, n) {
      return sum + (n.is_read ? 0 : 1);
    }, 0);
  }

  function pulse(state) {
    var bell = document.getElementById(state.id + "-bell");
    var badge = document.getElementById(state.id + "-badge");
    if (bell) {
      bell.classList.remove("is-pulse");
      void bell.offsetWidth;
      bell.classList.add("is-pulse");
    }
    if (badge && !badge.hidden) {
      badge.classList.remove("is-shake");
      void badge.offsetWidth;
      badge.classList.add("is-shake");
    }
  }

  async function detectUserRole() {
    if (!global.PlatformAPI || !PlatformAPI.api) return "customer";
    try {
      var me = await PlatformAPI.api("/api/core/me");
      var role = (me && me.profile && me.profile.role) || "customer";
      USER_ROLE = String(role).toLowerCase();
      return USER_ROLE;
    } catch (_) {
      return USER_ROLE;
    }
  }

  async function loadInitial(state, opts) {
    opts = opts || {};
    if (!global.PlatformAPI || !PlatformAPI.api) return;
    await detectUserRole();
    var limit = opts.limit || 100;
    var unreadOnly = opts.unreadOnly === true;
    var q = "/api/notifications?limit=" + encodeURIComponent(String(limit));
    if (unreadOnly) q += "&unread_only=1";
    var countRes = await PlatformAPI.api("/api/notifications/unread-count");
    state.unreadCount = Number((countRes && countRes.unread_count) || 0);
    var listRes = await PlatformAPI.api(q);
    var rows = (listRes && (listRes.items || listRes.notifications || listRes.data)) || [];
    var byId = {};
    state.items = rows
      .map(normIncoming)
      .filter(Boolean)
      .filter(function (n) {
        if (byId[n.id]) return false;
        byId[n.id] = true;
        return true;
      });
    refreshUnreadCountFromItems(state);
    if (state.unreadCount === 0 && Number((countRes && countRes.unread_count) || 0) > 0) {
      state.unreadCount = Number(countRes.unread_count);
    }
  }

  async function markReadRemote(id) {
    if (!id || !global.PlatformAPI || !PlatformAPI.api) return;
    try {
      await PlatformAPI.api("/api/notifications/read/" + encodeURIComponent(id), { method: "POST" });
    } catch (_) {}
  }

  async function markAllReadRemote() {
    if (!global.PlatformAPI || !PlatformAPI.api) return;
    try {
      await PlatformAPI.api("/api/notifications/read-all", { method: "POST" });
    } catch (_) {}
  }

  function markReadLocal(state, id) {
    var foundUnread = false;
    state.items = state.items.map(function (n) {
      if (String(n.id) !== String(id)) return n;
      if (!n.is_read) foundUnread = true;
      return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
    });
    if (foundUnread) state.unreadCount = Math.max(0, (Number(state.unreadCount) || 0) - 1);
  }

  function paintState(state) {
    if (state.mode === "page") renderFullPage(state);
    else renderDropdown(state);
  }

  async function openItemInCard(state, id) {
    var item = state.items.find(function (n) {
      return String(n.id) === String(id);
    });
    if (!item) return;
    if (String(state.expandedId || "") === String(id)) {
      state.expandedId = null;
      paintState(state);
      return;
    }
    state.expandedId = id;
    if (state.mode !== "page") state.open = true;
    if (!item.is_read) markReadLocal(state, id);
    paintState(state);
    var tasks = [];
    if (!item.is_read) tasks.push(markReadRemote(id));
    if (item.payload && item.payload.order_id && !item.orderDetail) {
      tasks.push(
        loadOrderDetail(item).then(function () {
          if (String(state.expandedId || "") === String(id)) paintState(state);
        })
      );
    }
    await Promise.all(tasks);
  }

  async function handleItemActivate(state, id) {
    await openItemInCard(state, id);
  }

  function eventInsideNotifUi(state, target) {
    if (!target) return false;
    if (state.root && state.root.contains(target)) return true;
    var panel = document.getElementById(panelElId(state));
    return !!(panel && panel.contains(target));
  }

  function wireDropdownEvents(state) {
    if (state.wired) return;
    state.wired = true;

    document.addEventListener("click", function (ev) {
      var target = ev.target;
      if (!target || !target.closest) return;
      var openLink = target.closest("[data-notif-open]");
      if (openLink && eventInsideNotifUi(state, openLink)) return;

      var bell = target.closest("#" + state.id + "-bell");
      if (bell) {
        ev.preventDefault();
        ev.stopPropagation();
        state.open = !state.open;
        if (!state.open) state.expandedId = null;
        renderDropdown(state);
        return;
      }

      var markAll = target.closest("#" + state.id + "-all");
      if (markAll) {
        ev.preventDefault();
        ev.stopPropagation();
        markAll.disabled = true;
        markAllReadRemote().then(function () {
          state.items = state.items.map(function (n) {
            return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
          });
          state.unreadCount = 0;
          renderDropdown(state);
        });
        return;
      }

      var item = target.closest(".erv-notification-item[data-id]");
      if (item && eventInsideNotifUi(state, item)) {
        ev.preventDefault();
        ev.stopPropagation();
        openItemInCard(state, item.getAttribute("data-id"));
        return;
      }

      if (!state.open) return;
      if (eventInsideNotifUi(state, target)) return;
      state.open = false;
      state.expandedId = null;
      renderDropdown(state);
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && state.open) {
        state.open = false;
        state.expandedId = null;
        renderDropdown(state);
        return;
      }
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var item = ev.target && ev.target.closest && ev.target.closest(".erv-notification-item[data-id]");
      if (!item || !eventInsideNotifUi(state, item)) return;
      ev.preventDefault();
      openItemInCard(state, item.getAttribute("data-id"));
    });

    function onViewportChange() {
      if (state.open) positionPanel(state);
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  }

  async function setupSocket(state) {
    if (!global.PlatformAPI || !PlatformAPI.getToken) return;
    var token = PlatformAPI.getToken();
    if (!token) return;
    await ensureSocketIoScript();
    if (typeof global.io !== "function") return;
    if (state.socket) return;
    state.socket = global.io({ path: "/socket.io/", transports: ["websocket", "polling"], auth: { token: token } });
    state.socket.on("notification:new", function (payload) {
      var out = addOrUpdateItem(state, payload);
      if (out.added && !(payload && payload.is_read)) {
        state.unreadCount = (Number(state.unreadCount) || 0) + 1;
        playSoundForItem(out.item || normIncoming(payload));
      } else {
        refreshUnreadCountFromItems(state);
      }
      if (state.mode === "page") renderFullPage(state);
      else renderDropdown(state);
      pulse(state);
    });
    state.socket.on("notification:read", function (payload) {
      if (!payload) return;
      if (payload.id) markReadLocal(state, payload.id);
      else if (payload.ids && Array.isArray(payload.ids)) payload.ids.forEach(function (id) { markReadLocal(state, id); });
      else if (payload.all) {
        state.items = state.items.map(function (n) {
          return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
        });
        state.unreadCount = 0;
      }
      refreshUnreadCountFromItems(state);
      if (state.mode === "page") renderFullPage(state);
      else renderDropdown(state);
    });
  }

  function renderFullPage(state) {
    var root = state.root;
    if (!root) return;
    var filter = state.pageFilter || "all";
    var typeFilter = state.notifTypeFilter || "all";
    var rows = state.items.slice();
    if (filter === "unread") rows = rows.filter(function (n) {
      return !n.is_read;
    });
    if (state.enableTypeFilters && typeFilter !== "all") {
      rows = rows.filter(function (n) {
        return categorizeNotification(n) === typeFilter;
      });
    }
    var unread = Number(state.unreadCount) || 0;
    var listHtml = "";
    if (!rows.length) {
      listHtml =
        '<p class="erv-notification-empty">لا توجد إشعارات' +
        (filter === "unread" ? " غير مقروءة" : "") +
        (typeFilter !== "all" ? " في هذا النوع" : "") +
        ".</p>";
    } else {
      listHtml = rows
        .map(function (n) {
          var tag = n.type === "broadcast" ? '<span class="erv-notif-page-tag">إعلان</span>' : "";
          if (state.enableTypeFilters) {
            var cat = categorizeNotification(n);
            var catLabel =
              cat === "order_new"
                ? "طلب"
                : cat === "order_cancel"
                  ? "إلغاء"
                  : cat === "withdraw_approved"
                    ? "سحب ✓"
                    : cat === "withdraw_rejected"
                      ? "سحب ✗"
                      : "نظام";
            tag = '<span class="erv-notif-page-tag">' + esc(catLabel) + "</span>";
          }
          var open = String(state.expandedId || "") === String(n.id);
          var href = resolveNotificationHref(n, USER_ROLE);
          return (
            '<article class="erv-notif-page-item' +
            (n.is_read ? " is-read" : " is-unread") +
            (open ? " is-open" : "") +
            '" data-id="' +
            esc(n.id) +
            '" role="button" tabindex="0">' +
            '<div class="erv-notif-page-item-head">' +
            tag +
            "<strong>" +
            esc(n.title) +
            "</strong></div>" +
            '<p class="erv-notif-page-item-msg' +
            (open ? " is-full" : "") +
            '">' +
            esc(n.message) +
            "</p>" +
            '<p class="erv-notif-page-item-meta">' +
            esc(fmtTime(n.created_at)) +
            " · " +
            (n.is_read ? "مقروء" : "اشعار جديد") +
            "</p>" +
            (open ? detailBlockHtml(n) : "") +
            "</article>"
          );
        })
        .join("");
    }

    var typeTabsHtml = "";
    if (state.enableTypeFilters) {
      typeTabsHtml =
        '<div class="erv-notif-page-type-tabs" role="tablist">' +
        NOTIF_TYPE_FILTERS.filter(function (f) {
          return f.key !== "unread";
        })
          .map(function (f) {
            var count =
              f.key === "all"
                ? state.items.length
                : state.items.filter(function (n) {
                    return categorizeNotification(n) === f.key;
                  }).length;
            return (
              '<button type="button" class="erv-notif-page-type-tab' +
              (typeFilter === f.key ? " is-active" : "") +
              '" data-type-filter="' +
              esc(f.key) +
              '" role="tab">' +
              esc(f.label) +
              ' <span class="erv-notif-page-tab-count">' +
              count +
              "</span></button>"
            );
          })
          .join("") +
        "</div>";
    }

    root.innerHTML =
      '<div class="erv-notif-page">' +
      '<header class="erv-notif-page-head">' +
      "<div>" +
      '<h1 class="erv-notif-page-title">مركز الإشعارات</h1>' +
      '<p class="erv-notif-page-sub">جميع تنبيهاتك في مكان واحد</p>' +
      "</div>" +
      '<div class="erv-notif-page-actions">' +
      '<button type="button" class="erv-notif-page-btn" id="' +
      state.id +
      '-all" ' +
      (unread > 0 ? "" : "disabled") +
      ">تحديد الكل كمقروء</button>" +
      "</div></header>" +
      '<div class="erv-notif-page-tabs" role="tablist">' +
      '<button type="button" class="erv-notif-page-tab' +
      (filter === "all" ? " is-active" : "") +
      '" data-filter="all" role="tab">الكل <span class="erv-notif-page-tab-count">' +
      state.items.length +
      "</span></button>" +
      '<button type="button" class="erv-notif-page-tab' +
      (filter === "unread" ? " is-active" : "") +
      '" data-filter="unread" role="tab">غير المقروء <span class="erv-notif-page-tab-count">' +
      unread +
      "</span></button>" +
      "</div>" +
      typeTabsHtml +
      '<div class="erv-notif-page-list">' +
      listHtml +
      "</div></div>";
  }

  function wirePageEvents(state) {
    state.root.addEventListener("click", async function (ev) {
      var tab = ev.target.closest(".erv-notif-page-tab[data-filter]");
      if (tab) {
        state.pageFilter = tab.getAttribute("data-filter") || "all";
        renderFullPage(state);
        return;
      }
      var typeTab = ev.target.closest(".erv-notif-page-type-tab[data-type-filter]");
      if (typeTab) {
        state.notifTypeFilter = typeTab.getAttribute("data-type-filter") || "all";
        renderFullPage(state);
        return;
      }
      var markAll = ev.target.closest("#" + state.id + "-all");
      if (markAll) {
        markAll.disabled = true;
        await markAllReadRemote();
        state.items = state.items.map(function (n) {
          return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
        });
        state.unreadCount = 0;
        renderFullPage(state);
        return;
      }
      var item = ev.target.closest(".erv-notif-page-item[data-id]");
      if (!item) return;
      if (ev.target.closest("[data-notif-open]")) return;
      await handleItemActivate(state, item.getAttribute("data-id"));
    });
  }

  async function mount(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var mountEl =
      typeof opts.mount === "string" ? document.querySelector(opts.mount) : opts.mount && opts.mount.nodeType === 1 ? opts.mount : null;
    if (!mountEl) return null;
    var key = opts.key || mountEl.id || "default";
    if (INSTANCES[key]) return INSTANCES[key].api;

    ensureSoundsScript();
    var state = {
      id: "ervNotif" + Math.random().toString(36).slice(2, 8),
      key: key,
      root: mountEl,
      items: [],
      unreadCount: 0,
      open: false,
      expandedId: null,
      socket: null,
      mode: "dropdown",
      pageFilter: "all",
    };
    INSTANCES[key] = { state: state, api: { refresh: refresh } };

    function refresh() {
      return loadInitial(state)
        .then(function () {
          renderDropdown(state);
          return setupSocket(state);
        })
        .catch(function () {
          renderDropdown(state);
          return setupSocket(state);
        });
    }

    renderDropdown(state);
    wireDropdownEvents(state);
    await refresh();
    return INSTANCES[key].api;
  }

  async function initPage(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var mountEl = typeof opts.mount === "string" ? document.querySelector(opts.mount) : opts.mount;
    if (!mountEl) return null;
    ensureSoundsScript();
    var state = {
      id: "ervNotifPage",
      key: "full-page",
      root: mountEl,
      items: [],
      unreadCount: 0,
      open: false,
      expandedId: null,
      socket: null,
      mode: "page",
      pageFilter: "all",
      notifTypeFilter: "all",
      enableTypeFilters: opts.enableTypeFilters === true,
    };

    async function refresh() {
      await loadInitial(state, { limit: 100 });
      renderFullPage(state);
      await setupSocket(state);
    }

    wirePageEvents(state);
    await refresh();
    return { refresh: refresh };
  }

  global.ErvenowNotificationCenter = {
    mount: mount,
    initPage: initPage,
    resolveHref: resolveNotificationHref,
    fmtTime: fmtTime,
    fmtBadge: fmtBadge,
    normIncoming: normIncoming,
    categorizeNotification: categorizeNotification,
  };
})(window);
