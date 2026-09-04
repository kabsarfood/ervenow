process.env.ERVENOW_JWT_SECRET = process.env.ERVENOW_JWT_SECRET || "p0-test-jwt-secret-16";

const jwt = require("jsonwebtoken");
const express = require("express");
const { createServiceClient } = require("../../shared/config/supabase");

jest.mock("../../shared/config/supabase", () => ({
  createServiceClient: jest.fn(),
}));

const settingsRouter = require("../../apps/admin/settings");

function signUser(id, role, phone) {
  return jwt.sign({ sub: id, phone: phone || "966500000000", role }, process.env.ERVENOW_JWT_SECRET, {
    expiresIn: "1h",
  });
}

function userClient(row) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/settings", settingsRouter);
  return app;
}

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", async () => {
      const { port } = server.address();
      try {
        const out = await fn(port);
        server.close(() => resolve(out));
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

describe("P0-02 admin settings auth", () => {
  beforeEach(() => {
    createServiceClient.mockReset();
  });

  test("anonymous → 401", async () => {
    createServiceClient.mockReturnValue(userClient(null));
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings`);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
  });

  test("customer JWT → 403", async () => {
    createServiceClient.mockReturnValue(
      userClient({ id: "c1", role: "customer", status: "active", phone: "966501111111", name: "c" })
    );
    const token = signUser("c1", "customer", "966501111111");
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
        headers: { Authorization: "Bearer " + token },
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(403);
  });

  test("merchant JWT → 403", async () => {
    createServiceClient.mockReturnValue(
      userClient({ id: "m1", role: "merchant", status: "active", phone: "966502222222" })
    );
    const token = signUser("m1", "merchant", "966502222222");
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings/update`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ key: "x", value: "y" }),
      });
      return { status: res.status };
    });
    expect(status).toBe(403);
  });

  test("JWT claims admin but DB role is customer → 403", async () => {
    createServiceClient.mockReturnValue(
      userClient({ id: "c1", role: "customer", status: "active", phone: "966501111111" })
    );
    const token = signUser("c1", "admin", "966501111111");
    const app = makeApp();
    const { status } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
        headers: { Authorization: "Bearer " + token },
      });
      return { status: res.status };
    });
    expect(status).toBe(403);
  });

  test("admin JWT → allowed", async () => {
    const sb = {
      from: (table) => {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "a1", role: "admin", status: "active", phone: "966503333333" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "platform_settings") {
          return {
            select: async () => ({ data: [{ key: "site_name", value: "ERVENOW" }], error: null }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        return { select: async () => ({ data: [], error: null }) };
      },
    };
    createServiceClient.mockReturnValue(sb);
    const token = signUser("a1", "admin", "966503333333");
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
        headers: { Authorization: "Bearer " + token },
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("admin cannot flip public_ordering_enabled via generic settings", async () => {
    createServiceClient.mockReturnValue(
      userClient({ id: "a1", role: "admin", status: "active", phone: "966503333333" })
    );
    const token = signUser("a1", "admin", "966503333333");
    const app = makeApp();
    const { status, body } = await withServer(app, async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings/update`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ key: "public_ordering_enabled", value: "1" }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    });
    expect(status).toBe(403);
    expect(body.success).toBe(false);
  });
});
