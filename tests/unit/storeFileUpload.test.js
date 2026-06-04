const { test } = require("node:test");
const assert = require("node:assert/strict");
const { storageObjectPathFromUrl } = require("../../shared/utils/storeFileUpload");

test("storageObjectPathFromUrl parses public Supabase object URL", () => {
  const url =
    "https://xxx.supabase.co/storage/v1/object/public/erwenow-store-registrations/abc/logo/1_x.jpg";
  assert.equal(storageObjectPathFromUrl(url, "erwenow-store-registrations"), "abc/logo/1_x.jpg");
});

test("storageObjectPathFromUrl returns null for external URLs", () => {
  assert.equal(storageObjectPathFromUrl("https://cdn.example.com/a.png", "erwenow-store-registrations"), null);
});
