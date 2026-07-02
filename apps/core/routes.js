const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth, getJwtSecret, optionalAuth } = require("../../shared/middleware/auth");
const { requireRole } = require("../../shared/middleware/roles");
const { ok, fail } = require("../../shared/utils/helpers");
const { toE164, toStorageDigits, isErvnowSaudiMobileE164 } = require("../../shared/utils/phone");
const { createServiceClient, getDatabaseConfigHint } = require("../../shared/config/supabase");
const { sendOTP } = require("../../shared/services/whatsappService");
const { getLastWhatsAppError } = require("../../shared/utils/whatsapp");
const { buildAuthOtpMessage } = require("../../shared/messages/authWhatsApp");
const {
  OTP_SCOPE,
  otpBackendMode,
  startOtpChallenge,
  verifyOtpChallenge,
  invalidateOtpChallenge,
} = require("../../shared/services/otpChallengeService");
const { attachSiteSessionCookie, clearSiteSessionCookie } = require("../../shared/middleware/publicSiteOtpGate");
const { parseOptionalPayoutPayload, payoutRowForUsers } = require("../../shared/utils/payoutFields");
const { assertPayoutIbanGloballyAvailable } = require("../../shared/utils/payoutUniqueness");
const checkoutPaymentMethods = require("../../shared/utils/checkoutPaymentMethods");
const {
  resolveLoginDestinations,
  pickDefaultDestination,
} = require("../../shared/utils/loginDestinations");
const { accessFlagsForRole } = require("../../shared/utils/platformAccessPolicy");
const { canonicalPhoneDigits, findUserByPhone, findUserByPhoneResilient } = require("../../shared/utils/userPhoneLookup");
const {
  isUserAccountApproved,
  isUserAccountPending,
  accountApprovedFlag,
} = require("../../shared/utils/accountApproval");

const router = express.Router();
const OTP_TTL_MS = 5 * 60 * 1000;

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  return req.ip ? String(req.ip).slice(0, 128) : null;
}

const ADMIN_LOGIN_PHONE_RAW = String(
  process.env.ERVENOW_ADMIN_LOGIN_PHONE || "0505745650"
).trim();

function toStoragePhoneDigits(input) {
  const e = toE164(input);
  return e ? toStorageDigits(e) : String(input || "").replace(/\D/g, "");
}

const ERVENOW_ADMIN_LOGIN_PHONE = toStoragePhoneDigits(ADMIN_LOGIN_PHONE_RAW);

/** أرقام مسموح لها OTP لوحة الإدارة — LOGIN + قوائم الأدمن (نفس منطق apps/admin) */
function adminOtpDigitsFromEnvList(rawList) {
  const out = [];
  for (const part of String(rawList || "").split(",")) {
    const raw = String(part || "").trim();
    if (!raw) continue;
    const e = toE164(raw);
    if (!e || !isErvnowSaudiMobileE164(e)) continue;
    out.push(toStorageDigits(e));
  }
  return out;
}

const ADMIN_OTP_ALLOWED_DIGITS = new Set([
  ERVENOW_ADMIN_LOGIN_PHONE,
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_FULL_PHONES),
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED1_PHONES),
  ...adminOtpDigitsFromEnvList(process.env.ERVENOW_ADMIN_LIMITED2_PHONES),
]);

function genOtp() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function otpKey(role, phoneDigits) {
  return String(role || "customer").toLowerCase() + ":" + String(phoneDigits || "");
}

function isAllowedAdminPhoneDigits(phoneDigits) {
  const d = String(phoneDigits || "").replace(/\D/g, "");
  return ADMIN_OTP_ALLOWED_DIGITS.has(d);
}

/* ======================
   JWT (جلسة المنصة)
====================== */
function signPlatformToken(userId, phoneDigits, role) {
  const secret = getJwtSecret();
  if (!secret) throw new Error("ERVENOW_JWT_SECRET مطلوب في الإنتاج");
  return jwt.sign(
    { sub: userId, phone: phoneDigits, role },
    secret,
    { expiresIn: "7d" }
  );
}

/* ======================
   upsert مستخدم (بدون Supabase Auth)
====================== */
const ALLOWED_USER_ROLES = new Set(["customer", "driver", "store", "restaurant", "merchant", "service", "admin"]);
const { normalizeProviderServiceType } = require("../../shared/utils/serviceProviderTypes");

const ALLOWED_SERVICE_TYPES = new Set([
  "plumber",
  "electrician",
  "nursery",
  "agricultural_engineer",
  "ac_technician",
  "cleaning",
  "cleaning_villa",
  "cleaning_building",
  "laundry_estates",
  "vehicle_transfer",
  "internal_delivery",
  "pickup_truck",
  "furniture_move",
  "gas_delivery",
  "gas_cylinder_swap",
  "gas_central_refill",
  "car_polishing",
]);

function normalizeServiceType(v) {
  const fromProvider = normalizeProviderServiceType(v);
  if (fromProvider) return fromProvider;
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  return ALLOWED_SERVICE_TYPES.has(s) ? s : null;
}

function isMissingStatusColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.status|column .*status.* does not exist|Could not find the .*status/i.test(msg);
}

function isMissingNameColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /users\.name|column .*name.* does not exist|Could not find the .*name/i.test(msg);
}

function isMissingServiceVehicleColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /service_vehicle_type|service_plate_number|service_vehicle_model/i.test(msg);
}

function isMissingServiceDistrictColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /service_district/i.test(msg);
}

