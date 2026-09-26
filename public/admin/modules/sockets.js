/** Admin Dashboard — sockets */
import { app } from "./shared.js";
import "./api.js";

app.adminDashboardSocketConnected = function () {
  return !!(app.adminSocket && app.adminSocket.connected);
}

app.getAdminSocketOrigin = function () {
  var base = "";
  if (window.__ERVENOW_API_BASE__ != null) {
    base = String(window.__ERVENOW_API_BASE__).trim().replace(/\/$/, "");
  }
  if (base && /^https?:\/\//i.test(base)) return base;
  return window.location.origin;
}

app.runAdminSocketFallbackTick = function () {
  if (document.hidden || app.adminFallbackBusy) return;
  if (app.adminDashboardSocketConnected()) {
    if (app.adminSocketFallbackTimer) {
      clearInterval(app.adminSocketFallbackTimer);
      app.adminSocketFallbackTimer = null;
    }
    return;
  }
  app.adminFallbackBusy = true;
  var pending = [];
  if (app.hasPermission("orders")) {
    pending.push(Promise.resolve(app.silentLoadRecentOrdersForRealtime()));
  }
  pending.push(Promise.resolve(app.refreshLiveDriversAndMap()));
  Promise.all(pending).finally(function () {
    app.adminFallbackBusy = false;
  });
}

app.startAdminSocketFallbackPolling = function () {
  if (app.adminSocketFallbackTimer || document.hidden) return;
  app.adminSocketFallbackTimer = setInterval(app.runAdminSocketFallbackTick, 10000);
}

if (!app.adminFallbackVisibilityBound) {
  app.adminFallbackVisibilityBound = true;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (app.adminSocketFallbackTimer) {
        clearInterval(app.adminSocketFallbackTimer);
        app.adminSocketFallbackTimer = null;
      }
      return;
    }
    if (!app.adminDashboardSocketConnected()) {
      app.runAdminSocketFallbackTick();
      app.startAdminSocketFallbackPolling();
    }
  });
}

app.initAdminDashboardSocket = function () {
  if (typeof io === "undefined") {
    app.startAdminSocketFallbackPolling();
    return;
  }
  var tok = app.PlatformAPI && typeof app.PlatformAPI.getToken === "function" ? app.PlatformAPI.getToken() : "";
  if (!tok) return;
  var API_ORIGIN = app.getAdminSocketOrigin();
  try {
    app.adminSocket = io(API_ORIGIN, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      auth: { token: tok },
    });
  } catch (_e) {
    app.startAdminSocketFallbackPolling();
    return;
  }
  app.adminSocket.on("connect", function () {
    if (app.adminSocketFallbackTimer) {
      clearInterval(app.adminSocketFallbackTimer);
      app.adminSocketFallbackTimer = null;
    }
    app.updateLiveSocketPulse();
    app.adminRealtimeJoinTrackedOrders();
    app.initAdminLiveStoreMap();
    void app.refreshLiveDriversAndMap();
  });
  app.adminSocket.on("connect_error", function () {
    app.updateLiveSocketPulse();
    app.startAdminSocketFallbackPolling();
  });
  app.adminSocket.on("disconnect", function () {
    app.updateLiveSocketPulse();
    app.startAdminSocketFallbackPolling();
  });
  app.adminSocket.on("order:patch", handleAdminOrderPatch);
  app.adminSocket.on("order:live", handleAdminOrderLive);
  app.adminSocket.on("driver:update", handleAdminDriverUpdate);
}
