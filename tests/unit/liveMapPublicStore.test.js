"use strict";

const {
  readState,
  readStateAsync,
  writeState,
  PUBLIC_KEY,
} = require("../../shared/utils/liveMapPublicStore");

describe("liveMapPublicStore", () => {
  test("defaults to enabled when unset", async () => {
    const enabled = await readStateAsync();
    expect(typeof enabled).toBe("boolean");
  });

  test("writeState persists toggle", async () => {
    const before = readState();
    const saved = await writeState(!before);
    expect(saved).toBe(!before);
    expect(readState()).toBe(!before);
    await writeState(before);
    expect(readState()).toBe(before);
  });

  test("exports public key", () => {
    expect(PUBLIC_KEY).toBe("live_map_public_enabled");
  });
});