function stripOptionalUserColumnsForSchema(row, err) {
  const out = { ...row };
  if (!err) return out;
  if (isMissingNameColumnError(err) && out.name != null) delete out.name;
  if (isMissingServiceDistrictColumnError(err) && out.service_district != null) {
    delete out.service_district;
  }
  if (isMissingServiceVehicleColumnError(err)) {
    delete out.service_vehicle_type;
    delete out.service_plate_number;
    delete out.service_vehicle_model;
  }
  return out;
}

async function resilientUserUpdate(sb, userId, patch) {
  let p = { ...patch };
  let res = await sb.from("users").update(p).eq("id", userId).select().single();
  for (let attempt = 0; attempt < 5 && res.error; attempt++) {
    const next = stripOptionalUserColumnsForSchema(p, res.error);
    if (JSON.stringify(next) === JSON.stringify(p)) break;
    p = next;
    res = await sb.from("users").update(p).eq("id", userId).select().single();
  }
  return res;
}

async function resilientUserInsert(sb, insertRow, initialStatus) {
  let row = { ...insertRow };
  let res = await sb.from("users").insert({ ...row, status: initialStatus }).select().single();
  for (let attempt = 0; attempt < 6 && res.error; attempt++) {
    if (isMissingStatusColumnError(res.error)) {
      res = await sb.from("users").insert(row).select().single();
      if (!res.error) return res;
    }
    const next = stripOptionalUserColumnsForSchema(row, res.error);
    if (JSON.stringify(next) === JSON.stringify(row)) break;
    if (isMissingServiceDistrictColumnError(res.error)) {
      console.warn(
        "[ERVENOW] users.service_district غير موجود — نفّذ shared/migration_users_service_district.sql في Supabase"
      );
    }
    row = next;
    res = await sb.from("users").insert({ ...row, status: initialStatus }).select().single();
  }
  return res;
}

const PICKUP_VEHICLE_TYPES = new Set([
  "flatbed",
  "flatbed_hydraulic",
  "tow",
  "car_carrier",
  "other",
]);

function pickupModelYearBounds() {
  const now = new Date().getFullYear();
  return { min: now - 14, max: now };
}

function parsePickupVehiclePayload(body) {
  const vType = String(body?.service_vehicle_type || body?.vehicle_type || "")
    .trim()
    .toLowerCase();
  const plate = String(body?.service_plate_number || body?.plate_number || "")
    .trim()
    .slice(0, 20);
  const modelRaw = String(body?.service_vehicle_model || body?.vehicle_model || "").trim();
  const modelYear = parseInt(modelRaw, 10);
  const { min, max } = pickupModelYearBounds();
  if (!PICKUP_VEHICLE_TYPES.has(vType)) return { ok: false, error: "اختر نوع المركبة" };
  if (!plate) return { ok: false, error: "رقم اللوحة مطلوب" };
  if (!Number.isFinite(modelYear) || String(modelYear) !== modelRaw) {
    return { ok: false, error: "اختر سنة موديل المركبة من القائمة" };
  }
  if (modelYear < min || modelYear > max) {
    return { ok: false, error: `سنة الموديل يجب أن تكون ضمن آخر 15 سنة (${min}–${max})` };
  }
  const model = String(modelYear);
  return {
    ok: true,
    data: {
      service_vehicle_type: vType,
      service_plate_number: plate,
      service_vehicle_model: model,
    },
  };
}

async function upsertDriverByPhone(
  sb,
  phoneDigits,
  preferredRole,
  preferredServiceType,
  displayName,
  serviceDistrict,
  serviceVehicle,
  options = {}
) {
  phoneDigits = canonicalPhoneDigits(phoneDigits) || String(phoneDigits || "").replace(/\D/g, "");
  const loginOnly = options.loginOnly === true;
  const role = ALLOWED_USER_ROLES.has(preferredRole) ? preferredRole : "customer";
  const serviceType = role === "service" ? normalizeServiceType(preferredServiceType) : null;
  const trimmedName =
    (role === "customer" || role === "service") && displayName
      ? String(displayName).trim().slice(0, 200)
      : "";
  const trimmedDistrict =
    role === "service" && serviceDistrict ? String(serviceDistrict).trim().slice(0, 120) : "";
  const applyVehicle =
    role === "service" && serviceType === "pickup_truck" && serviceVehicle && typeof serviceVehicle === "object";

  let existing = null;
  let selErr = null;
  let found = await findUserByPhone(
    sb,
    phoneDigits,
    "id, role, status, phone, service_type, updated_at, name"
  );
  if (found.error && isMissingNameColumnError(found.error)) {
    found = await findUserByPhone(sb, phoneDigits, "id, role, status, phone, service_type, updated_at");
  }
  if (found.error && isMissingStatusColumnError(found.error)) {
    found = await findUserByPhone(sb, phoneDigits, "id, role, phone, service_type, updated_at, name");
    if (found.error && isMissingNameColumnError(found.error)) {
      found = await findUserByPhone(sb, phoneDigits, "id, role, phone, service_type, updated_at");
    }
  }
  existing = found.data || null;
  selErr = found.error || null;
  if (selErr) return { data: null, error: selErr };

  if (existing?.id && existing.phone && existing.phone !== phoneDigits) {
    await sb.from("users").update({ phone: phoneDigits, updated_at: new Date().toISOString() }).eq("id", existing.id);
    existing.phone = phoneDigits;
  }

  const now = new Date().toISOString();

  if (existing?.id) {
    if (
      String(existing.status || "").toLowerCase() === "blocked" ||
      String(existing.role || "").toLowerCase() === "blocked"
    ) {
      return { data: existing, error: new Error("الحساب محظور من الإدارة") };
    }
    if (loginOnly) {
      const touch = await sb.from("users").update({ updated_at: now }).eq("id", existing.id).select().single();
      if (touch.error) return { data: existing, error: null };
      return touch;
    }
    const patch = { role, service_type: serviceType, updated_at: now };
    if (trimmedName && role === "customer" && !String(existing.name || "").trim()) {
      patch.name = trimmedName;
    }
    if (trimmedName && role === "service") patch.name = trimmedName;
    if (trimmedDistrict && role === "service") patch.service_district = trimmedDistrict;
    if (applyVehicle) Object.assign(patch, serviceVehicle);
    return resilientUserUpdate(sb, existing.id, patch);
  }

  const insertRow = {
    phone: phoneDigits,
    role,
    service_type: serviceType,
    updated_at: now,
    ...(trimmedName && (role === "customer" || role === "service") ? { name: trimmedName } : {}),
    ...(trimmedDistrict && role === "service" ? { service_district: trimmedDistrict } : {}),
    ...(applyVehicle ? serviceVehicle : {}),
  };
  const initialStatus = role === "admin" ? "active" : "pending";
  return resilientUserInsert(sb, insertRow, initialStatus);
}

