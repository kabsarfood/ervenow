/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],
  clearMocks: true,
  setupFiles: ["<rootDir>/tests/jest.otp-memory.env.js"],
};
