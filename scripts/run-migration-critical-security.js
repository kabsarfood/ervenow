/**
 * يطبّق shared/migration_critical_security_lockdown.sql
 * ثم ينقل ملفات cr إلى الدلو الخاص ويحذف النسخة العامة بعد التحقق.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const PUBLIC_BUCKET = "erwenow-store-registrations";
const PRIVATE_BUCKET = "store-registration-documents";

function dbUrl() {
  const direct = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (direct) return direct;
  const pass = String(process.env.SUPABASE_DB_PASSWORD || "").trim();
  const m = String(process.env.SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!pass || !m) return null;
  return "postgresql://postgres:" + encodeURIComponent(pass) + "@db." + m[1] + ".supabase.co:5432/postgres?sslmode=require";
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function anonClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listCr(sb, bucket) {
  const names = [];
  const { data: roots, error } = await sb.storage.from(bucket).list("", { limit: 1000 });
  if (error) throw new Error(bucket + " list: " + error.message);
  for (const store of roots || []) {
    if (!store || !store.name) continue;
    if (store.id) continue;
    const { data: cr, error: crErr } = await sb.storage.from(bucket).list(store.name + "/cr", { limit: 200 });
    if (crErr) continue;
    for (const file of cr || []) {
      if (file && file.name && file.id) names.push(store.name + "/cr/" + file.name);
    }
  }
  return names;
}

async function moveCr(sb) {
  const source = await listCr(sb, PUBLIC_BUCKET);
  let copied = 0;
  for (const objectPath of source) {
    const { data, error } = await sb.storage.from(PUBLIC_BUCKET).download(objectPath);
    if (error || !data) throw new Error("download " + objectPath + " " + (error && error.message));
    const buf = Buffer.from(await data.arrayBuffer());
    const { error: upErr } = await sb.storage.from(PRIVATE_BUCKET).upload(objectPath, buf, {
      contentType: data.type || "image/jpeg",
      upsert: true,
    });
    if (upErr) throw new Error("upload " + objectPath + " " + upErr.message);
    copied += 1;
  }
  const dest = await listCr(sb, PRIVATE_BUCKET);
  const destSet = new Set(dest);
  const missing = source.filter((p) => !destSet.has(p));
  if (missing.length) throw new Error("copy incomplete: " + missing.length);
  const cols = await sb.from("stores").select("id").limit(1);
  if (cols.error) throw new Error(cols.error.message);
  const probe = await sb.from("stores").select("file_url").limit(1);
  let urls = 0;
  if (!probe.error) {
    const { data: rows, error: urlErr } = await sb.from("stores").select("id,file_url").not("file_url", "is", null);
    if (urlErr) throw new Error(urlErr.message);
    for (const row of rows || []) {
      const url = String(row.file_url || "");
      if (!url.includes("/cr/") || !url.includes(PUBLIC_BUCKET)) continue;
      const next = url.replace(PUBLIC_BUCKET, PRIVATE_BUCKET);
      const { error } = await sb.from("stores").update({ file_url: next }).eq("id", row.id);
      if (error) throw new Error("url " + error.message);
      urls += 1;
    }
  }
  if (source.length) {
    const { error: delErr } = await sb.storage.from(PUBLIC_BUCKET).remove(source);
    if (delErr) throw new Error("delete public cr: " + delErr.message);
  }
  const left = await listCr(sb, PUBLIC_BUCKET);
  return { source: source.length, copied, urls, publicLeft: left.length, privateNow: dest.length };
}

async function rpcProbe(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (!error) return { ok: true, data: data == null ? null : typeof data };
  const msg = String(error.message || error.code || "");
  const denied = /permission denied|42501/i.test(msg);
  return { ok: false, denied, message: msg.slice(0, 140) };
}

async function main() {
  const client = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const sql = fs.readFileSync(path.join(__dirname, "..", "shared", "migration_critical_security_lockdown.sql"), "utf8");
  await client.query(sql);
  await client.end();

  const sb = serviceClient();
  const anon = anonClient();
  const moved = await moveCr(sb);
  const tests = {
    service_approve: await rpcProbe(sb, "ledger_withdraw_request_approve", { p_request_id: "00000000-0000-0000-0000-000000000000" }),
    service_credit: await rpcProbe(sb, "store_wallet_credit_for_order", {
      p_store_id: null,
      p_order_id: null,
      p_amount: null,
      p_description: null,
    }),
    service_redeem: await rpcProbe(sb, "ervenow_redeem_topup_code", {
      p_user_id: null,
      p_role: "customer",
      p_code: "",
      p_phone: "",
    }),
    service_number: await rpcProbe(sb, "generate_order_number", { p_source: "security-test" }),
    service_claim: await rpcProbe(sb, "settlement_log_try_claim", {
      p_entity_id: null,
      p_entity_type: "",
      p_settlement_kind: "",
      p_metadata: {},
    }),
    anon_approve: await rpcProbe(anon, "ledger_withdraw_request_approve", { p_request_id: "00000000-0000-0000-0000-000000000000" }),
    anon_orders: await (async () => {
      const { data, error } = await anon.from("orders").select("id").limit(1);
      return { rows: (data || []).length, denied: !!(error && /permission|42501/i.test(error.message || "")) , message: error ? String(error.message).slice(0, 120) : "no-error" };
    })(),
    anon_users: await (async () => {
      const { data, error } = await anon.from("users").select("id").limit(1);
      return { rows: (data || []).length, denied: !!(error && /permission|42501/i.test(error.message || "")) , message: error ? String(error.message).slice(0, 120) : "no-error" };
    })(),
    service_orders: await (async () => {
      const { error } = await sb.from("orders").select("id").limit(1);
      return { ok: !error, message: error ? String(error.message).slice(0, 120) : "ok" };
    })(),
    service_users: await (async () => {
      const { error } = await sb.from("users").select("id").limit(1);
      return { ok: !error, message: error ? String(error.message).slice(0, 120) : "ok" };
    })(),
  };
  console.log(JSON.stringify({ moved, tests }, null, 2));
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
