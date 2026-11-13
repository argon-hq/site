import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const valid = {
  DATABASE_URL: "postgresql://u:p@h:5432/db",
  ANTHROPIC_API_KEY: "sk-ant-x",
  INTERNAL_API_SECRET: "0123456789abcdef",
  UNSUBSCRIBE_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("loadConfig", () => {
  it("reads the environment with the default port", () => {
    expect(loadConfig(valid).PORT).toBe(3001);
  });

  it("names the missing variables", () => {
    expect(() => loadConfig({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /ANTHROPIC_API_KEY, INTERNAL_API_SECRET, UNSUBSCRIBE_TOKEN_SECRET/,
    );
  });

  it("needs no sender address on a development machine", () => {
    expect(loadConfig(valid).MAIL_FROM).toBe("newsletter@argon.localhost");
  });

  it("requires the sender address in a container, where a wrong domain would reach real inboxes", () => {
    const container = { ...valid, NODE_ENV: "production", ARGON_ENV: "prod" };
    expect(() => loadConfig(container)).toThrow(/MAIL_FROM/);
    expect(loadConfig({ ...container, MAIL_FROM: "newsletter@argonbusiness.com" }).MAIL_FROM).toBe(
      "newsletter@argonbusiness.com",
    );
  });

  it("leaves the delivery webhook off without its secret", () => {
    expect(loadConfig(valid).RESEND_WEBHOOK_SECRET).toBeUndefined();
  });

  it("takes the webhook secret only in the provider's format, so a placeholder fails at boot", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    expect(loadConfig({ ...valid, RESEND_WEBHOOK_SECRET: secret }).RESEND_WEBHOOK_SECRET).toBe(secret);
    expect(() => loadConfig({ ...valid, RESEND_WEBHOOK_SECRET: "CHANGE-ME" })).toThrow(/RESEND_WEBHOOK_SECRET/);
  });
});
