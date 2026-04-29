/**
 * ترميز TLV لـ ZATCA (B2C مبسّط) — الحمولة بصيغة base64 تُوضَع داخل رمز QR.
 * طول القيمة بالبايت (UTF-8) لدعم الأسماء العربية.
 */
function toTLV(tag, value) {
  const s = String(value);
  const valBuf = Buffer.from(s, "utf8");
  if (valBuf.length > 255) {
    throw new Error("TLV value exceeds 255 bytes");
  }
  const tagBuf = Buffer.from([tag]);
  const lenBuf = Buffer.from([valBuf.length]);
  return Buffer.concat([tagBuf, lenBuf, valBuf]);
}

/**
 * @param {object} p
 * @param {string} p.seller
 * @param {string} p.vat
 * @param {string} p.timestamp
 * @param {number} p.total
 * @param {number} p.vatTotal
 */
function buildSaudiQR({ seller, vat, timestamp, total, vatTotal }) {
  const tlv = Buffer.concat([
    toTLV(1, seller),
    toTLV(2, vat),
    toTLV(3, timestamp),
    toTLV(4, total.toFixed(2)),
    toTLV(5, vatTotal.toFixed(2)),
  ]);
  return tlv.toString("base64");
}

module.exports = { toTLV, buildSaudiQR };
