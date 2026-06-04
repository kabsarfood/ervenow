/**
 * @jest-environment node
 */
const {
  isActive,
  appendToStoreUrl,
} = require("../../public/assets/store-preview-mode.logic");

describe("store preview mode URL helpers", () => {
  test("isActive accepts preview=1, true, yes", () => {
    expect(isActive("preview=1")).toBe(true);
    expect(isActive("?preview=true")).toBe(true);
    expect(isActive("id=x&preview=yes")).toBe(true);
    expect(isActive("preview=0")).toBe(false);
    expect(isActive("")).toBe(false);
  });

  test("appendToStoreUrl adds preview=1 once", () => {
    expect(appendToStoreUrl("/store.html?id=abc")).toBe("/store.html?id=abc&preview=1");
    expect(appendToStoreUrl("/store.html?id=abc&preview=1")).toBe("/store.html?id=abc&preview=1");
    expect(appendToStoreUrl("")).toBe("");
  });
});
