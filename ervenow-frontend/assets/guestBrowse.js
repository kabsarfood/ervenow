(function () {
  var KEY = "ervenow_guest_browse";

  window.ErvenowGuestBrowse = {
    STORAGE_KEY: KEY,

    isActive: function () {
      try {
        return localStorage.getItem(KEY) === "1";
      } catch (e) {
        return false;
      }
    },

    setActive: function (on) {
      try {
        if (on) localStorage.setItem(KEY, "1");
        else localStorage.removeItem(KEY);
      } catch (e) {}
    },

    hasSessionToken: function () {
      try {
        return !!(
          localStorage.getItem("token") ||
          localStorage.getItem("ervenow_access_token") ||
          localStorage.getItem("erwenow_access_token")
        );
      } catch (e) {
        return false;
      }
    },

    /** زائر يتصفح بدون حساب — لا يستطيع الطلب حتى يسجّل */
    isAnonymousGuest: function () {
      return this.isActive() && !this.hasSessionToken();
    },
  };
})();
