/**
 * تطبيق بنية الشعار/الغلاف على Supabase: دلو Storage عام + جداول + تحقق رفع.
 * node scripts/apply-store-branding-infra.mjs
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { uploadToStoreBucket, resolveStoreImageUrl } = require("../shared/utils/storeFileUpload.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bucket = String(
  process.env.ERVENOW_STORE_FILES_BUCKET || process.env.ERWENOW_STORE_FILES_BUCKET || "erwenow-store-registrations"
).trim();

const dbUrl = String(process.env.SUPABASE_DB_URL || "").trim();
if (!dbUrl) {
  console.error("FAIL: SUPABASE_DB_URL missing");
  process.exit(1);
}

function readSql(name) {
  return fs.readFileSync(path.join(root, "shared", name), "utf8");
}

async function runPg() {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await c.query(readSql("migration_store_marketplace.sql"));
  await c.query(readSql("migration_store_merchant_hub.sql"));
  await c.query(readSql("migration_store_storage_public_read.sql"));

  await c.query(
    `
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ($1, $1, true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[])
    ON CONFLICT (id) DO UPDATE SET
      public = true,
      file_size_limit = GREATEST(storage.buckets.file_size_limit, 10485760)
    `,
    [bucket]
  );

  const checks = await c.query(
    `
    SELECT
      (SELECT public FROM storage.buckets WHERE id = $1) AS bucket_public,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='store_merchant_hub') AS hub_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='stores' AND column_name='logo_url'
      ) AS logo_column,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ervenow_store_files_public_read'
      ) AS read_policy
    `,
    [bucket]
  );
  await c.end();
  return checks.rows[0];
}

async function testUpload(sb) {
  const testId = "00000000-0000-4000-8000-000000000099";
  const tiny =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let uploadErr = null;
  const bucketName = bucket;
  const parsed = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const objectPath = `${testId}/verify/probe.png`;
  const { error: upErr } = await sb.storage.from(bucketName).upload(objectPath, parsed, {
    contentType: "image/png",
    upsert: true,
  });
  if (upErr) uploadErr = upErr.message || String(upErr);
  const url = uploadErr ? null : await uploadToStoreBucket(sb, testId, "verify2", tiny, "probe2.png");
  if (!url && !uploadErr) uploadErr = "upload returned null";
  if (!url) return { ok: false, reason: uploadErr || "upload failed" };
  const resolved = await resolveStoreImageUrl(sb, url);
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(resolved || url, { method: "HEAD", signal: ac.signal });
    clearTimeout(t);
    return { ok: res.ok, status: res.status, url: resolved || url };
  } catch (e) {
    return { ok: false, reason: e.message || String(e), url: resolved || url };
  }
}

async function main() {
  console.log("Applying store branding infra…");
  const pgResult = await runPg();
  console.log("PG_OK", {
    bucket,
    bucket_public: pgResult.bucket_public,
    hub_table: pgResult.hub_table,
    logo_column: pgResult.logo_column,
    read_policy: pgResult.read_policy,
  });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("SKIP_UPLOAD_TEST: SUPABASE_URL or SERVICE_ROLE_KEY missing");
    process.exit(pgResult.bucket_public && pgResult.hub_table && pgResult.logo_column ? 0 : 1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const up = await testUpload(sb);
  console.log("UPLOAD_TEST", up);

  const pgOk =
    pgResult.bucket_public && pgResult.hub_table && pgResult.logo_column && pgResult.read_policy;

  if (!pgOk) process.exit(1);

  if (up.ok) {
    console.log("STORE_BRANDING_INFRA_OK");
    return;
  }

  const netOnly = /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(String(up.reason || ""));
  if (netOnly) {
    console.log("STORE_BRANDING_INFRA_PG_OK");
    console.log(
      "ملاحظة: قاعدة البيانات والدلو جاهزان — اختبار الرفع من هذه الشبكة فشل (fetch). أعد رفع الشعار/الغلاف من المتصفح أو من Railway."
    );
    return;
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
