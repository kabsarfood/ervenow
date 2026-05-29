/**
 * ERVENOW PAY — طلبات شحن STC Pay + أكواد واتساب
 */

const crypto = require("crypto");
const { normalizePhone } = require("../utils/phone");
const { mapAppRoleToLedgerWalletRole } = require("../utils/ervenowLedgerWallet");
const { sendWhatsApp } = require("../utils/whatsapp");
const { assertTopupEnabled } = require("./platformPaySettings");

const CODE_TTL_MS = 30 * 60 * 1000;

function isMissingTopupTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || err);
  return /wallet_topup|does not exist|schema cache|PGRST205|42P01/i.test(msg);
}

function migrationMissingError() {
  const err = new Error("نفّذ shared/migration_wallet_topup_pay.sql على Supabase");
  err.code = "MIGRATION_MISSING";
  err.statusCode = 503;
  return err;
}

function randomCodeSuffix(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

function buildTopupCode(amount) {
  const amt = Math.round(Number(amount) || 0);
  return `EW-${amt}-${randomCodeSuffix(6)}`;
}

function buildTopupWhatsAppMessage(code) {
  return (
    "تم استلام تحويلك ✅\n\n" +
    "كود الشحن:\n" +
    String(code || "").trim() +
    "\n\n" +
    "ادخله في منصة ERVENOW لشحن رصيدك."
  );
}

function resolveRequestPhone(appUser, bodyPhone) {
  const fromBody = normalizePhone(bodyPhone);
  if (fromBody && fromBody.length >= 10) return fromBody;
  const fromUser = normalizePhone(appUser?.phone);
  if (fromUser && fromUser.length >= 10) return fromUser;
  return "";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function createTopupRequest(sb, appUser, body) {
  const settings = await assertTopupEnabled(sb);
  const amount = Number(body?.amount);
  const min = Number(settings.min_topup_amount) || 30;
  const max = Number(settings.max_topup_amount) || 5000;

  if (!Number.isFinite(amount) || amount < min) {
    const err = new Error(`الحد الأدنى للشحن ${min} ريال`);
    err.statusCode = 400;
    throw err;
  }
  if (amount > max) {
    const err = new Error(`الحد الأعلى للشحن ${max} ريال`);
    err.statusCode = 400;
    throw err;
  }

  const phone = resolveRequestPhone(appUser, body?.phone);
  if (!phone) {
    const err = new Error("رقم الجوال مطلوب — سجّله في حسابك أو أدخله في الطلب");
    err.statusCode = 400;
    throw err;
  }

  const { data: pending, error: pendErr } = await sb
    .from("wallet_topup_requests")
    .select("id")
    .eq("user_id", appUser.id)
    .eq("status", "pending")
    .limit(1);
  if (pendErr) {
    if (isMissingTopupTable(pendErr)) throw migrationMissingError();
    throw pendErr;
  }
  if ((pending || []).length) {
    const err = new Error("لديك طلب شحن قيد المراجعة — انتظر موافقة الإدارة");
    err.statusCode = 409;
    throw err;
  }

  const { data, error } = await sb
    .from("wallet_topup_requests")
    .insert({
      user_id: appUser.id,
      phone,
      amount: Math.round(amount * 100) / 100,
      status: "pending",
      proof_image: body?.proof_image ? String(body.proof_image).trim().slice(0, 2000) : null,
    })
    .select("id, user_id, phone, amount, status, created_at")
    .single();

  if (error) {
    if (isMissingTopupTable(error)) throw migrationMissingError();
    throw error;
  }

  return {
    request: data,
    message: "تم إرسال طلب الشحن — سيتم إرسال كود واتساب بعد موافقة الإدارة",
    stcpay_display_number: settings.stcpay_display_number,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listTopupRequests(sb, opts) {
  const status = opts?.status ? String(opts.status).trim() : null;
  const limit = Math.min(Math.max(Number(opts?.limit) || 100, 1), 200);

  let q = sb
    .from("wallet_topup_requests")
    .select("id, user_id, phone, amount, status, created_at, approved_at, rejected_at, admin_note")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    if (isMissingTopupTable(error)) throw migrationMissingError();
    throw error;
  }
  return data || [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function listTopupCodes(sb, opts) {
  const limit = Math.min(Math.max(Number(opts?.limit) || 100, 1), 200);
  const { data, error } = await sb
    .from("wallet_topup_codes")
    .select("id, code, amount, phone, user_id, is_used, expires_at, created_at, used_at, request_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTopupTable(error)) throw migrationMissingError();
    throw error;
  }
  return data || [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function approveTopupRequest(sb, requestId, adminNote) {
  const id = String(requestId || "").trim();
  if (!id) {
    const err = new Error("معرّف الطلب مطلوب");
    err.statusCode = 400;
    throw err;
  }

  const { data: reqRow, error: fetchErr } = await sb
    .from("wallet_topup_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    if (isMissingTopupTable(fetchErr)) throw migrationMissingError();
    throw fetchErr;
  }
  if (!reqRow) {
    const err = new Error("الطلب غير موجود");
    err.statusCode = 404;
    throw err;
  }
  if (reqRow.status !== "pending") {
    const err = new Error("الطلب ليس قيد الانتظار");
    err.statusCode = 400;
    throw err;
  }

  const amount = Number(reqRow.amount) || 0;
  const code = buildTopupCode(amount);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const now = new Date().toISOString();

  const { error: codeErr } = await sb.from("wallet_topup_codes").insert({
    code,
    amount,
    phone: reqRow.phone,
    user_id: reqRow.user_id,
    request_id: reqRow.id,
    is_used: false,
    expires_at: expiresAt,
  });

  if (codeErr) {
    if (isMissingTopupTable(codeErr)) throw migrationMissingError();
    throw codeErr;
  }

  const { error: updErr } = await sb
    .from("wallet_topup_requests")
    .update({
      status: "approved",
      approved_at: now,
      admin_note: adminNote ? String(adminNote).trim().slice(0, 500) : null,
    })
    .eq("id", id)
    .eq("status", "pending");

  if (updErr) throw updErr;

  let sent = false;
  try {
    sent = await sendWhatsApp({
      to: reqRow.phone,
      message: buildTopupWhatsAppMessage(code),
    });
  } catch (_e) {
    sent = false;
  }

  return {
    ok: true,
    request_id: id,
    code,
    expires_at: expiresAt,
    whatsapp_sent: sent,
    message: sent
      ? "تمت الموافقة وإرسال الكود عبر واتساب"
      : "تمت الموافقة — تعذّر إرسال واتساب تلقائياً (تحقق من Twilio)",
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function rejectTopupRequest(sb, requestId, adminNote) {
  const id = String(requestId || "").trim();
  if (!id) {
    const err = new Error("معرّف الطلب مطلوب");
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("wallet_topup_requests")
    .update({
      status: "rejected",
      rejected_at: now,
      admin_note: adminNote ? String(adminNote).trim().slice(0, 500) : null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();

  if (error) {
    if (isMissingTopupTable(error)) throw migrationMissingError();
    throw error;
  }
  if (!data) {
    const err = new Error("الطلب غير موجود أو ليس قيد الانتظار");
    err.statusCode = 404;
    throw err;
  }

  return { ok: true, message: "تم رفض طلب الشحن" };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 */
async function redeemTopupCode(sb, appUser, codeRaw) {
  await assertTopupEnabled(sb);

  const code = String(codeRaw || "").trim();
  if (!code) {
    const err = new Error("أدخل كود الشحن");
    err.statusCode = 400;
    throw err;
  }

  const phone = resolveRequestPhone(appUser, null);
  const ledgerRole = mapAppRoleToLedgerWalletRole(appUser.role);

  const { data, error } = await sb.rpc("ervenow_redeem_topup_code", {
    p_user_id: appUser.id,
    p_role: ledgerRole,
    p_code: code,
    p_phone: phone,
  });

  if (error) {
    if (/ervenow_redeem_topup_code|function.*not found/i.test(String(error.message || ""))) {
      throw migrationMissingError();
    }
    throw error;
  }

  const row = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  if (row.ok !== true && row.ok !== "true") {
    const reason = String(row.reason || "redeem_failed");
    const messages = {
      code_not_found: "كود الشحن غير صحيح",
      code_already_used: "تم استخدام هذا الكود مسبقاً",
      code_expired: "انتهت صلاحية الكود — اطلب كوداً جديداً من الإدارة",
      code_not_for_user: "هذا الكود لا يخص حسابك",
      deposit_failed: "تعذّر إضافة الرصيد — تواصل مع الدعم",
    };
    const err = new Error(messages[reason] || reason);
    err.statusCode = 400;
    throw err;
  }

  return {
    ok: true,
    amount: Number(row.amount) || 0,
    code: row.code || code,
    message: `تم شحن ${Number(row.amount || 0).toFixed(2)} ر.س بنجاح`,
  };
}

module.exports = {
  CODE_TTL_MS,
  buildTopupCode,
  buildTopupWhatsAppMessage,
  createTopupRequest,
  listTopupRequests,
  listTopupCodes,
  approveTopupRequest,
  rejectTopupRequest,
  redeemTopupCode,
};
