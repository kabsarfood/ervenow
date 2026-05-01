const express = require("express");
const twilio = require("twilio");
const { createServiceClient } = require("../../shared/config/supabase");
const { ok, fail } = require("../../shared/utils/helpers");
const { normalizePhone } = require("../../shared/utils/phone");

const router = express.Router();

const STORE_TYPES = new Set([
  "restaurant",
  "pharmacy",
  "supermarket",
  "minimarket",
  "vegetables",
  "butcher",
  "fish",
  "home_business",
  "services",
]);

const TYPE_LABEL_AR = {
  restaurant: "مطعم",
  pharmacy: "صيدلية",
  supermarket: "سوبرماركت",
  minimarket: "ميني ماركت",
  vegetables: "محل خضار",
  butcher: "ملحمة",
  fish: "بيع الأسماك",
  home_business: "أسرة منتجة",
  services: "خدمات",
};

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function waFrom() {
  let n = String(process.env.TWILIO_WHATSAPP_NUMBER || "").trim();
  if (!n) return null;
  if (!n.startsWith("whatsapp:")) n = "whatsapp:" + n.replace(/^\+/, "+");
  return n;
}

function parseBase64File(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) {
    try {
      return { mime: m[1].trim() || "image/jpeg", buffer: Buffer.from(m[2], "base64") };
    } catch {
      return null;
    }
  }
  try {
    return { mime: "application/octet-stream", buffer: Buffer.from(s, "base64") };
  } catch {
    return null;
  }
}

function safeFilePart(name) {
  const n = String(name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return n || "upload";
}

function isStoresTableMissing(err) {
  if (!err) return false;
  if (String(err.code || "") === "42P01") return true;
  const msg = String(err.message || err.details || "");
  return /public\.stores|schema cache|relation .*stores/i.test(msg);
}

async function uploadCommercialFile(sb, storeId, base64, originalName) {
  const bucket = String(
    process.env.ERVENOW_STORE_FILES_BUCKET ||
      process.env.ERWENOW_STORE_FILES_BUCKET ||
      "erwenow-store-registrations"
  ).trim();
  const parsed = parseBase64File(base64);
  if (!parsed || !parsed.buffer.length) return null;

  const ext =
    parsed.mime.includes("png") ? "png" : parsed.mime.includes("webp") ? "webp" : "jpg";
  const objectPath = `${storeId}/${Date.now()}_${safeFilePart(originalName)}.${ext}`;

  const { error: upErr } = await sb.storage.from(bucket).upload(objectPath, parsed.buffer, {
    contentType: parsed.mime,
    upsert: false,
  });
  if (upErr) {
    console.error("[store/register] storage upload:", upErr.message || upErr);
    return null;
  }

  const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return pub && pub.publicUrl ? pub.publicUrl : null;
}

async function notifyAdminWhatsApp({ name, phoneDisplay, typeLabel, mapsUrl, requestId }) {
  const client = getTwilioClient();
  const from = waFrom();
  const adminRaw = String(
    process.env.ERVENOW_ADMIN_WHATSAPP || process.env.ERWENOW_ADMIN_WHATSAPP || ""
  ).trim();
  const adminDigits = adminRaw.replace(/\D/g, "");
  if (!client || !from || adminDigits.length < 10) {
    console.warn("[store/register] WhatsApp: Twilio أو ERVENOW_ADMIN_WHATSAPP غير مضبوط");
    return false;
  }
  const to = "whatsapp:+" + adminDigits;
  const body =
    `طلب تسجيل متجر جديد\n` +
    `الاسم: ${name}\n` +
    `الجوال: ${phoneDisplay}\n` +
    `النوع: ${typeLabel}\n` +
    `الموقع: ${mapsUrl}\n` +
    `رقم الطلب: ${requestId}`;
  await client.messages.create({ from, to, body });
  return true;
}

router.post("/register", async (req, res) => {
  try {
    const sb = createServiceClient();
    if (!sb) {
      return fail(res, "الخادم غير مهيأ لقاعدة البيانات (SUPABASE_SERVICE_ROLE_KEY)", 503);
    }

    const b = req.body || {};
    const name = String(b.name || "").trim();
    const phoneRaw = String(b.phone || "").trim();
    const email = String(b.email || "").trim() || null;
    const commercial_register = String(b.commercial_register || "").trim() || null;
    const type = String(b.type || "").trim().toLowerCase();

    let lat = b.lat;
    let lng = b.lng;
    if (lat != null && lat !== "") lat = Number(lat);
    else lat = null;
    if (lng != null && lng !== "") lng = Number(lng);
    else lng = null;
    if (lat != null && (Number.isNaN(lat) || lng == null || Number.isNaN(lng))) {
      return fail(res, "إحداثيات الموقع غير صالحة", 400);
    }
    if (lat != null && lng != null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
      return fail(res, "إحداثيات الموقع غير صالحة", 400);
    }

    if (!name || name.length < 2) return fail(res, "اسم المتجر مطلوب", 400);
    const phoneDigits = normalizePhone(phoneRaw);
    if (!phoneDigits || phoneDigits.length < 10) return fail(res, "رقم الجوال غير صالح", 400);
    if (!STORE_TYPES.has(type)) return fail(res, "نوع النشاط غير صالح", 400);

    const phoneDisplay = phoneRaw || phoneDigits;

    const row = {
      name,
      phone: phoneDigits,
      email,
      commercial_register,
      file_url: null,
      lat,
      lng,
      type,
      status: "pending",
    };

    const { data: inserted, error: insErr } = await sb.from("stores").insert(row).select("id").single();
    if (insErr) {
      console.error("[store/register] insert:", insErr);
      if (isStoresTableMissing(insErr)) {
        return fail(
          res,
          "جدول stores غير موجود في قاعدة البيانات. نفّذ migration_stores.sql في Supabase ثم أعد المحاولة.",
          400
        );
      }
      return fail(
        res,
        insErr.message || "تعذر حفظ الطلب — نفّذ migration_stores.sql في Supabase",
        400
      );
    }

    const requestId = inserted.id;
    let fileUrl = null;
    if (b.commercialRegisterFileBase64) {
      fileUrl = await uploadCommercialFile(sb, requestId, b.commercialRegisterFileBase64, b.commercialRegisterFileName);
      if (fileUrl) {
        await sb.from("stores").update({ file_url: fileUrl }).eq("id", requestId);
      }
    }

    const mapsUrl =
      lat != null && lng != null
        ? `https://maps.google.com/?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
        : "— (لم يُحدد)";

    const typeLabel = TYPE_LABEL_AR[type] || type;

    try {
      await notifyAdminWhatsApp({
        name,
        phoneDisplay,
        typeLabel,
        mapsUrl,
        requestId,
      });
    } catch (waErr) {
      console.error("[store/register] WhatsApp:", waErr.message || waErr);
    }

    return ok(res, {
      success: true,
      id: requestId,
      message: "تم استلام طلبك وسيتم مراجعته قريباً",
    });
  } catch (e) {
    console.error("[store/register]", e);
    return fail(res, e.message || "خطأ في الخادم", 500);
  }
});

module.exports = router;
