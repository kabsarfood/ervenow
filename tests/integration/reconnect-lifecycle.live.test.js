/**
 * Jest wrapper — runs live E2E when LIVE_E2E=1
 */
const { spawnSync } = require("child_process");
const path = require("path");

const live = String(process.env.LIVE_E2E || "").trim() === "1";

(live ? describe : describe.skip)("reconnect lifecycle — live Supabase", () => {
  test(
    "member→merchant→driver→settlement→wallet→notifications",
    () => {
      const script = path.join(__dirname, "..", "scripts", "reconnect-lifecycle-live-e2e.js");
      const r = spawnSync(process.execPath, [script], {
        env: process.env,
        encoding: "utf8",
      });
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      expect(r.status).toBe(0);
    },
    180000
  );
});
