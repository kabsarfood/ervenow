const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalPhoneDigits,
  phoneLookupVariants,
  phonesEquivalent,
} = require("../../shared/utils/userPhoneLookup");

test("canonicalPhoneDigits normalizes 05 and 9665", () => {
  assert.equal(canonicalPhoneDigits("0512345678"), "966512345678");
  assert.equal(canonicalPhoneDigits("966512345678"), "966512345678");
  assert.equal(canonicalPhoneDigits("+966512345678"), "966512345678");
  assert.equal(canonicalPhoneDigits("512345678"), "966512345678");
});

test("phoneLookupVariants includes local and E.164 forms", () => {
  const variants = phoneLookupVariants("0512345678");
  assert.ok(variants.includes("0512345678"));
  assert.ok(variants.includes("966512345678"));
  assert.ok(variants.includes("+966512345678"));
  assert.ok(variants.includes("512345678"));
});

test("phonesEquivalent matches mixed storage formats", () => {
  assert.equal(phonesEquivalent("0512345678", "+966512345678"), true);
  assert.equal(phonesEquivalent("966512345678", "0512345678"), true);
  assert.equal(phonesEquivalent("0512345678", "0512345679"), false);
});
