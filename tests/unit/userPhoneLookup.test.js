const {
  canonicalPhoneDigits,
  phoneLookupVariants,
  phonesEquivalent,
} = require("../../shared/utils/userPhoneLookup");

describe("userPhoneLookup", () => {
  test("canonicalPhoneDigits normalizes 05 and 9665", () => {
    expect(canonicalPhoneDigits("0512345678")).toBe("966512345678");
    expect(canonicalPhoneDigits("966512345678")).toBe("966512345678");
    expect(canonicalPhoneDigits("+966512345678")).toBe("966512345678");
    expect(canonicalPhoneDigits("512345678")).toBe("966512345678");
  });

  test("phoneLookupVariants includes local and E.164 forms", () => {
    const variants = phoneLookupVariants("0512345678");
    expect(variants).toContain("0512345678");
    expect(variants).toContain("966512345678");
    expect(variants).toContain("+966512345678");
    expect(variants).toContain("512345678");
  });

  test("phonesEquivalent matches mixed storage formats", () => {
    expect(phonesEquivalent("0512345678", "+966512345678")).toBe(true);
    expect(phonesEquivalent("966512345678", "0512345678")).toBe(true);
    expect(phonesEquivalent("0512345678", "0512345679")).toBe(false);
  });
});
