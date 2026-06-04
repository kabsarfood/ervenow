/**
 * يحدّث .env لموانع الإطلاق دون طباعة القيم السرية.
 * تشغيل: node scripts/patch-launch-env.mjs
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  const order = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      map.set(m[1], m[2]);
      order.push({ type: "kv", key: m[1], raw: line });
    } else {
      order.push({ type: "other", raw: line });
    }
  }
  return { map, order, lines };
}

function serialize(order, map) {
  const out = [];
  const written = new Set();
  for (const item of order) {
    if (item.type === "kv") {
      const v = map.get(item.key);
      out.push(`${item.key}=${v ?? ""}`);
      written.add(item.key);
    } else {
      out.push(item.raw);
    }
  }
  for (const [k, v] of map) {
    if (!written.has(k)) out.push(`${k}=${v}`);
  }
  return out.join("\n") + (out.length ? "\n" : "");
}

function setKey(map, key, value) {
  map.set(key, value);
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.error("FAIL: .env not found");
    process.exit(1);
  }
  const text = fs.readFileSync(envPath, "utf8");
  const { map, order } = parseEnv(text);

  setKey(map, "ERVENOW_OTP_BACKEND", "supabase");
  if (!String(map.get("ERVENOW_OTP_PEPPER") || "").trim() || String(map.get("ERVENOW_OTP_PEPPER")).length < 16) {
    setKey(map, "ERVENOW_OTP_PEPPER", crypto.randomBytes(32).toString("hex"));
  }
  if (!String(map.get("ERVENOW_PUBLIC_URL") || "").trim()) {
    setKey(map, "ERVENOW_PUBLIC_URL", "https://ervenow.com");
  }
  if (!String(map.get("FINANCE_MODE") || "").trim()) {
    setKey(map, "FINANCE_MODE", "ledger_only");
  }
  // لا تُعيّن REDIS_URL تلقائياً — BullMQ يتطلب Redis ≥ 5 (Railway Redis / Upstash / Memurai).

  fs.writeFileSync(envPath, serialize(order, map), "utf8");
  const report = {
    ERVENOW_OTP_BACKEND: map.get("ERVENOW_OTP_BACKEND"),
    ERVENOW_OTP_PEPPER: String(map.get("ERVENOW_OTP_PEPPER") || "").length >= 16 ? "set(len>=16)" : "MISSING",
    ERVENOW_PUBLIC_URL: map.get("ERVENOW_PUBLIC_URL") ? "set" : "missing",
    REDIS_URL: String(map.get("REDIS_URL") || "").trim() ? "set" : "still empty — add Upstash/Railway Redis URL",
    FINANCE_MODE: map.get("FINANCE_MODE") || "(unset)",
  };
  console.log("PATCH_LAUNCH_ENV_OK", report);
}

main();
