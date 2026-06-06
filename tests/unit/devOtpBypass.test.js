describe("devOtpBypass", () => {
  test("dev OTP bypass is disabled in platform auth", () => {
    const prev = process.env.ALLOW_DEV_OTP;
    process.env.ALLOW_DEV_OTP = "true";
    delete require.cache[require.resolve("../../shared/utils/devOtpBypass")];
    const mod = require("../../shared/utils/devOtpBypass");
    expect(mod.allowDevOtpBypass()).toBe(true);
    expect(mod.isDevOtpBypassCode("1977")).toBe(false);
    if (prev === undefined) delete process.env.ALLOW_DEV_OTP;
    else process.env.ALLOW_DEV_OTP = prev;
    delete require.cache[require.resolve("../../shared/utils/devOtpBypass")];
  });
});
