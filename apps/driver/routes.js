const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("../../shared/middleware/auth");
const { getJwtSecret } = require("../../shared/middleware/auth");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { sendWhatsApp } = require("../../shared/utils/whatsapp");
const { driverPendingRegistrationBody } = require("../../shared/messages/driverWhatsApp");
const { createServiceClient } = require("../../shared/config/supabase");
const { notifyDriver } = require("./notify");
const { bumpDeliveryOrdersListEpoch } = require("../../shared/utils/deliveryOrdersListCache");
const { patchUnifiedOrderStatus } = require("../../shared/services/unifiedOrderStatus");
const { setDeprecationHeaders, UNIFIED_ORDER_STATUS } = require("../../shared/middleware/deprecateLegacyRoute");
const { requireRole } = require("../../shared/middleware/roles");
const { getWalletPayloadWithLedgerFallback } = require("../../shared/utils/ledgerWallet");
const { getDriverFreezeFlags } = require("../../shared/services/autoFreeze");
const { assertDriverCanAcceptOrders } = require("../../shared/services/driverCommissionLedger");
const {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
} = require("../../shared/services/otpChallengeService");
const { isDevOtpBypassCode } = require("../../shared/utils/devOtpBypass");
const {
  sendOTP,
  sendOrderAcceptedToCustomer,
  sendCustomerDeliveringNotice,
  sendDriverArrived,
} = require("../../shared/services/whatsappService");
const { notifyDriverUser } = require("../../shared/services/notificationEvents");
const {
  broadcastDriverUpdate,
  broadcastOrderPatch,
  broadcastOrderLive,
  orderPatchFromRow,
} = require("../../shared/lib/trackingSocket");
const { attachSiteSessionCookie } = require("../../shared/middleware/publicSiteOtpGate");
const { parseOptionalPayoutPayload, payoutRowForDriversOrStores } = require("../../shared/utils/payoutFields");
const { sanitizeDriverOrStoreRowForApi } = require("../../shared/utils/bankApiSafe");
const { filterDriverDispatchOrders } = require("../../shared/utils/driverDispatchOrders");
const { filterOrdersForPortal } = require("../../shared/utils/orderPortalRouting");
const { enrichDriverOrderRows } = require("../../shared/utils/orderDisplayFields");
const {
  DRIVER_COMPLETED_ORDER_COLUMNS,
  selectOrdersResilient,
} = require("../../shared/utils/ordersSchemaOptional");
const {
  isMerchantDispatchOrder,
  isLegacyOpenOrderForDriver,
  isReadyQueueOrderForDriver,
} = require("../../shared/utils/driverStoreHandoff");
const { getOrderDeliveryStatus } = require("../../shared/domain/orders/orderStatus");
const {
  assertPayoutIbanGloballyAvailable,
  iqamaDigitsNormalized,
  ibanFingerprintFromPlain,
  stripIban,
} = require("../../shared/utils/payoutUniqueness");

const router = express.Router();

router.use((req, res, next) => {
  const sb = createServiceClient();
  if (!sb) {
    return res.status(503).json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY مطلوب للمصادقة عبر المنصة",
    });
  }
  req.supabase = sb;
  next();
});

const OTP_TTL_MS = 5 * 60 * 1000;

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  return req.ip ? String(req.ip).slice(0, 128) : null;
}

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function nowIso() {
  return new Date().toISOString();
}

function isMissingStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

function signDriverToken(userId, phoneDigits) {
  const secret = getJwtSecret();
  return jwt.sign({ sub: userId, phone: phoneDigits, role: "driver" }, secret, {
    expiresIn: "7d",
  });
}

/** وضع التطوير فقط — لا يُستدعى إلا مع رمز تجاوز OTP */
async function ensureDriverForDevLogin(sb, phoneDigits) {
  let { data: drv, error } = await sb
    .from("drivers")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (error) throw error;
  if (!drv) {
    const stub = {
      name: "مندوب (وضع تطوير)",
      phone: phoneDigits,
      iqama: "DEV" + String(phoneDigits).slice(-7),
      car_type: "car",
      plate_number: "DEV",
      status: "approved",
      active: true,
    };
    const ins = await sb.from("drivers").upsert(stub, { onConflict: "phone" }).select().single();
    if (ins.error) throw ins.error;
    return ins.data;
  }
  const upd = await sb
    .from("drivers")
    .update({ status: "approved", active: true, updated_at: nowIso() })
    .eq("id", drv.id)
    .select()
    .single();
  if (!upd.error && upd.data) return upd.data;
  return { ...drv, status: "approved", active: true };
}

