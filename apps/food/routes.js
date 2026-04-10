const express = require("express");
const { requireAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");

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
    const items = body.items || [];
    const total = Number(body.total) || 0;
    const drop_address = body.drop_address || body.address || "";

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

    const { data: delRow, error: de } = await req.supabase
      .from("delivery_orders")
      .insert({
        customer_id: req.appUser.id,
        customer_phone: req.appUser.phone,
        pickup_address: body.pickup_address || "المطعم",
        drop_address,
        notes: delNotes,
        status: "new",
      })
      .select()
      .single();

    if (de) return fail(res, de.message, 400);

    const { data: linked, error: le } = await req.supabase
      .from("food_orders")
      .update({ delivery_order_id: delRow.id })
      .eq("id", foodRow.id)
      .select()
      .single();

    if (le) return fail(res, le.message, 400);

    ok(res, { food_order: linked, delivery_order: delRow });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