router.get("/", (_req, res) => {
  ok(res, { service: "core", endpoints: ["/health", "/public-config", "/send-otp", "/verify-otp", "/register", "/register-account", "/me"] });
});

router.get("/health", (_req, res) => {
  ok(res, { service: "core", version: "2.1.0", auth: "ervenow_unified+05+jwt" });
});

router.get("/platform-modules", optionalAuth, (_req, res) => {
  try {
    const { readPlatformModules } = require("../../shared/utils/platformModules");
    const state = readPlatformModules();
    const modules = {};
    for (const [id, row] of Object.entries(state.modules || {})) {
      modules[id] = {
        id: row.id,
        label: row.label,
        label_ar: row.label_ar,
        status: row.status,
      };
    }
    return ok(res, { modules, updated_at: state.updated_at || null });
  } catch (e) {
    return fail(res, e.message || "platform modules error", 500);
  }
});

router.get("/public-config", (_req, res) => {
  try {
    const { getUrl, getAnonKey } = require("../../shared/config/supabase");
    const { allowDevOtpBypass } = require("../../shared/utils/devOtpBypass");
    ok(res, {
      supabaseUrl: getUrl(),
      supabaseAnonKey: getAnonKey(),
      dev_otp_enabled: allowDevOtpBypass(),
    });
  } catch (e) {
    fail(res, e.message || "config error", 500);
  }
});

const platformBranding = require("../../shared/utils/platformBrandingStore");
const { mergeMapColorsIntoBranding } = require("../../shared/utils/mapCategoryColors");
const { readStateAsync: readLiveMapPublicAsync } = require("../../shared/utils/liveMapPublicStore");

