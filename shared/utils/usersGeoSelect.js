/**
 * استعلام users مع lat/lng — مع تراجع تلقائي إذا الأعمدة غير موجودة بعد.
 */

const USERS_GEO_MISSING_RE = /\busers\.lat\b|\busers\.lng\b|column users\.lat|column users\.lng/i;

function stripUsersGeoColumns(select) {
  return String(select || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "lat" && part !== "lng")
    .join(", ");
}

function isUsersGeoColumnError(error) {
  return USERS_GEO_MISSING_RE.test(String((error && error.message) || ""));
}

async function usersQueryResilient(sb, select, buildQuery, mode) {
  let q = sb.from("users").select(select);
  if (buildQuery) q = buildQuery(q);
  let result =
    mode === "single"
      ? await q.maybeSingle()
      : mode === "maybeSingle"
        ? await q.maybeSingle()
        : await q;

  if (result.error && isUsersGeoColumnError(result.error)) {
    const fallbackSelect = stripUsersGeoColumns(select);
    q = sb.from("users").select(fallbackSelect || "id");
    if (buildQuery) q = buildQuery(q);
    result =
      mode === "single" || mode === "maybeSingle" ? await q.maybeSingle() : await q;
  }
  return result;
}

module.exports = {
  USERS_GEO_MISSING_RE,
  stripUsersGeoColumns,
  isUsersGeoColumnError,
  usersQueryResilient,
};
