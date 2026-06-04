/**
 * يضيف/يحدّث REDIS_URL في .env دون طباعة القيمة.
 * node scripts/set-redis-url.mjs [redis://127.0.0.1:6379]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const url = (process.argv[2] || "redis://127.0.0.1:6379").trim();

if (!fs.existsSync(envPath)) {
  console.error("FAIL: .env missing");
  process.exit(1);
}

let text = fs.readFileSync(envPath, "utf8");
const line = `REDIS_URL=${url}`;
if (/^REDIS_URL=/m.test(text)) {
  text = text.replace(/^REDIS_URL=.*$/m, line);
} else {
  text = text.trimEnd() + "\n" + line + "\n";
}
fs.writeFileSync(envPath, text, "utf8");
console.log("REDIS_URL_SET", url.includes("@") ? "set(with-auth)" : "set(local)");
