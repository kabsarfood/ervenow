const { buildStoreOwnerUserPatch } = require("../../shared/services/storeOwnerAccount");

describe("store owner account stays linked to the store name", () => {
  test("new phone becomes a store account named after the store", () => {
    const patch = buildStoreOwnerUserPatch(null, {
      name: "نسايم الشاورما",
      status: "pending",
    });
    expect(patch).toEqual({
      role: "store",
      name: "نسايم الشاورما",
      status: "pending",
    });
  });

  test("customer phone with an approved store stays a store under that name", () => {
    const patch = buildStoreOwnerUserPatch(
      { role: "customer", status: "active", name: "عميل" },
      { name: "نسايم الشاورما", status: "approved" }
    );
    expect(patch.role).toBe("store");
    expect(patch.name).toBe("نسايم الشاورما");
    expect(patch.status).toBe("active");
  });

  test("existing store account keeps the store name", () => {
    const patch = buildStoreOwnerUserPatch(
      { role: "store", status: "active", name: "اسم قديم" },
      { name: "نسايم الشاورما", status: "approved" }
    );
    expect(patch.role).toBeUndefined();
    expect(patch.name).toBe("نسايم الشاورما");
  });

  test("driver and admin phones are not converted", () => {
    expect(buildStoreOwnerUserPatch({ role: "driver", status: "active" }, { name: "متجر", status: "approved" })).toBeNull();
    expect(buildStoreOwnerUserPatch({ role: "admin", status: "active" }, { name: "متجر", status: "approved" })).toBeNull();
  });
});
