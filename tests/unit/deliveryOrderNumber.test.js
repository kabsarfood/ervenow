const { formatEdDaySeq, buildNextDeliveryOrderNumber } = require("../../apps/delivery/service");

describe("buildNextDeliveryOrderNumber", () => {
  test("formatEdDaySeq pads sequence", () => {
    expect(formatEdDaySeq(1)).toBe("001");
    expect(formatEdDaySeq(12)).toBe("012");
    expect(formatEdDaySeq(120)).toBe("120");
  });

  test("skips globally taken ED-<day>-<seq> even when count is low", async () => {
    const day = String(new Date().getDate()).padStart(2, "0");
    const taken = `ED-${day}-001`;
    const sb = {
      from(table) {
        return {
          select(_cols, opts) {
            if (opts && opts.head) {
              return {
                gte() {
                  return {
                    lte: async () => ({ count: 0, error: null }),
                  };
                },
              };
            }
            return {
              eq(_col, value) {
                return {
                  maybeSingle: async () => ({
                    data: value === taken ? { id: "old-order" } : null,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };

    const num = await buildNextDeliveryOrderNumber(sb);
    expect(num).toBe(`ED-${day}-002`);
  });

  test("honours startSeq hint for retry after collision", async () => {
    const day = String(new Date().getDate()).padStart(2, "0");
    const sb = {
      from() {
        return {
          select(_cols, opts) {
            if (opts && opts.head) {
              return {
                gte() {
                  return {
                    lte: async () => ({ count: 1, error: null }),
                  };
                },
              };
            }
            return {
              eq(_col, value) {
                return {
                  maybeSingle: async () => ({
                    data: String(value).endsWith("-002") ? { id: "x" } : null,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    };

    const num = await buildNextDeliveryOrderNumber(sb, 2);
    expect(num).toBe(`ED-${day}-003`);
  });
});
