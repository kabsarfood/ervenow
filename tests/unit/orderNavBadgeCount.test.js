const { badgeRole, countNavBadge, isUuid } = require("../../shared/utils/orderNavBadgeCount");

function fakeSb(count) {
  const calls = [];
  function chain() {
    const api = {
      select: function (cols, opts) {
        calls.push({ op: "select", cols: cols, opts: opts || null });
        return api;
      },
      eq: function (col, value) {
        calls.push({ op: "eq", col: col, value: value });
        return api;
      },
      in: function (col, values) {
        calls.push({ op: "in", col: col, values: values });
        return api;
      },
      or: function (expr) {
        calls.push({ op: "or", expr: expr });
        return api;
      },
      then: function (resolve, reject) {
        try {
          resolve({ count: count, error: null, data: null });
        } catch (e) {
          if (reject) reject(e);
        }
      },
    };
    return api;
  }
  return {
    calls: calls,
    from: function (table) {
      calls.push({ op: "from", table: table });
      return chain();
    },
  };
}

const USER = "11111111-1111-4111-8111-111111111111";

describe("orderNavBadgeCount", function () {
  test("badgeRole maps legacy user to customer", function () {
    expect(badgeRole({ role: "user" })).toBe("customer");
    expect(badgeRole({ role: "driver" })).toBe("driver");
    expect(isUuid(USER)).toBe(true);
    expect(isUuid("not-an-id")).toBe(false);
  });

  test("customer badge is one head count and does not select order rows", async function () {
    const sb = fakeSb(4);
    const n = await countNavBadge(sb, { id: USER, role: "customer" });
    expect(n).toBe(4);
    const froms = sb.calls.filter(function (c) { return c.op === "from"; });
    const selects = sb.calls.filter(function (c) { return c.op === "select"; });
    expect(froms).toHaveLength(1);
    expect(selects[0].cols).toBe("id");
    expect(selects[0].opts).toEqual({ count: "exact", head: true });
    expect(sb.calls.some(function (c) { return c.op === "eq" && c.col === "customer_id"; })).toBe(true);
  });

  test("admin badge counts new pending and accepted only", async function () {
    const sb = fakeSb(2);
    const n = await countNavBadge(sb, { id: USER, role: "admin" });
    expect(n).toBe(2);
    const inn = sb.calls.find(function (c) { return c.op === "in"; });
    expect(inn.values).toEqual(["new", "pending", "accepted"]);
    expect(sb.calls.filter(function (c) { return c.op === "from"; })).toHaveLength(1);
  });

  test("driver badge is one head count with dispatch filter", async function () {
    const sb = fakeSb(3);
    const n = await countNavBadge(sb, { id: USER, role: "driver" });
    expect(n).toBe(3);
    expect(sb.calls.filter(function (c) { return c.op === "from"; })).toHaveLength(1);
    const filters = sb.calls.filter(function (c) { return c.op === "or"; }).map(function (c) { return c.expr; });
    expect(filters.some(function (expr) { return expr.indexOf("driver_id.eq." + USER) >= 0; })).toBe(true);
    expect(filters.some(function (expr) { return expr.indexOf("service,gas_delivery") >= 0; })).toBe(true);
    expect(filters.some(function (expr) { return expr.indexOf("internal_delivery") >= 0; })).toBe(true);
  });

  test("store role and bad id do not query", async function () {
    const sb = fakeSb(9);
    expect(await countNavBadge(sb, { id: USER, role: "store" })).toBe(0);
    expect(await countNavBadge(sb, { id: "bad", role: "customer" })).toBe(0);
    expect(sb.calls).toHaveLength(0);
  });
});
