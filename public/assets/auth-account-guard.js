/**
 * حماية الصفحات المحمية: جلسة + حساب معتمد (active).
 * يُستدعى من dashboard / wallet / orders / store-dashboard / services-provider.
 */
(function (global) {
  function clearSession() {
    try {
      if (global.PlatformAPI && typeof global.PlatformAPI.setToken === "function") {
        global.PlatformAPI.setToken("");
      }
      localStorage.removeItem("token");
      localStorage.removeItem("userId");
      localStorage.removeItem("userPhone");
      localStorage.removeItem("ervenow_access_token");
      localStorage.removeItem("erwenow_access_token");
    } catch (e) {}
    try {
      document.cookie = "auth_token=; path=/; max-age=0; SameSite=Lax";
    } catch (e2) {}
  }

  function isApprovedMe(me) {
    if (!me || typeof me !== "object") return false;
    if (me.approved === true) return true;
    if (me.pending_approval === true) return false;
    var st = String((me.profile && me.profile.status) || "").toLowerCase();
    if (st === "active") return true;
    if (st === "pending" || st === "rejected" || st === "blocked") return false;
    return me.approved !== false;
  }

  async function ensureApprovedAccount(options) {
    options = options || {};
    var loginUrl = options.loginUrl || "/login";
    var pendingUrl = options.pendingUrl || "/pending-approval.html";

    if (!global.PlatformAPI || typeof global.PlatformAPI.getToken !== "function") {
      global.location.replace(loginUrl);
      return null;
    }
    if (!global.PlatformAPI.getToken()) {
      global.location.replace(loginUrl);
      return null;
    }

    try {
      var me = await global.PlatformAPI.api("/api/core/me");
      if (!isApprovedMe(me)) {
        clearSession();
        global.location.replace(pendingUrl);
        return null;
      }
      return me;
    } catch (e) {
      var msg = String((e && e.message) || e || "");
      if (/401|403|Missing Authorization|Invalid or expired|بانتظار موافقة|قيد المراجعة|pending/i.test(msg)) {
        clearSession();
        global.location.replace(/بانتظار|قيد المراجعة|pending|403/i.test(msg) ? pendingUrl : loginUrl);
        return null;
      }
      if (options.softFail) return null;
      throw e;
    }
  }

  global.ErvenowAuthGuard = {
    ensureApprovedAccount: ensureApprovedAccount,
    clearSession: clearSession,
    isApprovedMe: isApprovedMe,
  };
})(window);
