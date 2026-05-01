(function (w) {
  var TOKEN_KEY = "ervenow_access_token";
  var LEGACY_TOKEN_KEY = "erwenow_access_token";
  var FALLBACK_TOKEN_KEY = "token";

  w.PlatformAPI = {
    getToken: function () {
      try {
        var tok = localStorage.getItem(TOKEN_KEY);
        if (tok) return tok;
        var legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
        if (legacy) {
          localStorage.setItem(TOKEN_KEY, legacy);
          localStorage.setItem(FALLBACK_TOKEN_KEY, legacy);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
          return legacy;
        }
        var fallback = localStorage.getItem(FALLBACK_TOKEN_KEY);
        if (fallback) {
          localStorage.setItem(TOKEN_KEY, fallback);
          return fallback;
        }
        return "";
      } catch (e) {
        return "";
      }
    },
    setToken: function (t) {
      try {
        if (t) {
          localStorage.setItem(TOKEN_KEY, t);
          localStorage.setItem(FALLBACK_TOKEN_KEY, t);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
          localStorage.removeItem(FALLBACK_TOKEN_KEY);
        }
      } catch (e) {}
    },
    api: async function (path, opts) {
      opts = opts || {};
      var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      var tok = w.PlatformAPI.getToken();
      if (tok) headers.Authorization = "Bearer " + tok;
      var url = path.indexOf("/") === 0 ? path : "/" + path;
      var body = opts.body;
      if (body && typeof body === "object" && !(body instanceof FormData)) {
        body = JSON.stringify(body);
      }
      var r = await fetch(
        url,
        Object.assign({}, opts, { headers: headers, body: body })
      );
      var j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) throw new Error(j.error || j.message || String(r.status));
      return j;
    },
  };
})(window);
