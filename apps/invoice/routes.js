const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { buildInvoiceNumber } = require("../delivery/service");
const { generateInvoicePdf } = require("./service");
const { fail } = require("../../shared/utils/helpers");

const router = express.Router();

function sellerConfig() {
  return {
    name: String(process.env.ERVENOW_SELLER_NAME || "ERVENOW").trim() || "ERVENOW",
    vat: String(
      process.env.ERVENOW_SELLER_VAT_NUMBER || process.env.SELLER_VAT_NUMBER || ""
    )
      .trim() || "0000000000",
  };
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "invoice" });
});

/**
 * PDF فاتورة — زائر المنصة صاحب الطلب أو admin فقط.
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { data: row, error: fetchErr } = await req.supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !row) {
      return res.status(404).json({ ok: false });
    }

    const u = req.appUser;
    if (u.role === "admin") {
      // ok
    } else if (u.role === "customer" && row.customer_id === u.id) {
      // ok
    } else {
      return res.status(403).type("text/plain").send("Forbidden");
    }

    let order = { ...row };
    if (!order.invoice_number) {
      const { name: sellerName, vat: sellerVat } = sellerConfig();
      const inv = buildInvoiceNumber();
      const at = new Date().toISOString();
      const { data: updated, error: upErr } = await req.supabase
        .from("orders")
        .update({
          invoice_number: inv,
          invoice_issued_at: at,
          seller_name: sellerName,
          seller_vat_number: sellerVat,
          updated_at: at,
        })
        .eq("id", id)
        .is("invoice_number", null)
        .select()
        .single();

      if (upErr) {
        console.error("[invoice] first issue update:", upErr);
      }
      if (updated) {
        order = updated;
      } else {
        const { data: again } = await req.supabase.from("orders").select("*").eq("id", id).single();
        if (again) order = again;
        else {
          order.invoice_number = inv;
          order.invoice_issued_at = at;
          order.seller_name = sellerName;
          order.seller_vat_number = sellerVat;
        }
      }
    } else {
      if (!order.seller_name) order.seller_name = sellerConfig().name;
      if (!order.seller_vat_number) order.seller_vat_number = sellerConfig().vat;
    }

    if (!order.invoice_issued_at) {
      order.invoice_issued_at = new Date().toISOString();
    }

    const pdf = await generateInvoicePdf(order);

    const base = String(process.env.ERVENOW_PUBLIC_URL || "")
      .trim()
      .replace(/\/$/, "");
    const path = `/api/invoice/${order.id}`;
    const url = base ? `${base}${path}` : path;
    const { error: urlErr } = await req.supabase
      .from("orders")
      .update({
        invoice_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    if (urlErr) {
      console.error("[invoice] invoice_url update:", urlErr.message || urlErr);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice-${String(order.invoice_number || id).replace(/[^a-zA-Z0-9-_.]/g, "_")}.pdf"`
    );
    return res.status(200).send(pdf);
  } catch (e) {
    console.error("[invoice] GET /:id", e);
    if (!res.headersSent) {
      fail(res, e.message || "error", 500);
    }
  }
});

module.exports = router;
