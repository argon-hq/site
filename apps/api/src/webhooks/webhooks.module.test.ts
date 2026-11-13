import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { ResendWebhookController } from "./resend-webhook.controller";
import { WebhooksModule } from "./webhooks.module";

const base = {
  DATABASE_URL: "postgresql://u:p@h:5432/db",
  ANTHROPIC_API_KEY: "sk-ant-x",
  INTERNAL_API_SECRET: "0123456789abcdef",
  UNSUBSCRIBE_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("WebhooksModule", () => {
  it("mounts no route without the signing secret", () => {
    expect(WebhooksModule.forRoot(loadConfig(base)).controllers ?? []).toEqual([]);
  });

  it("mounts the Resend route with it", () => {
    const config = loadConfig({ ...base, RESEND_WEBHOOK_SECRET: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" });
    expect(WebhooksModule.forRoot(config).controllers).toEqual([ResendWebhookController]);
  });
});
