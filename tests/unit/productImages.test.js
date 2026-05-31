const test = require("node:test");
const assert = require("node:assert/strict");
const { productImageUrlsFromRow, productRowWithImages } = require("../../shared/utils/productImages");

test("productImageUrlsFromRow merges primary and jsonb array", () => {
  const urls = productImageUrlsFromRow({
    image_url: "https://x/a.jpg",
    image_urls: ["https://x/b.jpg", "https://x/a.jpg"],
  });
  assert.deepEqual(urls, ["https://x/a.jpg", "https://x/b.jpg"]);
});

test("productRowWithImages sets image_url to first", () => {
  const row = productRowWithImages({ image_urls: ["https://x/z.jpg"] });
  assert.equal(row.image_url, "https://x/z.jpg");
  assert.equal(row.image_urls.length, 1);
});
