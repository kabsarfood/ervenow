const { lastActivityAt } = require("../../shared/utils/lastActivityAt");

describe("admin last activity display", () => {
  test("prefers last_seen_at over updated_at", () => {
    expect(
      lastActivityAt({
        last_seen_at: "2026-09-26T08:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      })
    ).toBe("2026-09-26T08:00:00.000Z");
  });

  test("falls back to updated_at when last_seen_at is empty", () => {
    expect(
      lastActivityAt({
        last_seen_at: null,
        updated_at: "2026-09-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      })
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  test("falls back to created_at when both presence fields are empty", () => {
    expect(lastActivityAt({ last_seen_at: "", updated_at: "", created_at: "2026-01-01T00:00:00.000Z" })).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });
});