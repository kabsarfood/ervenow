const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const {
  insertDeliveryOrderWithRetry,
  calcPlatformFee,
  calcDriverEarning,
  calcVAT,
  resolveStoreSnapshotForOrder,
} = require("../delivery/service");
const { pushToErvenow } = require("../../shared/utils/ervenowPush");

const router = express.Router();

router.get("/health", (_req, res) => ok(res, { service: "food" }));

router.get("/menu", requireAuth, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from("food_menu_items")
      .select("*")
      .eq("active", true)
      .order("name");

    if (error) {
      return ok(res, {
        items: [
          { id: "demo-1", name: "وجبة عربية", price: 35 },
          { id: "demo-2", name: "مشروبات", price: 8 },
        ],
        note: "استخدم جدول food_menu_items في Supabase لعرض قائمة حقيقية",
      });
    }
    ok(res, { items: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.post("/menu", requireAuth, requireRole("restaurant", "admin"), async (req, res) => {
  try {
    const { name, price } = req.body || {};
    if (!name) return fail(res, "name required");
    const { data, error } = await req.supabase
      .from("food_menu_items")
      .insert({ name, price: Number(price) || 0, active: true })
      .select()
      .single();
    if (error) return fail(res, error.message, 400);
    ok(res, { item: data });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

router.get("/orders", requireAuth, async (req, res) => {
  try {
    let q = req.supabase.from("food_orders").select("*").order("created_at", { ascending: false });
    if (req.appUser.role === "customer") q = q.eq("customer_id", req.appUser.id);
    const { data, error } = await q;
    if (error) return fail(res, error.message, 400);
    ok(res, { orders: data || [] });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

/** إنشاء طلب مطعم + ربط طلب توصيل */
router.post("/orders", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const isDelivery = body.type === "delivery" || !!body.address || !!body.drop_address;
    const items = body.items || [];
    const total = Number(body.total) || 0;
    const dropAddress = body.address || body.drop_address || "";

    const { data: foodRow, error: fe } = await req.supabase
      .from("food_orders")
      .insert({
        customer_id: req.appUser.id,
        items,
        total,
        status: "new",
      })
      .select()
      .single();

    if (fe) return fail(res, fe.message, 400);

    const extraNotes = String(body.notes || "").trim();
    const delNotes = extraNotes
      ? `طلب مطعم #${foodRow.id} — ${extraNotes}`
      : `طلب مطعم #${foodRow.id}`;

    let delRow = null;
    if (isDelivery) {
      const orderTotal = Math.max(0, total);
      const deliveryFee = 0;
      const subtotal = orderTotal + deliveryFee;
      const vatAmount = calcVAT(subtotal);
      const totalWithVAT = Math.round((subtotal + vatAmount) * 100) / 100;
      const platformFee = calcPlatformFee(orderTotal);
      const driverEarning = calcDriverEarning(deliveryFee);

      const storeIdRaw = body.store_id != null ? String(body.store_id).trim() : "";
      const store_id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeIdRaw)
        ? storeIdRaw
        : null;
      let storeSnap = null;
      if (store_id) {
        storeSnap = await resolveStoreSnapshotForOrder(req.supabase, store_id);
      }
      const pickupDefault = storeSnap?.store_name ? String(storeSnap.store_name) : "مطعم كبسار";
      const pickupAddr =
        String(body.pickup_address || "").trim() ||
        (storeSnap && storeSnap.store_address ? storeSnap.store_address : pickupDefault);

      const { data, error: de } = await insertDeliveryOrderWithRetry(req.supabase, (order_number) => ({
        customer_id: req.appUser.id,
        customer_phone: body.customer_phone || req.appUser.phone || "",
        pickup_address: pickupAddr,
        drop_address: dropAddress,
        notes: delNotes,
        order_number,
        order_total: orderTotal,
        delivery_fee: deliveryFee,
        delivery_status: "pending",
        status: "new",
        platform_fee: platformFee,
        driver_earning: driverEarning,
        vat_amount: vatAmount,
        total_with_vat: totalWithVAT,
        ...(store_id
          ? {
              store_id,
              ...(storeSnap?.store_name ? { store_name: storeSnap.store_name } : {}),
              ...(storeSnap?.store_address ? { store_address: storeSnap.store_address } : {}),
            }
          : {}),
      }));
      if (de) return fail(res, de.message, 400);
      delRow = data || null;

      if (delRow && !delRow.delivery_status) {
        await req.supabase
          .from("orders")
          .update({ delivery_status: "pending" })
          .eq("id", delRow.id);
      }

      if (delRow) {
        console.log("PUSHING WEBSITE ORDER TO ERVENOW");
        await pushToErvenow({
          orderNumber: delRow.order_number || delRow.id,
          customerPhone: delRow.customer_phone || "",
          address: delRow.drop_address || dropAddress || "",
          total: delRow.order_total || 0,
          itemsText: delRow.notes || "",
        });
      }
    }

    const { data: linked, error: le } = await req.supabase
      .from("food_orders")
      .update({ delivery_order_id: delRow ? delRow.id : null })
      .eq("id", foodRow.id)
      .select()
      .single();

    if (le) return fail(res, le.message, 400);

    ok(res, { food_order: linked, delivery_order: delRow, is_delivery: isDelivery });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
