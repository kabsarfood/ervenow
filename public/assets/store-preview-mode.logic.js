function isActive(search) {
  try {
    var params =
      search != null
        ? new URLSearchParams(String(search).replace(/^\?/, ""))
        : new URLSearchParams("");
    var v = String(params.get("preview") || "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  } catch (e) {
    return false;
  }
}

function appendToStoreUrl(url) {
  var u = String(url || "").trim();
  if (!u) return u;
  if (/[?&]preview=/.test(u)) return u;
  return u + (u.indexOf("?") >= 0 ? "&" : "?") + "preview=1";
}

module.exports = {
  isActive,
  appendToStoreUrl,
};
