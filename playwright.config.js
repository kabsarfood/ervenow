/** @type {import("@playwright/test").PlaywrightTestConfig} */
module.exports = {
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4000",
    locale: "ar-SA",
    viewport: { width: 390, height: 844 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "node server/server.js",
    url: "http://127.0.0.1:4000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "4000",
      SERVE_STATIC: "1",
      ALLOW_DEV_OTP: "true",
    },
  },
};