router.get("/platform-branding", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const settings = mergeMapColorsIntoBranding(await platformBranding.loadBranding(sb));
    res.set("Cache-Control", "public, max-age=30");
    return ok(res, { settings });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/live-map-public", async (_req, res) => {
  try {
    const enabled = await readLiveMapPublicAsync();
    res.set("Cache-Control", "public, max-age=15");
    return ok(res, { enabled });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

const platformOffers = require("../../shared/utils/platformOffersStore");
const heroBanners = require("../../shared/utils/heroBannerStore");
const marketingEngine = require("../../shared/utils/marketingEngine");

function marketingContextFromReq(req) {
  return {
    isLoggedIn: !!(req.authUser && req.authUser.id),
    city: String(req.query?.city || req.headers["x-erv-city"] || "").trim() || null,
    now: new Date(),
  };
}

async function buildMarketingSurfacePayload(surface, ctx) {
  const experience = marketingEngine.buildPublicExperience(surface, ctx);
  const sb = createServiceClient();
  let hero = null;
  let offers = [];
  try {
    if (surface === "home" && sb) {
      const byPlacement = await heroBanners.getActiveBannersByPlacement(sb);
      hero = {
        home_promo: byPlacement.home_promo || [],
        home_hero: byPlacement.home_hero || [],
      };
      offers = await platformOffers.loadOffers(sb);
    }
  } catch (e) {
    console.warn("[marketing/home] payload enrich:", e && (e.message || e));
  }
  return {
    ...experience,
    payloads: {
      hero,
      offers,
    },
  };
}

router.get("/marketing/home", optionalAuth, async (req, res) => {
  try {
    const payload = await buildMarketingSurfacePayload("home", marketingContextFromReq(req));
    res.set("Cache-Control", "public, max-age=60");
    return ok(res, payload);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/marketing/:surface", optionalAuth, async (req, res) => {
  try {
    const surface = String(req.params.surface || "").trim().toLowerCase();
    if (!marketingEngine.SURFACES.includes(surface)) {
      return fail(res, `unsupported surface; allowed: ${marketingEngine.SURFACES.join(", ")}`, 400);
    }
    const payload = await buildMarketingSurfacePayload(surface, marketingContextFromReq(req));
    res.set("Cache-Control", "public, max-age=60");
    return ok(res, payload);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/hero-banner", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const byTarget = await heroBanners.getActiveBannersByTarget(sb);
    const byPlacement = await heroBanners.getActiveBannersByPlacement(sb);
    const homePromo = byPlacement.home_promo || [];
    const homeHero = byPlacement.home_hero || [];
    const guestDash = byPlacement.guest_dashboard || [];
    res.set("Cache-Control", "public, max-age=30");
    return ok(res, {
      placements: byPlacement,
      targets: byTarget,
      banner: homePromo[0] || null,
      banners: homePromo,
      promo_banners: homePromo,
      home_hero_banners: homeHero,
      platform_banner: guestDash[0] || null,
      platform_banners: guestDash,
      guest_dashboard_banners: guestDash,
    });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/banners", async (req, res) => {
  try {
    const sb = createServiceClient();
    const target = String(req.query.target || req.query.placement || "").trim();
    if (target) {
      const banners = await heroBanners.getPublishedBannersForTarget(sb, target);
      res.set("Cache-Control", "public, max-age=30");
      return ok(res, { target, banners, banner_spec: heroBanners.BANNER_SPEC });
    }
    const byTarget = await heroBanners.getActiveBannersByTarget(sb);
    res.set("Cache-Control", "public, max-age=30");
    return ok(res, { targets: byTarget, banner_spec: heroBanners.BANNER_SPEC });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/banners/:id/impression", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const result = await heroBanners.recordBannerImpression(sb, req.params.id);
    return ok(res, result);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.post("/banners/:id/click", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) return fail(res, "قاعدة البيانات غير جاهزة", 503);
    const result = await heroBanners.recordBannerClick(sb, req.params.id);
    return ok(res, result);
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

router.get("/platform-offers", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const offers = await platformOffers.loadOffers(sb);
    res.set("Cache-Control", "public, max-age=30");
    return ok(res, { offers });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

/** إنهاء جلسة البوابة (كوكي HttpOnly) — يُستخدم عند تعطيل البوابة لاحقاً أو تسجيل خروج من الواجهة */
router.get("/site-gate-logout", (req, res) => {
  clearSiteSessionCookie(req, res);
  const next = String(req.query.next || "").trim();
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/login";
  res.redirect(302, safe);
});

router.post("/send-otp", async (req, res) => {
  try {
    const raw = req.body?.phone;
    const roleIn = String(req.body?.role || "").trim().toLowerCase();
    const e164 = toE164(raw);
    if (!e164 || !isErvnowSaudiMobileE164(e164)) {
      return fail(
        res,
        "رقم غير صالح — أدخل 05xxxxxxxx أو 9665xxxxxxxx",
        400
      );
    }

    const digits = canonicalPhoneDigits(toStorageDigits(e164));
    const loginOnly = req.body?.login_only === true || req.body?.login_only === "true";
    const role = loginOnly ? "login" : roleIn || "customer";
    if (roleIn === "admin") {
      if (!isAllowedAdminPhoneDigits(digits)) {
        return fail(res, "غير مصرح لهذا الرقم بدخول لوحة الإدارة", 403);
      }
    }
    const code = genOtp();
    const key = otpKey(role, digits);
    const mode = otpBackendMode();
    const sbOtp = mode === "supabase" ? createServiceClient() : null;
    const started = await startOtpChallenge({
      sb: sbOtp,
      mode,
      scope: OTP_SCOPE.CORE_LOGIN,
      subjectKey: key,
      code,
      ttlMs: OTP_TTL_MS,
      ip: clientIp(req),
    });
    if (!started.ok) {
      const st = started.cooldownSeconds ? 429 : 400;
      return fail(res, started.error || "تعذر إعداد رمز التحقق", st, {
        cooldown_seconds: started.cooldownSeconds,
      });
    }
    let sent = false;
    try {
      sent = await sendOTP(digits, code, {
        message: buildAuthOtpMessage(
          code,
          role === "admin" ? "لوحة الإدارة" : "تسجيل الدخول"
        ),
        type: role === "admin" ? "otp_admin" : "otp_login",
      });
    } catch (waErr) {
      console.error("[ERVENOW] send-otp whatsapp error:", waErr?.code, waErr?.message || waErr);
      sent = false;
    }
    if (!sent) {
      await invalidateOtpChallenge({
        sb: sbOtp,
        mode,
        scope: OTP_SCOPE.CORE_LOGIN,
        subjectKey: key,
      });
      const twilioReady = !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM)
      );
      const waErr = getLastWhatsAppError();
      const waCode = waErr && (waErr.code || waErr.status);
      let userMsg =
        "تعذر إرسال رمز واتساب — غير مضبوط على الخادم: TWILIO_ACCOUNT_SID و TWILIO_AUTH_TOKEN و TWILIO_WHATSAPP_NUMBER";
      if (twilioReady) {
        if (Number(waCode) === 63038) {
          userMsg =
            "تم تجاوز حد رسائل واتساب اليومي في Twilio (خطأ 63038). انتظر حتى 24 ساعة أو رقِّ الحساب من لوحة Twilio.";
        } else if (Number(waCode) === 63016 || Number(waCode) === 21608) {
          userMsg =
            "رقم الجوال غير مسجّل في Twilio Sandbox — أرسل join <كود> إلى رقم Sandbox من واتسابك أولاً.";
        } else {
          userMsg =
            "تعذر إرسال رمز واتساب (تحقق من Twilio ورقم المستلم في Sandbox إن وُجد)";
        }
      }
      return fail(res, userMsg, 503);
    }
    const payload = {
      ok: true,
      message: "تم إرسال الرمز عبر واتساب",
      sent: true,
    };
    ok(res, payload);
  } catch (e) {
    console.error("[ERVENOW] send-otp:", e);
    fail(res, e.message || "خطأ في الإرسال", 500);
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const registerWithoutOtp =
      (req.body?.register_without_otp === true || req.body?.register_without_otp === "true") &&
      !(req.body?.login_only === true || req.body?.login_only === "true");
    if (registerWithoutOtp) {
      return await handleRegisterAccount(req, res);
    }

    const raw = req.body?.phone;
    const codeIn = String(req.body?.code || "").trim();
    const loginOnly = req.body?.login_only === true || req.body?.login_only === "true";
    const roleIn = String(req.body?.role || "customer").trim().toLowerCase();
    const wantRole = ALLOWED_USER_ROLES.has(roleIn) ? roleIn : "customer";

    const e164 = toE164(raw);
    if (!e164) return fail(res, "رقم الجوال غير صالح", 400);
    if (!isErvnowSaudiMobileE164(e164)) {
      return fail(
        res,
        "رقم غير صالح — أدخل 05xxxxxxxx أو 9665xxxxxxxx",
        400
      );
    }
    if (!codeIn) return fail(res, "أدخل رمز الدخول", 400);

    let payoutParsed = {};
    try {
      payoutParsed = parseOptionalPayoutPayload(req.body);
    } catch (pe) {
      return fail(res, pe.message || "بيانات الحساب البنكي غير صالحة", 400);
    }

    const digits = canonicalPhoneDigits(toStorageDigits(e164));

    if (wantRole === "admin") {
      if (!isAllowedAdminPhoneDigits(digits)) {
        return fail(res, "غير مصرح لهذا الرقم بدخول لوحة الإدارة", 403);
      }
    }

    const key = otpKey(loginOnly ? "login" : wantRole, digits);
    const mode = otpBackendMode();
    const sbOtp = mode === "supabase" ? createServiceClient() : null;
    const sbEarly = createServiceClient();

    let existingUser = null;
    if (sbEarly) {
      const exFound = await findUserByPhoneResilient(sbEarly, digits);
      if (exFound.data) {
        const exSt = String(exFound.data.status || "").toLowerCase();
        const exRole = String(exFound.data.role || "").toLowerCase();
        if (exSt === "blocked" || exRole === "blocked") {
          return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
        }
        existingUser = exFound.data;
      } else if (exFound.error && !isMissingStatusColumnError(exFound.error)) {
        console.error("[ERVENOW] verify-otp user lookup:", exFound.error.message || exFound.error);
      }
    }
    const existingRole = existingUser ? String(existingUser.role || "").toLowerCase() : null;

    const STAFF_LOGIN_ROLES = new Set(["admin", "driver", "store", "merchant", "restaurant", "service"]);
    const checked = await verifyOtpChallenge({
      sb: sbOtp,
      mode,
      scope: OTP_SCOPE.CORE_LOGIN,
      subjectKey: key,
      code: codeIn,
    });
    if (!checked.ok) {
      const lockCase = /قفل|محاولات كثيرة/i.test(String(checked.error || ""));
      return fail(res, checked.error || "رمز واتساب غير صحيح أو منتهي", lockCase ? 429 : 400, {
        attempts_remaining: checked.attemptsRemaining,
      });
    }

    if (loginOnly && !existingUser) {
      return fail(res, "رقم الجوال غير مسجّل. أنشئ حساباً من صفحة التسجيل أولاً.", 403, {
        not_registered: true,
      });
    }

    const sb = sbEarly || createServiceClient();
    if (!sb) {
      return fail(
        res,
        `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`,
        503
      );
    }

    let roleForSession = wantRole;
    if (loginOnly && existingRole && STAFF_LOGIN_ROLES.has(existingRole)) {
      roleForSession = existingRole;
    } else if (loginOnly) {
      roleForSession = existingRole || "customer";
    }

    let wantServiceType = req.body?.service_type;
    const displayName =
      roleForSession === "customer" || roleForSession === "service"
        ? String(req.body?.name || "").trim()
        : "";
    let serviceDistrict =
      roleForSession === "service"
        ? String(req.body?.service_district || req.body?.service_city || req.body?.district || "").trim()
        : "";

    const isServiceLoginOnly =
      loginOnly && roleForSession === "service" && !!existingUser;
    if (isServiceLoginOnly) {
      if (!normalizeServiceType(wantServiceType)) {
        wantServiceType = existingUser.service_type;
      }
      if (!serviceDistrict) {
        serviceDistrict = String(existingUser.service_district || "").trim();
      }
    }

    const normalizedServiceType =
      roleForSession === "service" ? normalizeServiceType(wantServiceType) : null;

    if (roleForSession === "service" && !normalizedServiceType) {
      const msg = isServiceLoginOnly
        ? "حساب مقدم الخدمة غير مكتمل — تواصل مع الإدارة"
        : "اختر نوع الخدمة من القائمة";
      return fail(res, msg, 400);
    }
    if (roleForSession === "service" && !loginOnly && !serviceDistrict) {
      const st = normalizedServiceType;
      return fail(res, st === "pickup_truck" ? "اختر المدينة" : "أدخل الحي الذي تخدمه", 400);
    }
    let serviceVehicle = null;
    if (
      roleForSession === "service" &&
      !loginOnly &&
      normalizedServiceType === "pickup_truck"
    ) {
      const parsedVehicle = parsePickupVehiclePayload(req.body);
      if (!parsedVehicle.ok) return fail(res, parsedVehicle.error, 400);
      serviceVehicle = parsedVehicle.data;
    }
    const { data: userRow, error: dbErr } = await upsertDriverByPhone(
      sb,
      digits,
      roleForSession,
      wantServiceType,
      displayName,
      serviceDistrict,
      serviceVehicle,
      { loginOnly: loginOnly && !!existingUser }
    );
    if (dbErr) {
      console.error("[ERVENOW] verify-otp DB:", dbErr);
      return fail(
        res,
        dbErr.message ||
          "فشل حفظ المستخدم. نفّذ migration_users_phone_auth.sql في Supabase",
        400
      );
    }

    if (!userRow || userRow.id == null) {
      console.error("[ERVENOW] verify-otp: userRow missing after upsert");
      return fail(res, "فشل إنشاء المستخدم في قاعدة البيانات", 500);
    }

    if (
      String(userRow.status || "").toLowerCase() === "blocked" ||
      String(userRow.role || "").toLowerCase() === "blocked"
    ) {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }

    const userStatus = String(userRow.status || "").toLowerCase();
    const userRole = String(userRow.role || roleForSession || "").toLowerCase();
    const rejected = userStatus === "rejected";
    if (rejected) {
      return fail(res, "تم رفض طلب التسجيل — تواصل مع الإدارة", 403, { rejected: true });
    }

    if (loginOnly && isUserAccountPending(userRow.status)) {
      return fail(res, "يتم تفعيل الحساب بعد المراجعة واعتماده من إدارة ERVENOW.", 403, {
        pending_approval: true,
        approved: false,
      });
    }

    const needsApproval =
      userRole !== "admin" && String(userRow.status || "").toLowerCase() === "pending";
    if (needsApproval) {
      return ok(res, {
        success: true,
        pending_approval: true,
        approved: false,
        message:
          "تم استلام طلب التسجيل بنجاح. حسابك قيد المراجعة من إدارة ERVENOW، وسيتم إشعارك فور اعتماد الحساب وتفعيله.",
        user: {
          id: userRow.id,
          phone: userRow.phone,
          role: userRow.role,
          status: userRow.status || "pending",
          service_type: userRow.service_type || null,
          name: userRow.name || null,
        },
      });
    }

    const sessionPhone = canonicalPhoneDigits(userRow.phone || digits) || digits;

    const payoutPatch = payoutRowForUsers(payoutParsed);
    const payoutRoles = new Set(["store", "merchant", "restaurant", "service"]);
    if (payoutRoles.has(String(roleForSession).toLowerCase()) && Object.keys(payoutPatch).length) {
      if (payoutParsed.iban) {
        try {
          await assertPayoutIbanGloballyAvailable(sb, payoutParsed.iban, {
            excludeUserId: userRow.id,
            ownerPhonesDigits: [digits],
          });
        } catch (pe) {
          return fail(res, pe.message || "الآيبان مستخدم لحساب آخر", 400);
        }
      }
      const pRes = await sb
        .from("users")
        .update({ ...payoutPatch, updated_at: new Date().toISOString() })
        .eq("id", userRow.id);
      if (pRes.error && !/column|does not exist|schema cache/i.test(String(pRes.error.message || ""))) {
        console.warn("[ERVENOW] verify-otp payout update:", pRes.error.message);
      }
    }

    const token = signPlatformToken(userRow.id, sessionPhone, userRow.role || roleForSession);
    attachSiteSessionCookie(req, res, token);

    ok(res, {
      success: true,
      token,
      approved: true,
      user: {
        id: userRow.id,
        phone: userRow.phone,
        role: userRow.role,
        status: userRow.status || "active",
        service_type: userRow.service_type || null,
        name: userRow.name || null,
        approved: true,
      },
    });
  } catch (e) {
    console.error("[ERVENOW] verify-otp:", e);
    const msg = e.message || String(e) || "فشل التحقق";
    if (/JWT|ERVENOW_JWT_SECRET|JWT_SECRET is not set|secret/i.test(msg)) {
      return fail(res, "مفتاح الجلسة غير مضبوط: عيّن ERVENOW_JWT_SECRET في .env", 503);
    }
    fail(res, msg, 500);
  }
});

async function handleRegisterAccount(req, res) {
  const raw = req.body?.phone;
  const roleIn = String(req.body?.role || "customer").trim().toLowerCase();
  const wantRole = ALLOWED_USER_ROLES.has(roleIn) ? roleIn : "customer";

  const e164 = toE164(raw);
  if (!e164) return fail(res, "رقم الجوال غير صالح", 400);
  if (!isErvnowSaudiMobileE164(e164)) {
    return fail(res, "رقم غير صالح — أدخل 05xxxxxxxx أو 9665xxxxxxxx", 400);
  }

  let payoutParsed = {};
  try {
    payoutParsed = parseOptionalPayoutPayload(req.body);
  } catch (pe) {
    return fail(res, pe.message || "بيانات الحساب البنكي غير صالحة", 400);
  }

  const digits = canonicalPhoneDigits(toStorageDigits(e164));
  const sb = createServiceClient();
  if (!sb) {
    return fail(res, `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`, 503);
  }

  const exFound = await findUserByPhoneResilient(sb, digits);
  if (exFound.error && !isMissingStatusColumnError(exFound.error)) {
    console.error("[ERVENOW] register-account user lookup:", exFound.error.message || exFound.error);
  }
  const existingUser = exFound.data || null;
  if (existingUser) {
    const exSt = String(existingUser.status || "").toLowerCase();
    const exRole = String(existingUser.role || "").toLowerCase();
    if (exSt === "blocked" || exRole === "blocked") {
      return fail(res, "الحساب محظور من الإدارة", 403, { blocked: true });
    }
    if (exSt === "rejected") {
      return fail(res, "تم رفض طلب التسجيل — تواصل مع الإدارة", 403, { rejected: true });
    }
    if (isUserAccountApproved(existingUser.status, existingUser.role)) {
      return fail(res, "رقم الجوال مسجّل مسبقاً — استخدم تسجيل الدخول", 409, {
        already_registered: true,
      });
    }
  }

  const wantServiceType = req.body?.service_type;
  const displayName =
    wantRole === "customer" || wantRole === "service"
      ? String(req.body?.name || "").trim()
      : "";
  const serviceDistrict =
    wantRole === "service"
      ? String(req.body?.service_district || req.body?.service_city || req.body?.district || "").trim()
      : "";

  if (wantRole === "service" && !normalizeServiceType(wantServiceType)) {
    return fail(res, "اختر نوع الخدمة من القائمة", 400);
  }
  if (wantRole === "service" && !displayName) {
    return fail(res, "أدخل الاسم", 400);
  }
  if (wantRole === "service" && !serviceDistrict) {
    const st = normalizeServiceType(wantServiceType);
    return fail(res, st === "pickup_truck" ? "اختر المدينة" : "أدخل الحي الذي تخدمه", 400);
  }

  let serviceVehicle = null;
  if (wantRole === "service" && normalizeServiceType(wantServiceType) === "pickup_truck") {
    const parsedVehicle = parsePickupVehiclePayload(req.body);
    if (!parsedVehicle.ok) return fail(res, parsedVehicle.error, 400);
    serviceVehicle = parsedVehicle.data;
  }

  if (wantRole === "driver") {
    const d = req.body?.driver && typeof req.body.driver === "object" ? req.body.driver : req.body;
    const dName = String(d?.name || req.body?.name || "").trim();
    const iqama = String(d?.iqama || req.body?.iqama || "").trim();
    const carType = String(d?.car_type || req.body?.car_type || "").trim();
    const plate = String(d?.plate_number || req.body?.plate_number || "").trim();
    if (!dName || !iqama || !carType || !plate) {
      return fail(res, "أكمل بيانات المندوب: الاسم، الهوية/الإقامة، نوع المركبة، ورقم اللوحة", 400);
    }
  }

  const { data: userRow, error: dbErr } = await upsertDriverByPhone(
    sb,
    digits,
    wantRole,
    wantServiceType,
    displayName,
    serviceDistrict,
    serviceVehicle,
    { loginOnly: false }
  );
  if (dbErr) {
    console.error("[ERVENOW] register-account DB:", dbErr);
    return fail(
      res,
      dbErr.message || "فشل حفظ المستخدم. نفّذ migration_users_phone_auth.sql في Supabase",
      400
    );
  }
  if (!userRow || userRow.id == null) {
    return fail(res, "فشل إنشاء المستخدم في قاعدة البيانات", 500);
  }

  const payoutPatch = payoutRowForUsers(payoutParsed);
  const payoutRoles = new Set(["store", "merchant", "restaurant", "service", "driver"]);
  if (payoutRoles.has(String(wantRole).toLowerCase()) && Object.keys(payoutPatch).length) {
    if (payoutParsed.iban) {
      try {
        await assertPayoutIbanGloballyAvailable(sb, payoutParsed.iban, {
          excludeUserId: userRow.id,
          ownerPhonesDigits: [digits],
        });
      } catch (pe) {
        return fail(res, pe.message || "الآيبان مستخدم لحساب آخر", 400);
      }
    }
    const pRes = await sb
      .from("users")
      .update({ ...payoutPatch, updated_at: new Date().toISOString() })
      .eq("id", userRow.id);
    if (pRes.error && !/column|does not exist|schema cache/i.test(String(pRes.error.message || ""))) {
      console.warn("[ERVENOW] register-account payout update:", pRes.error.message);
    }
  }

  if (wantRole === "driver") {
    const { payoutRowForDriversOrStores } = require("../../shared/utils/payoutFields");
    const { iqamaDigitsNormalized } = require("../../shared/utils/payoutUniqueness");
    const d = req.body?.driver && typeof req.body.driver === "object" ? req.body.driver : req.body;
    const dName = String(d?.name || req.body?.name || "").trim();
    const iqama = String(d?.iqama || req.body?.iqama || "").trim();
    const carType = String(d?.car_type || req.body?.car_type || "").trim();
    const plate = String(d?.plate_number || req.body?.plate_number || "").trim();
    let extraPayout = {};
    try {
      if (payoutParsed.iban) {
        extraPayout = payoutRowForDriversOrStores(payoutParsed);
      }
    } catch (pe) {
      return fail(res, pe.message || "بيانات الدفع غير صالحة", 400);
    }
    const iqama_digits = iqamaDigitsNormalized(iqama);
    const driverRow = {
      name: dName,
      phone: digits,
      iqama,
      iqama_digits: iqama_digits || null,
      car_type: carType,
      plate_number: plate,
      status: "pending",
      active: false,
      ...extraPayout,
    };
    const { error: drvErr } = await sb.from("drivers").upsert(driverRow, { onConflict: "phone" });
    if (drvErr) {
      const em = String(drvErr.message || drvErr.details || "");
      if (/unique|duplicate|23505|iqama/i.test(em)) {
        return fail(res, "رقم الهوية / الإقامة مستخدم مسبقاً أو بيانات مكررة", 400);
      }
      console.warn("[ERVENOW] register-account driver upsert:", em);
    }
  }

  try {
    const { notifyAdminsInApp } = require("../../shared/services/platformNotify");
    const roleLabel =
      wantRole === "service" ? normalizeServiceType(wantServiceType) || "service" : wantRole;
    await notifyAdminsInApp(sb, {
      title: "طلب تسجيل جديد",
      message: `طلب انضمام (${roleLabel}) — ${displayName || digits}`,
      type: "registration",
      source: "admin",
      payload: {
        user_id: userRow.id,
        role: wantRole,
        service_type: userRow.service_type || null,
        phone: digits,
      },
    });
  } catch (notifyErr) {
    console.warn("[ERVENOW] register-account admin notify:", notifyErr.message || notifyErr);
  }

  return ok(res, {
    success: true,
    pending_approval: true,
    approved: false,
    message:
      "تم استلام طلب التسجيل بنجاح. حسابك قيد المراجعة من إدارة ERVENOW، وسيتم إشعارك فور اعتماد الحساب وتفعيله. بعد الاعتماد سجّل الدخول برمز واتساب.",
    user: {
      id: userRow.id,
      phone: userRow.phone,
      role: userRow.role,
      status: userRow.status || "pending",
      service_type: userRow.service_type || null,
      name: userRow.name || null,
    },
  });
}

/** تسجيل حساب جديد بدون OTP — يُرسل للإدارة للموافقة، ثم يدخل المستخدم برمز واتساب بعد الاعتماد */
async function registerAccountRoute(req, res) {
  try {
    return await handleRegisterAccount(req, res);
  } catch (e) {
    console.error("[ERVENOW] register-account:", e);
    return fail(res, e.message || "فشل التسجيل", 500);
  }
}

router.post("/register-account", registerAccountRoute);
router.post("/register", registerAccountRoute);

router.get("/me", requireAuth, (req, res) => {
  const approved = accountApprovedFlag(req.appUser.status, req.appUser.role);
  ok(res, {
    user: {
      id: req.authUser.id,
      phone: req.authUser.phone,
      name: req.appUser.name || null,
    },
    profile: req.appUser,
    approved,
    pending_approval: isUserAccountPending(req.appUser.status),
    access: approved ? accessFlagsForRole(req.appUser.role) : { ...accessFlagsForRole(req.appUser.role), can_place_orders: false },
  });
});

router.get("/login-destinations", requireAuth, async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) {
      return fail(res, `قاعدة البيانات غير جاهزة — ${getDatabaseConfigHint()}`, 503);
    }
    const { data: row, error } = await sb.from("users").select("*").eq("id", req.appUser.id).maybeSingle();
    if (error) return fail(res, error.message, 400);
    const profile = row || req.appUser;
    const destinations = await resolveLoginDestinations(sb, profile);
    return ok(res, {
      destinations,
      default: pickDefaultDestination(destinations, profile.role),
      user: {
        id: profile.id,
        role: profile.role,
        service_type: profile.service_type || null,
      },
    });
  } catch (e) {
    return fail(res, e.message || "تعذر تحديد وجهة الدخول", 500);
  }
});

router.post("/users/sync", requireAuth, async (req, res) => {
  try {
    const roleIn = String(req.body?.role || "").trim();
    const allowed = ["driver", "customer", "admin", "store", "restaurant", "merchant", "service"];
    const role = allowed.includes(roleIn) ? roleIn : req.appUser.role;
    const serviceType = role === "service" ? normalizeServiceType(req.body?.service_type) : null;

    let phone = req.body?.phone || req.appUser.phone;
    if (phone) {
      const e164 = toE164(phone);
      if (e164) {
        if (!isErvnowSaudiMobileE164(e164)) {
          return fail(res, "رقم غير صالح — أدخل 05xxxxxxxx أو 9665xxxxxxxx", 400);
        }
        phone = toStorageDigits(e164);
      }
    }

    const row = {
      id: req.appUser.id,
      phone,
      role,
      service_type: serviceType,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await req.supabase.from("users").upsert(row, { onConflict: "id" }).select().single();

    if (error) return fail(res, error.message, 400);
    ok(res, { profile: data });
  } catch (e) {
    fail(res, e.message || "sync failed", 500);
  }
});

router.get("/roles/check", requireAuth, requireRole("admin"), (_req, res) => {
  ok(res, { message: "admin OK" });
});

/** وسائل الدفع المعروضة في السلة (إعدادات المنصة) — للواجهة العامة */
router.get("/checkout-payment-methods", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const methods = await checkoutPaymentMethods.loadPlatformPaymentMethodsFromDb(sb);
    ok(res, { methods });
  } catch (e) {
    fail(res, e.message || String(e), 500);
  }
});

/** وسائل الدفع + إعدادات ERVENOW PAY — للواجهة العامة */
router.get("/wallet-pay-settings", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const { loadPlatformPaySettings } = require("../../shared/services/platformPaySettings");
    const settings = await loadPlatformPaySettings(sb);
    ok(res, { settings });
  } catch (e) {
    fail(res, e.message || String(e), 500);
  }
});

