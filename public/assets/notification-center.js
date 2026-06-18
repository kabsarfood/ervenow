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

  function renderDropdown(state) {
    var unread = Number(state.unreadCount) || 0;
    var listHtml = "";
    if (!state.items.length) {
      listHtml = '<p class="erv-notification-empty">لا توجد إشعارات حالياً.</p>';
    } else {
      listHtml = state.items
        .slice(0, 20)
        .map(function (n) {
          return (
            '<button type="button" class="erv-notification-item' +
            (n.is_read ? "" : " is-unread") +
            '" data-id="' +
            esc(n.id) +
            '">' +
            '<p class="erv-notification-item-title">' +
            esc(n.title) +
            "</p>" +
            '<p class="erv-notification-item-message">' +
            esc(n.message) +
            "</p>" +
            '<p class="erv-notification-item-meta"><span>' +
            esc(fmtTime(n.created_at)) +
            "</span><span>" +
            (n.is_read ? "مقروء" : "غير مقروء") +
            "</span></p>" +
            "</button>"
          );
        })
        .join("");
    }

    state.root.innerHTML =
      '<div class="erv-notification-center">' +
      '<button type="button" class="erv-notification-bell" id="' +
      state.id +
      '-bell" aria-label="الإشعارات" aria-expanded="' +
      (state.open ? "true" : "false") +
      '">' +
      "🔔" +
      '<span class="erv-notification-badge" id="' +
      state.id +
      '-badge"' +
      (unread > 0 ? "" : " hidden") +
      ">" +
      esc(fmtBadge(unread)) +
      "</span>" +
      "</button>" +
      (state.open
        ? '<section class="erv-notification-panel" id="' +
          state.id +
          '-panel" aria-label="مركز الإشعارات">' +
          '<div class="erv-notification-head">' +
          '<h3 class="erv-notification-title">الإشعارات</h3>' +
          '<button type="button" class="erv-notification-read-all" ' +
          (unread > 0 ? "" : "disabled") +
          ' id="' +
          state.id +
          '-all">تحديد الكل كمقروء</button>' +
          "</div>" +
          '<div class="erv-notification-list">' +
          listHtml +
          "</div>" +
          '<div class="erv-notification-foot">' +
          '<a class="erv-notification-view-all" href="/notifications">عرض كل الإشعارات</a>' +
          "</div></section>"
        : "") +
      "</div>";
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

  async function handleItemActivate(state, id) {
    var item = state.items.find(function (n) {
      return String(n.id) === String(id);
    });
    if (!item) return;
    if (!item.is_read) {
      markReadLocal(state, id);
      await markReadRemote(id);
    }
    var href = resolveNotificationHref(item, USER_ROLE);
    if (href) global.location.href = href;
  }

  function wireDropdownEvents(state) {
    state.root.addEventListener("click", async function (ev) {
      var bell = ev.target.closest("#" + state.id + "-bell");
      if (bell) {
        state.open = !state.open;
        renderDropdown(state);
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
        renderDropdown(state);
        return;
      }
      var item = ev.target.closest(".erv-notification-item[data-id]");
      if (!item) return;
      ev.preventDefault();
      var id = item.getAttribute("data-id");
      state.open = false;
      renderDropdown(state);
      await handleItemActivate(state, id);
    });

    document.addEventListener("click", function (ev) {
      if (!state.open) return;
      if (state.root.contains(ev.target)) return;
      state.open = false;
      renderDropdown(state);
    });
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
          return (
            '<button type="button" class="erv-notif-page-item' +
            (n.is_read ? "" : " is-unread") +
            '" data-id="' +
            esc(n.id) +
            '">' +
            '<div class="erv-notif-page-item-head">' +
            tag +
            '<strong>' +
            esc(n.title) +
            "</strong></div>" +
            '<p class="erv-notif-page-item-msg">' +
            esc(n.message) +
            "</p>" +
            '<p class="erv-notif-page-item-meta">' +
            esc(fmtTime(n.created_at)) +
            " · " +
            (n.is_read ? "مقروء" : "غير مقروء") +
            "</p></button>"
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
      await handleItemActivate(state, item.getAttribute("data-id"));
      renderFullPage(state);
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
