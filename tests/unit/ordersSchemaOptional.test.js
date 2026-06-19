const { parseMissingOrdersColumnFromError } = require("../../shared/utils/idempotency");
const { selectOrdersResilient } = require("../../shared/utils/ordersSchemaOptional");

describe("ordersSchemaOptional.selectOrdersResilient", () => {
  test("drops missing column and retries", async () => {
    let calls = 0;
    const sb = {
      from() {
        return {
          select(cols) {
            const columns = cols.split(",");
            const builder = {
              eq() {
                return builder;
              },
              order() {
                return builder;
              },
              limit() {
                return builder;
              },
            };
            builder.then = (resolve) => {
              calls += 1;
              if (columns.includes("breakdown")) {
                return resolve({
                  data: null,
                  error: { message: "column orders.breakdown does not exist" },
                });
              }
              return resolve({ data: [{ id: "1", data: {} }], error: null });
            };
            return builder;
          },
        };
      },
    };

    const result = await selectOrdersResilient(sb, ["id", "breakdown", "data"], (q) => q);
    expect(calls).toBe(2);
    expect(result.error).toBeNull();
    expect(result.columnsUsed).toEqual(["id", "data"]);
    expect(result.data).toEqual([{ id: "1", data: {} }]);
  });

  test("parseMissingOrdersColumnFromError", () => {
    expect(
      parseMissingOrdersColumnFromError({ message: "Could not find the 'payment_status' column of 'orders'" })
    ).toBe("payment_status");
    expect(parseMissingOrdersColumnFromError({ message: "column orders.breakdown does not exist" })).toBe("breakdown");
  });
});