/** @deprecated استخدم /wallet-pay-settings */
router.get("/settings", async (_req, res) => {
  try {
    const sb = createServiceClient();
    const { loadPlatformPaySettings } = require("../../shared/services/platformPaySettings");
    const settings = await loadPlatformPaySettings(sb);
    ok(res, { settings });
  } catch (e) {
    fail(res, e.message || String(e), 500);
  }
});

/** تتبع زيارات البوابات — اختياري مع JWT */
router.post("/readiness-beacon", optionalAuth, async (req, res) => {
  try {
    const { recordPageVisit, recordRedirectError, recordRedirectEvent } = require("../../shared/utils/adminReadinessStore");
    const body = req.body || {};
    const kind = String(body.kind || "page_visit").toLowerCase();
    const userId = req.appUser?.id ? String(req.appUser.id) : body.user_id ? String(body.user_id) : null;

    if (kind === "redirect_error") {
      const errorType = String(body.error_type || "").toLowerCase();
      await recordRedirectError(errorType, {
        path: body.path || null,
        detail: body.detail || null,
        user_id: userId,
        role: req.appUser?.role || body.role || null,
        portal: body.portal || null,
      });
      return ok(res, { recorded: true });
    }

    if (kind === "redirect") {
      await recordRedirectEvent({
        portal: body.portal || null,
        role: body.role || req.appUser?.role || null,
        raw_role: body.raw_role || body.role || null,
        service_type: body.service_type || null,
        path: body.path || null,
        success: body.success !== false,
        user_id: userId,
      });
      return ok(res, { recorded: true });
    }

    await recordPageVisit({
      path: body.path || req.headers.referer || null,
      portalKey: body.portal || null,
      legacyKey: body.legacy || null,
      userId,
      role: req.appUser?.role || body.role || null,
      name: body.name || null,
      phone: req.appUser?.phone || body.phone || null,
    });
    return ok(res, { recorded: true });
  } catch (e) {
    return fail(res, e.message || String(e), 500);
  }
});

module.exports = router;
