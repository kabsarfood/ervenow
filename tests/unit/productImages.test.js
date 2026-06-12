const {
  productImageUrlsFromRow,
  productRowWithImages,
  resolveProductRowImages,
} = require("../../shared/utils/productImages");

describe("productImages", () => {
  test("productImageUrlsFromRow merges primary and jsonb array", () => {
    const urls = productImageUrlsFromRow({
      image_url: "https://x/a.jpg",
      image_urls: ["https://x/b.jpg", "https://x/a.jpg"],
    });
    expect(urls).toEqual(["https://x/a.jpg", "https://x/b.jpg"]);
  });

  test("productRowWithImages sets image_url to first", () => {
    const row = productRowWithImages({ image_urls: ["https://x/z.jpg"] });
    expect(row.image_url).toBe("https://x/z.jpg");
    expect(row.image_urls.length).toBe(1);
  });

  test("resolveProductRowImages refreshes signed urls", async () => {
    const sb = {};
    const resolve = jest.fn(async (_sb, url) =>
      String(url).includes("expired") ? "https://cdn.example/fresh.jpg" : url
    );
    const row = await resolveProductRowImages(
      sb,
      { id: "p1", image_url: "https://cdn.example/expired.jpg", image_urls: ["https://cdn.example/expired.jpg"] },
      resolve
    );
    expect(row.image_url).toBe("https://cdn.example/fresh.jpg");
    expect(resolve).toHaveBeenCalled();
  });
});
