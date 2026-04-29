const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { buildSaudiQR } = require("../../shared/utils/saudiQr");

/**
 * @param {object} order صف orders (بعد إصدار الفاتورة)
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(order) {
  const issued = order.invoice_issued_at ? new Date(order.invoice_issued_at) : new Date();
  const totalWithVat = Number(order.total_with_vat) || 0;
  const vatAmt = Number(order.vat_amount) || 0;
  const subtotal = Math.round((totalWithVat - vatAmt) * 100) / 100;
  const seller = String(order.seller_name || "ERVENOW").trim() || "ERVENOW";
  const vatReg = String(order.seller_vat_number || "0000000000").trim() || "0000000000";
  const ts = issued.toISOString();

  const qrPayload = buildSaudiQR({
    seller,
    vat: vatReg,
    timestamp: ts,
    total: totalWithVat,
    vatTotal: vatAmt,
  });

  const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, width: 200 });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const qrBuffer = Buffer.from(qrBase64, "base64");

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica");
    doc.fontSize(16).text("Tax Invoice / فاتورة ضريبية", { align: "right" });
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Invoice No. / رقم الفاتورة: ${order.invoice_number || "—"}`, { align: "right" });
    doc.text(`Date / التاريخ: ${issued.toISOString().slice(0, 10)}  ${ts.slice(11, 19)}Z`, { align: "right" });
    doc.moveDown(0.5);
    doc.text(`Subtotal (goods + delivery) / المجموع قبل الضريبة: ${subtotal.toFixed(2)} SAR`, { align: "right" });
    doc.text(`VAT (15%) / ضريبة القيمة المضافة: ${vatAmt.toFixed(2)} SAR`, { align: "right" });
    doc.text(`Total with VAT / الإجمالي: ${totalWithVat.toFixed(2)} SAR`, { align: "right" });
    doc.moveDown(0.5);
    doc.text(`Seller / البائع: ${seller}`, { align: "right" });
    doc.text(`VAT registration / الرقم الضريبي: ${vatReg}`, { align: "right" });
    doc.text(`Order ref. / مرجع الطلب: ${order.order_number || order.id}`, { align: "right" });
    doc.moveDown(0.5);
    doc.text("ZATCA QR (TLV payload as Base64, encoded in this image)", { align: "left" });
    const qrY = doc.y + 8;
    doc.image(qrBuffer, 50, qrY, { width: 120 });
    doc.end();
  });
}

module.exports = { generateInvoicePdf };
