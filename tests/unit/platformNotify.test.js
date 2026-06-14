const { resolveStoreMerchantUserId } = require("../../shared/services/platformNotify");

describe("platformNotify.resolveStoreMerchantUserId", () => {
  test("returns owner_user_id when present on store row", async () => {
    const sb = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: { id: "store-1", owner_user_id: "user-owner", phone: "0500000000" },
          }),
        };
      },
    };
    await expect(resolveStoreMerchantUserId(sb, "store-1")).resolves.toBe("user-owner");
  });

  test("falls back to phone lookup when owner_user_id missing", async () => {
    const sb = {
      from(table) {
        if (table === "stores") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            maybeSingle: async () => ({
              data: { id: "store-2", owner_user_id: null, phone: "0501234567" },
            }),
          };
        }
        if (table === "users") {
          return {
            select() {
              return this;
            },
            in() {
              return this;
            },
            limit: async () => ({
              data: [{ id: "merchant-9", role: "store", phone: "0501234567" }],
              error: null,
            }),
            ilike: async () => ({ data: [], error: null }),
          };
        }
        return {};
      },
    };
    await expect(resolveStoreMerchantUserId(sb, "store-2")).resolves.toBe("merchant-9");
  });
});
