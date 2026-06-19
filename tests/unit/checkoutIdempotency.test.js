const {
  claimOrReplayCheckout,
  isStalePendingRow,
  STALE_PENDING_MS,
} = require("../../shared/utils/checkoutIdempotency");

function mockSb(rows) {
  const store = new Map(rows.map((r) => [`${r.customer_id}:${r.idempotency_key}`, { ...r }]));
  return {
    from(table) {
      if (table !== "checkout_idempotency") throw new Error("unexpected table");
      return {
        select() {
          return {
            eq(col, val) {
              const chain = { col, val, col2: null, val2: null };
              const api = {
                eq(c2, v2) {
                  chain.col2 = c2;
                  chain.val2 = v2;
                  return api;
                },
                maybeSingle: async () => {
                  for (const row of store.values()) {
                    if (row[chain.col] === chain.val && (!chain.col2 || row[chain.col2] === chain.val2)) {
                      return { data: row, error: null };
                    }
                  }
                  return { data: null, error: null };
                },
              };
              return api;
            },
          };
        },
        insert(payload) {
          return {
            select() {
              return {
                maybeSingle: async () => {
                  const key = `${payload.customer_id}:${payload.idempotency_key}`;
                  if (store.has(key)) {
                    return { data: null, error: { code: "23505" } };
                  }
                  const row = {
                    ...payload,
                    created_at: payload.created_at || new Date().toISOString(),
                  };
                  store.set(key, row);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(col, val) {
              return {
                eq(c2, v2) {
                  return Promise.resolve().then(() => {
                    for (const [k, row] of store.entries()) {
                      if (row[col] === val && row[c2] === v2) store.delete(k);
                    }
                    return { error: null };
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("checkoutIdempotency — stale pending reclaim", () => {
  test("isStalePendingRow detects old pending claims", () => {
    const now = Date.now();
    expect(
      isStalePendingRow(
        {
          response: { pending: true },
          created_at: new Date(now - STALE_PENDING_MS - 1000).toISOString(),
        },
        now
      )
    ).toBe(true);
    expect(
      isStalePendingRow(
        {
          response: { pending: true },
          created_at: new Date(now - 5000).toISOString(),
        },
        now
      )
    ).toBe(false);
  });

  test("claimOrReplayCheckout reclaims stale pending instead of conflict", async () => {
    const staleCreated = new Date(Date.now() - STALE_PENDING_MS - 5000).toISOString();
    const sb = mockSb([
      {
        customer_id: "cust-1",
        idempotency_key: "idem-1",
        response: { pending: true },
        created_at: staleCreated,
      },
    ]);

    const out = await claimOrReplayCheckout(sb, "cust-1", "idem-1");
    expect(out.conflict).toBeUndefined();
    expect(out.claimed).toBe(true);
    expect(out.staleReclaimed).toBe(true);
  });
});
