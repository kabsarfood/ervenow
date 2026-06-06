const { storageObjectPathFromUrl } = require("../../shared/utils/storeFileUpload");

describe("storeFileUpload", () => {
  test("storageObjectPathFromUrl parses public Supabase object URL", () => {
    const url =
      "https://xxx.supabase.co/storage/v1/object/public/erwenow-store-registrations/abc/logo/1_x.jpg";
    expect(storageObjectPathFromUrl(url, "erwenow-store-registrations")).toBe("abc/logo/1_x.jpg");
  });

  test("storageObjectPathFromUrl returns null for external URLs", () => {
    expect(storageObjectPathFromUrl("https://cdn.example.com/a.png", "erwenow-store-registrations")).toBe(
      null
    );
  });
});
