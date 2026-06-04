/**
 * إثبات OTP في Supabase يبقى بعد "restart" (محاكاة بإعادة تحميل الوحدة).
 */
import "dotenv/config";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

process.env.ERVENOW_OTP_BACKEND = "supabase";
if (!process.env.ERVENOW_OTP_PEPPER || process.env.ERVENOW_OTP_PEPPER.length < 16) {
  process.env.ERVENOW_OTP_PEPPER =
    process.env.ERVENOW_OTP_PEPPER ||
    crypto.randomBytes(32).toString("hex");
}

const { startOtpChallenge, verifyOtpChallenge, otpBackendMode } = require("../shared/services/otpChallengeService.js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const scope = "core_login";
const subject = "dryrun_" + Date.now();
const code = "482910";

async function countRows() {
  const { count, error } = await sb
    .from("ervenow_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("scope", scope)
    .eq("subject_key", subject);
  if (error) throw error;
  return count || 0;
}

async function main() {
  if (otpBackendMode() !== "supabase") {
    console.error("FAIL: otpBackendMode is not supabase", otpBackendMode());
    process.exit(1);
  }

  const started = await startOtpChallenge({
    sb,
    mode: "supabase",
    scope,
    subjectKey: subject,
    code,
    ttlMs: 300000,
    ip: "127.0.0.1",
  });
  if (!started.ok) {
    console.error("FAIL start", started);
    process.exit(1);
  }
  const n1 = await countRows();
  if (n1 < 1) {
    console.error("FAIL: no row after start");
    process.exit(1);
  }

  delete require.cache[require.resolve("../shared/services/otpChallengeService.js")];
  const fresh = require("../shared/services/otpChallengeService.js");
  const verified = await fresh.verifyOtpChallenge({
    sb,
    mode: "supabase",
    scope,
    subjectKey: subject,
    code,
  });
  if (!verified.ok) {
    console.error("FAIL verify after reload", verified);
    process.exit(1);
  }

  await sb.from("ervenow_otp_challenges").delete().eq("scope", scope).eq("subject_key", subject);
  console.log("OTP_SUPABASE_OK", { mode: fresh.otpBackendMode(), rowsAfterStart: n1 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
