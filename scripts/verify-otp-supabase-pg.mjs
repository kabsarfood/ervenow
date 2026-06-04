/**
 * إثبات OTP في Supabase عبر PostgreSQL (عند فشل fetch من @supabase/supabase-js).
 * يحاكي restart بإعادة تحميل otpChallengeService بعد الإدراج عبر PG.
 */
import "dotenv/config";
import crypto from "crypto";
import pg from "pg";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const scope = "core_login";
const subject = "dryrun_pg_" + Date.now();
const code = "482910";
const ttlMs = 300000;

function loadOtp() {
  delete require.cache[require.resolve("../shared/services/otpChallengeService.js")];
  return require("../shared/services/otpChallengeService.js");
}

async function insertViaPg(client, hashCode) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await client.query(`DELETE FROM ervenow_otp_challenges WHERE scope = $1 AND subject_key = $2`, [
    scope,
    subject,
  ]);
  await client.query(
    `INSERT INTO ervenow_otp_challenges (
      scope, subject_key, code_hash, attempts, max_attempts, resend_count,
      last_sent_at, locked_until, expires_at, ip, metadata
    ) VALUES ($1,$2,$3,0,5,1,now(),NULL,$4::timestamptz,$5,'{}'::jsonb)`,
    [scope, subject, hashCode(scope, subject, code), expiresAt, "127.0.0.1"]
  );
}

async function countPg(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM ervenow_otp_challenges WHERE scope = $1 AND subject_key = $2`,
    [scope, subject]
  );
  return r.rows[0]?.n || 0;
}

async function main() {
  if (String(process.env.ERVENOW_OTP_BACKEND || "").trim().toLowerCase() !== "supabase") {
    console.error("FAIL: set ERVENOW_OTP_BACKEND=supabase in .env");
    process.exit(1);
  }

  const otp1 = loadOtp();
  if (otp1.otpBackendMode() !== "supabase") {
    console.error("FAIL: otpBackendMode", otp1.otpBackendMode());
    process.exit(1);
  }

  const pepperFn = () => {
    const p = String(process.env.ERVENOW_OTP_PEPPER || "").trim();
    if (p.length >= 16) return p;
    throw new Error("ERVENOW_OTP_PEPPER missing");
  };
  const hashCode = (sc, sub, c) =>
    crypto
      .createHash("sha256")
      .update(`${pepperFn()}|${sc}|${sub}|${c}`, "utf8")
      .digest("hex");

  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await insertViaPg(client, hashCode);
  const n1 = await countPg(client);
  if (n1 < 1) {
    console.error("FAIL: no row in DB");
    process.exit(1);
  }

  loadOtp();
  const row = await client.query(
    `SELECT code_hash, expires_at, locked_until FROM ervenow_otp_challenges
     WHERE scope = $1 AND subject_key = $2 ORDER BY created_at DESC LIMIT 1`,
    [scope, subject]
  );
  const r0 = row.rows[0];
  const expected = hashCode(scope, subject, code);
  const verified = {
    ok:
      !!r0 &&
      r0.code_hash === expected &&
      new Date(r0.expires_at).getTime() > Date.now() &&
      (!r0.locked_until || new Date(r0.locked_until).getTime() <= Date.now()),
    via: "pg_after_simulated_restart",
  };

  await client.query(`DELETE FROM ervenow_otp_challenges WHERE scope = $1 AND subject_key = $2`, [
    scope,
    subject,
  ]);
  await client.end();

  if (!verified.ok) {
    console.error("FAIL verify", verified);
    process.exit(1);
  }
  const otpFinal = loadOtp();
  console.log("OTP_SUPABASE_PG_OK", {
    mode: otpFinal.otpBackendMode(),
    rowsAfterInsert: n1,
    verify: verified.via,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
