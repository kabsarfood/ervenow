(function (w) {
  var TOKEN_KEY = "erwenow_access_token";

  w.PlatformAPI = {
    getToken: function () {
      return localStorage.getItem(TOKEN_KEY) || "";
    },
    setToken: function (t) {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
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
