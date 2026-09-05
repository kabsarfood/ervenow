/**
 * stores.category قد يكون slug واحداً أو عدة slugs مفصولة بفاصلة.
 */

function parseStoreCategorySlugs(raw) {
  const out = [];
  const seen = Object.create(null);
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[,|]+/);
  parts.forEach(function (part) {
    const s = String(part || "")
      .trim()
      .toLowerCase();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}

function joinStoreCategorySlugs(slugs) {
  return parseStoreCategorySlugs(slugs).join(",");
}

function storeCategoryHasSlug(raw, slug) {
  const want = String(slug || "")
    .trim()
    .toLowerCase();
  if (!want) return false;
  return parseStoreCategorySlugs(raw).indexOf(want) !== -1;
}

function firstStoreCategorySlug(raw) {
  const list = parseStoreCategorySlugs(raw);
  return list.length ? list[0] : "";
}

function collectCategoryInputs(body, keys) {
  const out = [];
  const seen = Object.create(null);
  function push(v) {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    parseStoreCategorySlugs(v).forEach(function (s) {
      if (seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
  }
  (keys || []).forEach(function (k) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) push(body[k]);
  });
  return out;
}

module.exports = {
  parseStoreCategorySlugs,
  joinStoreCategorySlugs,
  storeCategoryHasSlug,
  firstStoreCategorySlug,
  collectCategoryInputs,
};
