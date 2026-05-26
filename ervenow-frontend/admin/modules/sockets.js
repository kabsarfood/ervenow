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

app.startAdminSocketFallbackPolling = function () {
  if (app.adminSocketFallbackTimer) return;
  app.adminSocketFallbackTimer = setInterval(function () {
    if (app.adminDashboardSocketConnected()) {
      clearInterval(app.adminSocketFallbackTimer);
      app.adminSocketFallbackTimer = null;
      return;
    }
    if (app.hasPermission("orders") && !app.adminDashboardSocketConnected()) {
      void app.silentLoadRecentOrdersForRealtime();
    }
    void app.refreshLiveDriversAndMap();
  }, 10000);
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
    app.ensureLiveMap();
    app.syncLiveMapMarkers();
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
