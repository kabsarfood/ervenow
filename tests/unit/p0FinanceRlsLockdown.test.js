const fs = require("fs");
const path = require("path");

describe("P0-05 financial RLS lockdown SQL", () => {
  const file = path.join(__dirname, "../../shared/migration_p0_finance_rls_lockdown.sql");
  let sql = "";

  beforeAll(() => {
    sql = fs.readFileSync(file, "utf8");
  });

  test("does not grant USING (true) on finance tables", () => {
    const withoutComments = sql.replace(/--[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  test("denies authenticated and anon on ledger/wallets", () => {
    expect(sql).toMatch(/USING \(false\)/);
    expect(sql).toMatch(/authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE/);
    expect(sql).toMatch(/ervenow_ledger_wallets/);
    expect(sql).toMatch(/ervenow_ledger_transactions/);
    expect(sql).toMatch(/GRANT ALL ON TABLE public\.%I TO service_role/);
  });

  test("money RPCs execute for service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  });

  test("User A cannot read User B wallet/ledger via PostgREST policies", () => {
    expect(sql).toMatch(/CREATE POLICY %I ON public\.%I FOR ALL TO authenticated USING \(false\) WITH CHECK \(false\)/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.%I FROM authenticated/);
    expect(sql).toMatch(/ervenow_ledger_wallets/);
    expect(sql).toMatch(/p0_deny_authenticated/);
  });
});

describe("P0-05 service role not leaked to frontend", () => {
  test("public-config source exposes anon key only", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../apps/core/routes.js"), "utf8");
    const idx = src.indexOf("router.get(\"/public-config\"");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 900);
    expect(snippet).toMatch(/getAnonKey/);
    expect(snippet).not.toMatch(/getServiceRoleKey/);
    expect(snippet).not.toMatch(/SERVICE_ROLE/);
  });

  test("no service role env name in public HTML/JS bundles", () => {
    const publicDir = path.join(__dirname, "../../public");
    const hits = [];
    function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "uploads") continue;
          walk(p);
          continue;
        }
        if (!/\.(js|html)$/i.test(ent.name)) continue;
        const txt = fs.readFileSync(p, "utf8");
        if (/SUPABASE_SERVICE_ROLE_KEY|service_role_key/i.test(txt)) hits.push(p);
      }
    }
    walk(publicDir);
    expect(hits).toEqual([]);
  });
});
