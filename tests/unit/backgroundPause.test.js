const { createBackgroundPause, PAUSE_MS, STAGGER_MS } = require("../../shared/utils/backgroundPause");
const { applyReadTimeout, isSupabaseTimeoutError, SUPABASE_READ_TIMEOUT_MS } = require("../../shared/config/supabase");

describe("backgroundPause", function () {
  test("pauses after two timeouts and staggers workers", function () {
    let now = 1000;
    const gas = createBackgroundPause({ now: function () { return now; }, staggerMs: STAGGER_MS.gasRadius, pauseMs: PAUSE_MS });
    const notes = createBackgroundPause({ now: function () { return now; }, staggerMs: STAGGER_MS.retryNotifications, pauseMs: PAUSE_MS });
    gas.noteTimeout();
    notes.noteTimeout();
    expect(gas.shouldSkip()).toBe(false);
    gas.noteTimeout();
    notes.noteTimeout();
    expect(gas.shouldSkip()).toBe(true);
    expect(notes.shouldSkip()).toBe(true);
    now = 1000 + PAUSE_MS;
    expect(gas.shouldSkip()).toBe(false);
    expect(notes.shouldSkip()).toBe(true);
    now = 1000 + PAUSE_MS + STAGGER_MS.retryNotifications;
    expect(notes.shouldSkip()).toBe(false);
  });

  test("success clears the timeout streak", function () {
    const gate = createBackgroundPause({ now: function () { return 0; }, pauseMs: 1000, staggerMs: 0 });
    gate.noteTimeout();
    gate.noteSuccess();
    gate.noteTimeout();
    expect(gate.shouldSkip()).toBe(false);
  });
});

describe("supabase read timeout", function () {
  test("adds a timeout signal only to reads", function () {
    const getInit = applyReadTimeout("https://example.test/rest", { method: "GET" });
    const postInit = applyReadTimeout("https://example.test/rest", { method: "POST" });
    const patchInit = applyReadTimeout("https://example.test/rest", { method: "PATCH" });
    const postWithKey = applyReadTimeout("https://example.test/rest", {
      method: "POST",
      headers: { "Idempotency-Key": "wallet-1" },
    });
    expect(getInit.signal).toBeTruthy();
    expect(postInit).toEqual({ method: "POST" });
    expect(patchInit).toEqual({ method: "PATCH" });
    expect(postWithKey.signal).toBeUndefined();
    expect(SUPABASE_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(SUPABASE_READ_TIMEOUT_MS).toBeLessThanOrEqual(20000);
  });

  test("timeout errors are recognized and not treated as a normal retry hint only", function () {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(isSupabaseTimeoutError(err)).toBe(true);
    expect(isSupabaseTimeoutError({ message: "upstream request timeout" })).toBe(true);
    expect(isSupabaseTimeoutError({ message: "column missing" })).toBe(false);
  });
});
