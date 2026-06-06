const {
  parseMapsUrl,
  parseLatLngPair,
  isShortMapsLink,
  resolveMapsLink,
} = require("../../shared/utils/mapsUrlParser");

describe("mapsUrlParser", () => {
  test("parseLatLngPair with spaces", () => {
    expect(parseLatLngPair("24.7136, 46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
  });

  test("google maps @ lat,lng", () => {
    var ll = parseMapsUrl("https://www.google.com/maps/@24.7135517,46.6752957,15z");
    expect(ll.lat).toBeCloseTo(24.7135517, 4);
    expect(ll.lng).toBeCloseTo(46.6752957, 4);
  });

  test("google maps q= lat,lng", () => {
    var ll = parseMapsUrl("https://www.google.com/maps?q=24.7136,46.6753");
    expect(ll).toEqual({ lat: 24.7136, lng: 46.6753 });
  });

  test("encoded query", () => {
    var ll = parseMapsUrl("https://www.google.com/maps/search/?api=1&query=24.7136%2C46.6753");
    expect(ll).toEqual({ lat: 24.7136, lng: 46.6753 });
  });

  test("!3d !4d in place url", () => {
    var url =
      "https://www.google.com/maps/place/Test/@24.7000,46.6000,17z/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d24.7135517!4d46.6752957";
    var ll = parseMapsUrl(url);
    expect(ll.lat).toBeCloseTo(24.7135517, 4);
    expect(ll.lng).toBeCloseTo(46.6752957, 4);
  });

  test("dir first waypoint", () => {
    var ll = parseMapsUrl("https://www.google.com/maps/dir/24.1,46.1/24.2,46.2/");
    expect(ll).toEqual({ lat: 24.1, lng: 46.1 });
  });

  test("detects maps.app.goo.gl short link", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/zPFemAXvgC9pvBPT6")).toBe(true);
    expect(parseMapsUrl("https://maps.app.goo.gl/zPFemAXvgC9pvBPT6")).toBeNull();
  });

  test("apple maps ll=", () => {
    var ll = parseMapsUrl("https://maps.apple.com/?ll=24.7136,46.6753");
    expect(ll).toEqual({ lat: 24.7136, lng: 46.6753 });
  });

  test("resolves maps.app.goo.gl via redirect (mocked fetch)", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: {
        get: (name) =>
          String(name).toLowerCase() === "location"
            ? "https://www.google.com/maps/@24.7135517,46.6752957,15z"
            : null,
      },
      text: async () => "",
    });
    try {
      var out = await resolveMapsLink("https://maps.app.goo.gl/zPFemAXvgC9pvBPT6");
      expect(out).not.toBeNull();
      expect(Number.isFinite(out.lat)).toBe(true);
      expect(Number.isFinite(out.lng)).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