async function getApprovedDriverByPhone(sb, phoneDigits) {
  const { data, error } = await sb
    .from("drivers")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (String(data.status || "") !== "approved" || data.active !== true) return null;
  return data;
}

async function ensureApprovedDriver(req, res) {
  const phone = String(req.appUser?.phone || "").replace(/\D/g, "");
  if (!phone) {
    fail(res, "بيانات المندوب غير صالحة", 403);
    return null;
  }
  const drv = await getApprovedDriverByPhone(req.supabase, phone);
  if (!drv) {
    fail(res, "الحساب غير مفعل من الإدارة", 403);
    return null;
  }
  return drv;
}

async function upsertDriverUser(sb, phoneDigits) {
  let existing = null;
  let selErr = null;
  const firstSel = await sb
    .from("users")
    .select("*")
    .eq("phone", phoneDigits)
    .maybeSingle();
  if (firstSel.error && isMissingStatusColumnError(firstSel.error)) {
    const fallbackSel = await sb
      .from("users")
      .select("id, role, phone, updated_at")
      .eq("phone", phoneDigits)
      .maybeSingle();
    existing = fallbackSel.data || null;
    selErr = fallbackSel.error || null;
  } else {
    existing = firstSel.data || null;
    selErr = firstSel.error || null;
  }
  if (selErr) throw selErr;
  if (existing && existing.id) {
    if (
      String(existing.status || "").toLowerCase() === "blocked" ||
      String(existing.role || "").toLowerCase() === "blocked"
    ) {
      throw new Error("الحساب محظور من الإدارة");
    }
    const withStatusUpdate = await sb
      .from("users")
      .update({ role: "driver", status: "active", updated_at: nowIso() })
      .eq("id", existing.id)
      .select()
      .single();
    if (!withStatusUpdate.error) return withStatusUpdate.data;
    if (!isMissingStatusColumnError(withStatusUpdate.error)) throw withStatusUpdate.error;
    const fallbackUpdate = await sb
      .from("users")
      .update({ role: "driver", updated_at: nowIso() })
      .eq("id", existing.id)
      .select()
      .single();
    if (fallbackUpdate.error) throw fallbackUpdate.error;
    return fallbackUpdate.data;
  }
  const withStatusInsert = await sb
    .from("users")
    .insert({ phone: phoneDigits, role: "driver", status: "active", updated_at: nowIso() })
    .select()
    .single();
  if (!withStatusInsert.error) return withStatusInsert.data;
  if (!isMissingStatusColumnError(withStatusInsert.error)) throw withStatusInsert.error;
  const fallbackInsert = await sb
    .from("users")
    .insert({ phone: phoneDigits, role: "driver", updated_at: nowIso() })
    .select()
    .single();
  if (fallbackInsert.error) throw fallbackInsert.error;
  return fallbackInsert.data;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toNumberOrNaN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

router.post("/send-otp", async (req, res) => {
  try {
    const e164 = toE164(req.body?.phone);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) {
      return fail(res, "رقم الجوال غير صالح", 400);
    }
    const digits = toStorageDigits(e164);
    const code = genOtp();
    const mode = otpBackendMode();
    const started = await startOtpChallenge({
      sb: req.supabase,
      mode,
      scope: OTP_SCOPE.DRIVER_LOGIN,
      subjectKey: digits,
      code,
      ttlMs: OTP_TTL_MS,
      ip: clientIp(req),
    });
    if (!started.ok) {
      return fail(res, started.error || "تعذر إعداد رمز التحقق", started.cooldownSeconds ? 429 : 400, {
        cooldown_seconds: started.cooldownSeconds,
      });
    }

    let sent = false;
    try {
      sent = await sendOTP(digits, code, {
        contextLine: "المندوب",
        type: "otp_driver",
      });
    } catch (e) {
      sent = false;
    }

    if (!sent) {
      await invalidateOtpChallenge({
        sb: req.supabase,
        mode: otpBackendMode(),
        scope: OTP_SCOPE.DRIVER_LOGIN,
        subjectKey: digits,
      });
    }

    return res.json({ ok: true, sent });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const e164 = toE164(req.body?.phone);
    const code = String(req.body?.code || "").trim();
    if (!e164 || !isErvnowSaudiMobileE164(e164)) return fail(res, "رقم الجوال غير صالح", 400);
    if (!code) return fail(res, "أدخل رمز الدخول", 400);
    const digits = toStorageDigits(e164);

    const mode = otpBackendMode();
    const checked = await verifyOtpChallenge({
      sb: req.supabase,
      mode,
      scope: OTP_SCOPE.DRIVER_LOGIN,
      subjectKey: digits,
      code,
    });
    if (!checked.ok) {
      const lockCase = /قفل|محاولات كثيرة/i.test(String(checked.error || ""));
      return fail(res, checked.error || "رمز غير صحيح أو منتهي", lockCase ? 429 : 400);
    }

    const { data: drv, error: dErr } = await req.supabase
      .from("drivers")
      .select("*")
      .eq("phone", digits)
      .maybeSingle();
    if (dErr) return fail(res, dErr.message, 400);
    if (!drv) return fail(res, "المندوب غير مسجل", 403);
    if (String(drv.status || "").toLowerCase() === "blocked") {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }
    if (String(drv.status || "") !== "approved" || drv.active !== true) {
      return fail(res, "الحساب بانتظار الموافقة أو موقوف", 403);
    }

    const user = await upsertDriverUser(req.supabase, digits);
    const token = signDriverToken(user.id, digits);
    attachSiteSessionCookie(req, res, token);
    return ok(res, {
      token,
      driver: sanitizeDriverOrStoreRowForApi({
        id: drv.id,
        name: drv.name,
        phone: drv.phone,
        car_type: drv.car_type,
        status: drv.status,
        bank_name: drv.bank_name,
        bank_country_code: drv.bank_country_code,
        bank_last4: drv.bank_last4,
        bank_verified: drv.bank_verified,
        stc_pay_phone: drv.stc_pay_phone,
        payout_crypto_interest: drv.payout_crypto_interest,
      }),
      profile: {
        id: user.id,
        role: "driver",
        phone: user.phone,
      },
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/register", async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const iqama = String(b.iqama || "").trim();
    const carType = String(b.car_type || "").trim();
    const plate = String(b.plate_number || "").trim();
    const e164 = toE164(b.phone);
    if (!name) return fail(res, "الاسم مطلوب", 400);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) return fail(res, "رقم الجوال غير صالح", 400);
    if (!iqama) return fail(res, "رقم الهوية / الإقامة مطلوب", 400);
    if (!carType) return fail(res, "نوع المركبة مطلوب", 400);
    if (!plate) return fail(res, "رقم اللوحة مطلوب", 400);
    const phone = toStorageDigits(e164);

    let extraPayout = {};
    let parsed = {};
    try {
      parsed = parseOptionalPayoutPayload({ payout: b.payout });
      if (parsed.iban) {
        await assertPayoutIbanGloballyAvailable(req.supabase, parsed.iban, {
          ownerPhonesDigits: [phone],
        });
      }
      extraPayout = payoutRowForDriversOrStores(parsed);
    } catch (pe) {
      return fail(res, pe.message || "بيانات الدفع غير صالحة", 400);
    }

    const iqama_digits = iqamaDigitsNormalized(iqama);
    if (iqama_digits) {
      const { data: iqDup, error: iqErr } = await req.supabase
        .from("drivers")
        .select("phone")
        .eq("iqama_digits", iqama_digits)
        .neq("phone", phone)
        .maybeSingle();
      const iqMsg = String(iqErr?.message || iqErr?.details || "");
      if (iqErr && !/iqama_digits|column|schema cache|does not exist/i.test(iqMsg)) {
        return fail(res, iqErr.message, 400);
      }
      if (!iqErr && iqDup) {
        return fail(res, "رقم الهوية / الإقامة مسجّل لمندوب آخر — لا يمكن استخدام نفس الرقم", 400);
      }
    }

    const row = {
      name,
      phone,
      iqama,
      iqama_digits: iqama_digits || null,
      car_type: carType,
      plate_number: plate,
      status: "pending",
      active: false,
      ...extraPayout,
    };

    const { data, error } = await req.supabase
      .from("drivers")
      .upsert(row, { onConflict: "phone" })
      .select()
      .single();
    if (error) {
      const em = String(error.message || error.details || "");
      if (/unique|duplicate|23505|uq_drivers_iqama|iqama_digits/i.test(em)) {
        return fail(res, "رقم الهوية / الإقامة مستخدم مسبقاً أو بيانات مكررة", 400);
      }
      if (/unique|duplicate|23505|phone/i.test(em)) {
        return fail(res, "رقم الجوال مسجّل مسبقاً كمندوب", 400);
      }
      return fail(res, error.message, 400);
    }

    if (parsed.iban) {
      try {
        const { data: ur, error: urErr } = await req.supabase.from("users").select("id").eq("phone", phone).maybeSingle();
        if (!urErr && ur?.id) {
          const fp = ibanFingerprintFromPlain(parsed.iban);
          await req.supabase
            .from("users")
            .update({
              iban: stripIban(parsed.iban),
              bank_name: parsed.bank_name || null,
              bank_country_code: parsed.bank_country_code || "SA",
              payout_iban_fingerprint: fp,
              updated_at: new Date().toISOString(),
            })
            .eq("id", ur.id);
        }
      } catch (syncErr) {
        console.warn("[driver/register] sync user payout:", syncErr && (syncErr.message || syncErr));
      }
    }
    try {
      await sendWhatsApp({
        to: phone,
        message: driverPendingRegistrationBody(name),
      });
    } catch (waErr) {
      console.error("[driver/register] WhatsApp:", waErr && (waErr.message || String(waErr)));
    }
    return ok(res, {
      driver: sanitizeDriverOrStoreRowForApi(data),
      message: "تم تسجيلك — بانتظار الموافقة",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

async function fetchDriverCompletedOrders(sb, driverId) {
  const result = await selectOrdersResilient(sb, DRIVER_COMPLETED_ORDER_COLUMNS, (q) =>
    q
      .eq("driver_id", driverId)
      .eq("delivery_status", "delivered")
      .order("updated_at", { ascending: false })
      .limit(12)
  );
  if (result.error) return { data: null, error: result.error };
  return { data: enrichDriverOrderRows(result.data || []), error: null };
}

router.get("/orders", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const driverId = req.appUser.id;
    const { data: assignedOrders, error: asErr } = await req.supabase
      .from("orders")
      .select("*")
      .eq("driver_id", driverId)
      .in("delivery_status", ["accepted", "picked", "picked_up", "delivering"])
      .order("created_at", { ascending: false });
    if (asErr) return fail(res, asErr.message, 400);

    const { data: openLegacy, error: opErr } = await req.supabase
      .from("orders")
      .select("*")
      .is("driver_id", null)
      .in("delivery_status", ["new", "pending"])
      .order("created_at", { ascending: false });
    if (opErr) return fail(res, opErr.message, 400);

    const { data: openReady, error: rdErr } = await req.supabase
      .from("orders")
      .select("*")
      .is("driver_id", null)
      .eq("delivery_status", "ready")
      .order("created_at", { ascending: false });
    if (rdErr) return fail(res, rdErr.message, 400);

    const { data: completedRecent, error: doneErr } = await fetchDriverCompletedOrders(req.supabase, driverId);
    if (doneErr) return fail(res, doneErr.message, 400);

    const { data: activeDrivers, error: drErr } = await req.supabase
      .from("drivers")
      .select("id, lat, lng")
      .eq("status", "approved")
      .eq("active", true);
    if (drErr) {
      console.error("[driver/orders] drivers location query failed:", drErr.message);
    }

    const activeList = (activeDrivers || []).filter((d) => Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)));
    const meId = String(drv.id || "");
    const meLat = toNumberOrNaN(drv.lat);
    const meLng = toNumberOrNaN(drv.lng);

    const legacyCandidates = filterDriverDispatchOrders(openLegacy || []).filter(isLegacyOpenOrderForDriver);
    const readyCandidates = filterDriverDispatchOrders(openReady || []).filter(isReadyQueueOrderForDriver);
    const openCandidates = [...legacyCandidates, ...readyCandidates];

    const visibleOpenOrders = openCandidates.filter((order) => {
      const orderLat = toNumberOrNaN(order.pickup_lat);
      const orderLng = toNumberOrNaN(order.pickup_lng);
      if (
        Number.isFinite(orderLat) &&
        Number.isFinite(orderLng) &&
        Number.isFinite(meLat) &&
        Number.isFinite(meLng) &&
        activeList.length
      ) {
        const nearest = activeList
          .map((d) => ({
            id: String(d.id || ""),
            dist: haversineKm(orderLat, orderLng, Number(d.lat), Number(d.lng)),
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 3);
        if (nearest.some((d) => d.id === meId)) notifyDriver(drv, order);
      }
      return true;
    });

    const activeAssigned = enrichDriverOrderRows(filterDriverDispatchOrders(assignedOrders || []));
    const visibleOpenEnriched = enrichDriverOrderRows(visibleOpenOrders);
    const finalOrders = filterOrdersForPortal(
      filterDriverDispatchOrders([...activeAssigned, ...visibleOpenEnriched]),
      "driver"
    );

    return ok(res, {
      orders: finalOrders,
      ready_queue: visibleOpenEnriched.filter(isReadyQueueOrderForDriver),
      legacy_open: visibleOpenEnriched.filter(isLegacyOpenOrderForDriver),
      active: activeAssigned.filter(
        (o) =>
          String(o.driver_id || "") === String(driverId) &&
          ["accepted", "picked", "picked_up", "delivering"].includes(getOrderDeliveryStatus(o))
      ),
      completed: completedRecent || [],
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/wallet", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const { listLedgerWalletTransactions } = require("../../shared/utils/ledgerWallet");
    const payload = await getWalletPayloadWithLedgerFallback(req.supabase, req.appUser.id, "driver");
    const freeze = await getDriverFreezeFlags(req.supabase, req.appUser.id);
    let last_transactions = [];
    try {
      last_transactions = await listLedgerWalletTransactions(req.supabase, req.appUser.id, "driver", 15);
      last_transactions = (last_transactions || []).map(function (t) {
        return { ...t, note: t.note || t.description || null };
      });
    } catch (_txErr) {}
    return ok(res, {
      ...payload,
      last_transactions,
      is_frozen: freeze.is_frozen,
      warning: freeze.warning,
      setup_required: !!payload.setup_required,
      message: payload.message || null,
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

function earningsRangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === "week") start.setDate(start.getDate() - 7);
  else if (range === "month") start.setMonth(start.getMonth() - 1);
  else start.setHours(0, 0, 0, 0);
  return start;
}

function summarizeDriverEarnings(txs, completedOrders, range) {
  const since = earningsRangeStart(range);
  const earnings = (txs || [])
    .filter((t) => {
      if (!t || !t.created_at) return false;
      if (new Date(t.created_at) < since) return false;
      const dir = String(t.direction || "").toLowerCase();
      const type = String(t.type || "").toLowerCase();
      const amt = Math.abs(Number(t.amount) || 0);
      if (!amt) return false;
      return dir === "credit" && (type === "earning" || type === "deposit" || type === "refund");
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
  const trips = (completedOrders || []).filter((o) => {
    const at = o.updated_at || o.delivered_at || o.created_at;
    return at && new Date(at) >= since;
  }).length;
  const rounded = Math.round(earnings * 100) / 100;
  return {
    earnings_sar: rounded,
    trips,
    avg_per_trip_sar: trips > 0 ? Math.round((rounded / trips) * 100) / 100 : 0,
  };
}

router.get("/earnings", requireAuth, requireRole("driver"), async (req, res) => {
  try {
    const sb = req.supabase;
    const uid = req.appUser.id;
    const { listLedgerWalletTransactions } = require("../../shared/utils/ledgerWallet");
    let txs = [];
    try {
      txs = await listLedgerWalletTransactions(sb, uid, "driver", 500);
    } catch (_txErr) {
      txs = [];
    }
    const { data: completedOrders, error: oErr } = await sb
      .from("orders")
      .select("id, updated_at, delivered_at, created_at, delivery_status, status")
      .eq("driver_id", uid)
      .in("delivery_status", ["delivered", "picked_up", "picked"])
      .order("updated_at", { ascending: false })
      .limit(300);
    if (oErr) return fail(res, oErr.message, 400);
    const delivered = (completedOrders || []).filter((o) => {
      const st = String(o.delivery_status || o.status || "").toLowerCase();
      return st === "delivered" || st === "picked_up" || st === "picked";
    });
    return ok(res, {
      today: summarizeDriverEarnings(txs, delivered, "today"),
      week: summarizeDriverEarnings(txs, delivered, "week"),
      month: summarizeDriverEarnings(txs, delivered, "month"),
      source: "ledger",
    });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/accept/:id", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const driverId = req.appUser.id;
    const orderId = String(req.params.id || "").trim();
    if (!orderId) return fail(res, "order id required", 400);

    try {
      await assertDriverCanAcceptOrders(req.supabase, driverId);
    } catch (debtErr) {
      return fail(res, debtErr.message || "تعذر قبول الطلب", debtErr.code === "DRIVER_DEBT_LIMIT" ? 403 : 400);
    }

    const meLat = toNumberOrNaN(drv.lat);
    const meLng = toNumberOrNaN(drv.lng);

    const { data: cur, error: curErr } = await req.supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (curErr) return fail(res, curErr.message, 400);
    if (!cur) return fail(res, "Not found", 404);
    if (cur.driver_id) {
      return ok(res, { accepted: false, message: "تم استلام الطلب من مندوب آخر" });
    }

    const pickupLat = toNumberOrNaN(cur.pickup_lat);
    const pickupLng = toNumberOrNaN(cur.pickup_lng);
    if (
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      (!Number.isFinite(meLat) || !Number.isFinite(meLng))
    ) {
      return fail(res, "فعّل الموقع (GPS) أولاً قبل قبول الطلب", 403);
    }

    const current = getOrderDeliveryStatus(cur);

    if (current === "ready" && isMerchantDispatchOrder(cur)) {
      const out = await patchUnifiedOrderStatus(req.supabase, orderId, "picked_up", req.appUser);
      if (out.error) {
        const msg = out.error.message || String(out.error);
        return fail(res, msg, msg === "Forbidden" ? 403 : 400);
      }
      await bumpDeliveryOrdersListEpoch();
      if (out.data) {
        try {
          await notifyDriverUser(
            req.supabase,
            driverId,
            "driver.task.assigned",
            "تم استلام الطلب",
            `تم إسناد طلب ${out.data.order_number || out.data.id} إليك.`,
            out.data
          );
        } catch (notifyErr) {
          console.warn("[driver/accept] assignment notification:", notifyErr.message || notifyErr);
        }
      }
      return ok(res, { accepted: true, picked_up: true, order: out.data });
    }

    if (isMerchantDispatchOrder(cur)) {
      return fail(res, "الطلب لم يصبح جاهزاً للاستلام من المتجر بعد", 400);
    }

    if (current !== "new" && current !== "pending") {
      return fail(res, "الطلب غير متاح للاستلام", 400);
    }

    const { data, error } = await req.supabase
      .from("orders")
      .update({
        driver_id: driverId,
        delivery_status: "accepted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .is("driver_id", null)
      .in("delivery_status", ["new", "pending"])
      .select()
      .maybeSingle();

    if (error) return fail(res, error.message, 400);
    if (!data) {
      return ok(res, {
        accepted: false,
        message: "تم استلام الطلب من مندوب آخر",
      });
    }
    await bumpDeliveryOrdersListEpoch();
    if (data.customer_phone) {
      await sendOrderAcceptedToCustomer(data, req.appUser.phone);
    }
    try {
      await notifyDriverUser(
        req.supabase,
        driverId,
        "driver.task.assigned",
        "مهمة جديدة",
        `تم إسناد طلب ${data.order_number || data.id} إليك.`,
        data
      );
    } catch (notifyErr) {
      console.warn("[driver/accept] assignment notification:", notifyErr.message || notifyErr);
    }
    broadcastOrderPatch(orderId, orderPatchFromRow(data));
    return ok(res, { accepted: true, order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/update-location", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const orderId = String(req.body?.order_id || "").trim();
    const driverId = req.appUser.id;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail(res, "lat/lng required", 400);
    }

    let q = req.supabase
      .from("orders")
      .update({
        driver_lat: lat,
        driver_lng: lng,
        last_location_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .in("delivery_status", ["accepted", "picked", "picked_up", "delivering"]);
    if (orderId) q = q.eq("id", orderId);
    const { data: updatedRows, error } = await q.select("id");
    if (error) return fail(res, error.message, 400);
    const rows = Array.isArray(updatedRows) ? updatedRows : updatedRows ? [updatedRows] : [];
    for (const row of rows) {
      if (row && row.id) {
        broadcastDriverUpdate(row.id, driverId, { lat, lng, ts: Date.now() });
      }
    }
    const { error: dErr } = await req.supabase
      .from("drivers")
      .update({
        lat,
        lng,
        last_seen: nowIso(),
      })
      .eq("id", drv.id);
    if (dErr) {
      console.error("[driver/update-location] drivers table location update failed:", dErr.message);
    }
    return ok(res, { updated: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/start-delivery/:id", requireAuth, async (req, res) => {
  try {
    setDeprecationHeaders(res, UNIFIED_ORDER_STATUS);
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "order id required", 400);
    const out = await patchUnifiedOrderStatus(req.supabase, id, "delivering", req.appUser);
    if (out.error) return fail(res, out.error.message || "order not available", 400);
    const data = out.data;
    if (!data) return fail(res, "order not available", 400);
    if (data.customer_phone) await sendCustomerDeliveringNotice(data);
    return ok(res, { order: data, unified_redirect: UNIFIED_ORDER_STATUS });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/ping-arrival/:id", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const oid = String(req.params.id || "").trim();
    if (!oid) return fail(res, "order id required", 400);
    const { data: row, error } = await req.supabase
      .from("orders")
      .select("id, driver_id, delivery_status")
      .eq("id", oid)
      .maybeSingle();
    if (error || !row) return fail(res, error?.message || "Not found", 404);
    if (String(row.driver_id || "") !== String(req.appUser.id)) return fail(res, "Forbidden", 403);
    if (String(row.delivery_status || "").toLowerCase() !== "delivering") {
      return fail(res, "يجب أن يكون الطلب في حالة «جاري التوصيل»", 400);
    }
    broadcastOrderLive(oid, { arrivalPing: true, ts: Date.now() });
    return ok(res, { ok: true });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.post("/complete-order/:id", requireAuth, async (req, res) => {
  try {
    setDeprecationHeaders(res, UNIFIED_ORDER_STATUS);
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, "order id required", 400);

    const drv = await ensureApprovedDriver(req, res);
    if (!drv) {
      const out = await patchUnifiedOrderStatus(req.supabase, id, "delivered", req.appUser);
      if (out.error) return fail(res, out.error.message, out.error.message === "Not found" ? 404 : 400);
      return ok(res, { order: out.data, service_booking: !!out.service_booking, unified_redirect: UNIFIED_ORDER_STATUS });
    }

    const out = await patchUnifiedOrderStatus(req.supabase, id, "delivered", req.appUser);
    if (out.error) return fail(res, out.error.message || "order not available", 400);
    const data = out.data;
    if (!data) return fail(res, "order not available", 400);
    if (data.customer_phone) {
      await sendDriverArrived(data);
    }
    if (data.store_id) {
      try {
        const { error: rpcErr } = await req.supabase.rpc("increment_store_orders", { store_id: data.store_id });
        if (rpcErr) {
          console.error("[driver/complete-order] increment_store_orders:", rpcErr.message || rpcErr);
        }
      } catch (e) {
        console.error("[driver/complete-order] increment_store_orders:", e && (e.message || e));
      }
    }
    await bumpDeliveryOrdersListEpoch();
    broadcastOrderPatch(id, orderPatchFromRow(data));
    return ok(res, { order: data });
  } catch (e) {
    return fail(res, e.message, 500);
  }
});

router.get("/rating", requireAuth, async (req, res) => {
  try {
    const drv = await ensureApprovedDriver(req, res);
    if (!drv) return;
    const { data, error } = await req.supabase
      .from("orders")
      .select("rating")
      .eq("driver_id", req.appUser.id)
      .eq("delivery_status", "delivered")
      .not("rating", "is", null);

    if (error) return fail(res, error.message, 400);

    const rows = data || [];
    const count = rows.length;
    const sum = rows.reduce((a, b) => a + Number(b.rating), 0);
    const avg = count === 0 ? null : Math.round((sum / count) * 10) / 10;

    ok(res, { avg, count });
  } catch (e) {
    fail(res, e.message, 500);
  }
});

module.exports = router;
