#!/usr/bin/env node
/**
 * يزرع أول admin فقط إذا:
 *   ERVENOW_BOOTSTRAP_ADMIN_CONFIRM=1
 *   ERVENOW_BOOTSTRAP_ADMIN_PHONE=05xxxxxxxx أو 9665...
 * ولا يوجد admin مسبقاً. ليس API عاماً.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function digits(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
  if (d.startsWith("5") && d.length === 9) d = "966" + d;
  return d;
}

async function main() {
  const confirm = String(process.env.ERVENOW_BOOTSTRAP_ADMIN_CONFIRM || "").trim() === "1";
  const phone = digits(process.env.ERVENOW_BOOTSTRAP_ADMIN_PHONE || process.env.ERVENOW_ADMIN_LOGIN_PHONE || "");
  if (!confirm) {
    console.log("[seed-admin] skipped — set ERVENOW_BOOTSTRAP_ADMIN_CONFIRM=1 to run");
    process.exit(0);
  }
  if (!phone || phone.length < 12) {
    console.error("[seed-admin] ERVENOW_BOOTSTRAP_ADMIN_PHONE required");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("[seed-admin] SUPABASE_URL / SERVICE_ROLE missing");
    process.exit(1);
  }

  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const existing = await sb.from("users").select("id").eq("role", "admin").limit(1).maybeSingle();
  if (existing.data && existing.data.id) {
    console.log("[seed-admin] admin already exists — no write");
    process.exit(0);
  }

  const found = await sb.from("users").select("id, role").eq("phone", phone).maybeSingle();
  if (found.error) {
    console.error("[seed-admin] lookup failed");
    process.exit(1);
  }
  if (!found.data) {
    console.error("[seed-admin] no user row for that phone — register the user first, then re-run");
    process.exit(1);
  }

  const up = await sb
    .from("users")
    .update({ role: "admin", status: "active", updated_at: new Date().toISOString() })
    .eq("id", found.data.id)
    .select("id, role")
    .maybeSingle();
  if (up.error) {
    console.error("[seed-admin] update failed");
    process.exit(1);
  }
  console.log("[seed-admin] promoted existing user to admin", String(up.data && up.data.id).slice(0, 8) + "…");
}

main().catch(() => {
  console.error("[seed-admin] failed");
  process.exit(1);
});
