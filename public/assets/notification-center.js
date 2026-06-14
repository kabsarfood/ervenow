(function (global) {
  var INSTANCES = {};
  var SOCKET_SCRIPT = "https://cdn.socket.io/4.8.1/socket.io.min.js";

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
      return d.toLocaleString("ar-SA", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch (_) {
      return "—";
    }
  }

  function normIncoming(item) {
    if (!item || !item.id) return null;
    return {
      id: String(item.id),
      title: item.title || "إشعار",
      message: item.message || "",
      is_read: !!item.is_read,
      created_at: item.created_at || new Date().toISOString(),
      read_at: item.read_at || null,
    };
  }

  function ensureSocketIoScript() {
    if (typeof global.io === "function") return Promise.resolve();
    if (document.querySelector('script[data-erv-socket-io="1"]')) {
      return Promise.resolve();
    }
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

  function render(state) {
    var unread = Number(state.unreadCount) || 0;
    var listHtml = "";
    if (!state.items.length) {
      listHtml = '<p class="erv-notification-empty">لا توجد إشعارات حالياً.</p>';
    } else {
      listHtml = state.items
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
          "</div></section>"
        : "") +
      "</div>";
  }

  function addOrUpdateItem(state, incoming) {
    var n = normIncoming(incoming);
    if (!n) return false;
    var idx = state.items.findIndex(function (x) {
      return String(x.id) === String(n.id);
    });
    if (idx >= 0) {
      var prev = state.items[idx];
      state.items[idx] = {
        id: prev.id,
        title: n.title || prev.title,
        message: n.message || prev.message,
        is_read: n.is_read,
        created_at: n.created_at || prev.created_at,
        read_at: n.read_at || prev.read_at,
      };
      return false;
    }
    state.items.unshift(n);
    if (state.items.length > 120) state.items = state.items.slice(0, 120);
    return true;
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

  async function loadInitial(state) {
    if (!global.PlatformAPI || !PlatformAPI.api) return;
    var countRes = await PlatformAPI.api("/api/notifications/unread-count");
    state.unreadCount = Number((countRes && countRes.unread_count) || 0);
    var listRes = await PlatformAPI.api("/api/notifications");
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

  function markReadLocal(state, id) {
    var foundUnread = false;
    state.items = state.items.map(function (n) {
      if (String(n.id) !== String(id)) return n;
      if (!n.is_read) foundUnread = true;
      return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
    });
    if (foundUnread) state.unreadCount = Math.max(0, (Number(state.unreadCount) || 0) - 1);
  }

  function wireEvents(state) {
    state.root.addEventListener("click", async function (ev) {
      var bell = ev.target.closest("#" + state.id + "-bell");
      if (bell) {
        state.open = !state.open;
        render(state);
        return;
      }
      var markAll = ev.target.closest("#" + state.id + "-all");
      if (markAll) {
        if (!global.PlatformAPI || !PlatformAPI.api) return;
        markAll.disabled = true;
        try {
          await PlatformAPI.api("/api/notifications/read-all", { method: "POST" });
          state.items = state.items.map(function (n) {
            return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
          });
          state.unreadCount = 0;
          render(state);
        } catch (_) {
          render(state);
        }
        return;
      }
      var item = ev.target.closest(".erv-notification-item[data-id]");
      if (!item) return;
      var id = item.getAttribute("data-id");
      if (!id || !global.PlatformAPI || !PlatformAPI.api) return;
      markReadLocal(state, id);
      render(state);
      try {
        await PlatformAPI.api("/api/notifications/read/" + encodeURIComponent(id), { method: "POST" });
      } catch (_) {}
    });

    document.addEventListener("click", function (ev) {
      if (!state.open) return;
      if (state.root.contains(ev.target)) return;
      state.open = false;
      render(state);
    });
  }

  async function setupSocket(state) {
    if (!global.PlatformAPI || !PlatformAPI.getToken) return;
    var token = PlatformAPI.getToken();
    if (!token) return;
    await ensureSocketIoScript();
    if (typeof global.io !== "function") return;
    if (state.socket) return;
    state.socket = global.io({
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      auth: { token: token },
    });
    state.socket.on("notification:new", function (payload) {
      var added = addOrUpdateItem(state, payload);
      if (added && !(payload && payload.is_read)) {
        state.unreadCount = (Number(state.unreadCount) || 0) + 1;
      } else {
        refreshUnreadCountFromItems(state);
      }
      render(state);
      pulse(state);
    });
    state.socket.on("notification:read", function (payload) {
      if (!payload) return;
      if (payload.id) {
        markReadLocal(state, payload.id);
      } else if (payload.ids && Array.isArray(payload.ids)) {
        payload.ids.forEach(function (id) {
          markReadLocal(state, id);
        });
      } else if (payload.all) {
        state.items = state.items.map(function (n) {
          return Object.assign({}, n, { is_read: true, read_at: n.read_at || new Date().toISOString() });
        });
        state.unreadCount = 0;
      }
      refreshUnreadCountFromItems(state);
      render(state);
    });
  }

  async function mount(opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var mountEl =
      typeof opts.mount === "string" ? document.querySelector(opts.mount) : opts.mount && opts.mount.nodeType === 1 ? opts.mount : null;
    if (!mountEl) return null;
    var key = opts.key || mountEl.id || "default";
    if (INSTANCES[key]) return INSTANCES[key].api;

    var state = {
      id: "ervNotif" + Math.random().toString(36).slice(2, 8),
      key: key,
      root: mountEl,
      items: [],
      unreadCount: 0,
      open: false,
      socket: null,
    };
    INSTANCES[key] = { state: state, api: { refresh: refresh } };

    function refresh() {
      return loadInitial(state)
        .then(function () {
          render(state);
          return setupSocket(state);
        })
        .catch(function () {
          render(state);
          return setupSocket(state);
        });
    }

    render(state);
    wireEvents(state);
    await refresh();
    return INSTANCES[key].api;
  }

  global.ErvenowNotificationCenter = {
    mount: mount,
  };
})(window);
