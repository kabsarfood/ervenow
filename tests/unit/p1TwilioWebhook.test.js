process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";

const {
  computeTwilioSignature,
  verifyTwilioWebhook,
  resetTwilioReplayForTests,
} = require("../../shared/utils/twilioWebhookAuth");

describe("P1-02 Twilio WhatsApp webhook signature", () => {
  const url = "https://ervenow.test/api/whatsapp/webhook";

  beforeEach(() => {
    resetTwilioReplayForTests();
    process.env.TWILIO_WEBHOOK_URL = url;
    process.env.TWILIO_AUTH_TOKEN = "test-twilio-token";
  });

  test("valid signed webhook is accepted", () => {
    const body = { From: "whatsapp:+966500000000", Body: "1", MessageSid: "SM1" };
    const sig = computeTwilioSignature("test-twilio-token", url, body);
    const out = verifyTwilioWebhook({
      headers: { "x-twilio-signature": sig },
      body,
      protocol: "https",
      originalUrl: "/api/whatsapp/webhook",
    });
    expect(out.ok).toBe(true);
  });

  test("no signature is rejected", () => {
    const out = verifyTwilioWebhook({
      headers: {},
      body: { From: "whatsapp:+966500000000", Body: "1" },
      originalUrl: "/api/whatsapp/webhook",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("missing_signature");
  });

  test("invalid signature is rejected", () => {
    const out = verifyTwilioWebhook({
      headers: { "x-twilio-signature": "aaaa" },
      body: { From: "whatsapp:+966500000000", Body: "1" },
      originalUrl: "/api/whatsapp/webhook",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_signature");
  });

  test("modified body with old signature is rejected", () => {
    const original = { From: "whatsapp:+966500000000", Body: "1", MessageSid: "SM2" };
    const sig = computeTwilioSignature("test-twilio-token", url, original);
    const out = verifyTwilioWebhook({
      headers: { "x-twilio-signature": sig },
      body: { ...original, Body: "1 hacked" },
      originalUrl: "/api/whatsapp/webhook",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_signature");
  });

  test("replay of same MessageSid is rejected", () => {
    const body = { From: "whatsapp:+966500000000", Body: "1", MessageSid: "SM-replay" };
    const sig = computeTwilioSignature("test-twilio-token", url, body);
    const req = {
      headers: { "x-twilio-signature": sig },
      body,
      originalUrl: "/api/whatsapp/webhook",
    };
    expect(verifyTwilioWebhook(req).ok).toBe(true);
    const second = verifyTwilioWebhook(req);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("replay");
  });
});
