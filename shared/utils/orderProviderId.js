/**
 * مزود الخدمة على orders — SoT: provider_id
 * service_provider_id يُقرأ للتوافق فقط إن وُجد في DB.
 */

function getOrderProviderId(order) {
  if (!order) return null;
  return order.provider_id || order.service_provider_id || null;
}

/** للإدراج/التحديث — عمود واحد يقلّل أخطاء schema cache */
function applyProviderIdToPatch(patch, providerId) {
  if (!patch || providerId == null) return patch;
  const out = { ...patch, provider_id: providerId };
  return out;
}

function applyProviderIdToInsertRow(row, providerId) {
  const id = providerId != null ? providerId : row?.provider_id || row?.service_provider_id || null;
  if (!row) return row;
  const out = { ...row };
  if (id != null) out.provider_id = id;
  delete out.service_provider_id;
  return out;
}

module.exports = {
  getOrderProviderId,
  applyProviderIdToPatch,
  applyProviderIdToInsertRow,
};
