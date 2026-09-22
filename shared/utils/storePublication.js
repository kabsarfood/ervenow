/**
 * نشر المنشأة مستقل عن اعتماد الأدمن.
 * status = اعتماد الحساب (pending | needs_info | approved | rejected)
 * publication_status = ظهور الصفحة للعملاء (draft | published | paused)
 * is_active يبقى علماً تشغيلياً قديماً ولا يُستخدم وحده كبوابة نشر.
 */

const PUBLICATION_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  PAUSED: "paused",
});

const STORE_APPROVAL_STATUS = Object.freeze({
  PENDING: "pending",
  NEEDS_INFO: "needs_info",
  APPROVED: "approved",
  REJECTED: "rejected",
});

function normalizePublicationStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === PUBLICATION_STATUS.PUBLISHED || s === PUBLICATION_STATUS.DRAFT || s === PUBLICATION_STATUS.PAUSED) {
    return s;
  }
  return null;
}

function normalizeStoreApprovalStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (
    s === STORE_APPROVAL_STATUS.PENDING ||
    s === STORE_APPROVAL_STATUS.NEEDS_INFO ||
    s === STORE_APPROVAL_STATUS.APPROVED ||
    s === STORE_APPROVAL_STATUS.REJECTED
  ) {
    return s;
  }
  return s || "";
}

function storeHasOfficialCoords(row) {
  if (!row) return false;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * ظهور عام في /restaurants و /stores والخريطة العامة.
 * منشأة جديدة: معتمدة + published.
 * إرث بلا publication_status: معتمدة وغير معطّلة (is_active !== false).
 */
function storeRowIsListedActive(row) {
  if (!row) return false;
  if (normalizeStoreApprovalStatus(row.status) !== STORE_APPROVAL_STATUS.APPROVED) return false;
  if (Object.prototype.hasOwnProperty.call(row, "is_active") && row.is_active === false) return false;
  const pub = normalizePublicationStatus(row.publication_status);
  if (pub === PUBLICATION_STATUS.DRAFT || pub === PUBLICATION_STATUS.PAUSED) return false;
  if (pub === PUBLICATION_STATUS.PUBLISHED) return true;
  return true;
}

function storeRowIsMerchantManageable(row) {
  if (!row) return false;
  return normalizeStoreApprovalStatus(row.status) === STORE_APPROVAL_STATUS.APPROVED;
}

function storeRowNeedsCompletion(row) {
  if (!storeRowIsMerchantManageable(row)) return false;
  const pub = normalizePublicationStatus(row.publication_status);
  return pub !== PUBLICATION_STATUS.PUBLISHED;
}

function storeRowIsReopenableOnboarding(row) {
  const st = normalizeStoreApprovalStatus(row && row.status);
  return st === STORE_APPROVAL_STATUS.PENDING || st === STORE_APPROVAL_STATUS.NEEDS_INFO;
}

function approveStorePatch() {
  return {
    status: STORE_APPROVAL_STATUS.APPROVED,
    is_active: true,
    publication_status: PUBLICATION_STATUS.DRAFT,
    needs_info_message: null,
  };
}

function rejectStorePatch() {
  return {
    status: STORE_APPROVAL_STATUS.REJECTED,
    is_active: false,
    publication_status: PUBLICATION_STATUS.DRAFT,
  };
}

function needsInfoStorePatch(message) {
  return {
    status: STORE_APPROVAL_STATUS.NEEDS_INFO,
    is_active: false,
    publication_status: PUBLICATION_STATUS.DRAFT,
    needs_info_message: String(message || "").trim() || null,
    needs_info_at: new Date().toISOString(),
  };
}

function resubmitOnboardingPatch() {
  return {
    status: STORE_APPROVAL_STATUS.PENDING,
    is_active: false,
    publication_status: PUBLICATION_STATUS.DRAFT,
    needs_info_message: null,
  };
}

function publishStorePatch() {
  return {
    publication_status: PUBLICATION_STATUS.PUBLISHED,
    is_active: true,
  };
}

function facilityCategoryOk(store) {
  if (!store) return false;
  const type = String(store.type || "")
    .trim()
    .toLowerCase();
  const cat = String(store.category || "")
    .trim()
    .toLowerCase();
  if (type === "restaurant") {
    return !!(cat && cat !== "restaurant");
  }
  return !!(type || cat);
}

function identityOk(store, hub) {
  const logo = store && String(store.logo_url || "").trim();
  const banner = hub && String(hub.banner_url || "").trim();
  return !!(logo || banner);
}

function availableSellableProduct(products) {
  const list = Array.isArray(products) ? products : [];
  return list.find((p) => {
    if (!p) return false;
    if (p.active === false) return false;
    const name = String(p.name || "").trim();
    const price = Number(p.price);
    return !!(name && Number.isFinite(price) && price > 0);
  });
}

function validatePublishReadiness(store, hub, products) {
  const sellable = availableSellableProduct(products);
  const checks = [
    {
      key: "name",
      ok: !!(store && String(store.name || "").trim().length >= 2),
      label: "اسم المنشأة",
    },
    {
      key: "location",
      ok: storeHasOfficialCoords(store),
      label: "الموقع",
    },
    {
      key: "category",
      ok: facilityCategoryOk(store),
      label: "الفئة",
    },
    {
      key: "identity",
      ok: identityOk(store, hub),
      label: "الشعار أو الغلاف",
    },
    {
      key: "product",
      ok: !!sellable,
      label: "منتج واحد على الأقل",
    },
    {
      key: "price",
      ok: !!(sellable && Number(sellable.price) > 0),
      label: "سعر صحيح",
    },
    {
      key: "available",
      ok: !!(sellable && sellable.active !== false),
      label: "المنتج متاح",
    },
  ];
  return {
    ok: checks.every((c) => c.ok),
    checks,
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
  };
}

function appendSelectCols(sel, cols) {
  const parts = String(sel || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  (cols || []).forEach((c) => {
    if (c && parts.indexOf(c) < 0) parts.push(c);
  });
  return parts.join(",");
}

function isPublicationSchemaError(err) {
  if (!err) return false;
  return /publication_status|license_number|license_file_url|needs_info_message|needs_info_at|column .* does not exist|schema cache/i.test(
    String(err.message || err.details || "")
  );
}

module.exports = {
  PUBLICATION_STATUS,
  STORE_APPROVAL_STATUS,
  normalizePublicationStatus,
  normalizeStoreApprovalStatus,
  storeRowIsListedActive,
  storeRowIsMerchantManageable,
  storeRowNeedsCompletion,
  storeRowIsReopenableOnboarding,
  storeHasOfficialCoords,
  approveStorePatch,
  rejectStorePatch,
  needsInfoStorePatch,
  resubmitOnboardingPatch,
  publishStorePatch,
  validatePublishReadiness,
  appendSelectCols,
  isPublicationSchemaError,
  facilityCategoryOk,
  identityOk,
};
