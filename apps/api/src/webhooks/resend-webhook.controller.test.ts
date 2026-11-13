import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Effect } from "effect";
import { createHmac, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IS_PUBLIC } from "../auth/public.decorator";
import { DeliveryWebhookFailed, DeliveryWebhookService } from "./delivery-webhook.service";
import { RESEND_WEBHOOK_SECRET, ResendWebhookController } from "./resend-webhook.controller";

const KEY = randomBytes(24);
const SECRET = `whsec_${KEY.toString("base64")}`;

function signed(body: string, options: { key?: Buffer; timestamp?: number; id?: string } = {}) {
  const id = options.id ?? "msg_1";
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", options.key ?? KEY)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${mac}`,
  };
}

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// The real HTTP stack, as main.ts builds it: the signature is over the bytes the provider sent, so
// what is under test is that the route reads those bytes and not a re-serialized body.
type Apply = DeliveryWebhookService["apply"];
const applied: Apply = () => Effect.succeed({ outcome: "applied", deliveryId: "d_1", status: "delivered" });

async function start(apply = vi.fn<Apply>(applied)) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ResendWebhookController],
    providers: [
      { provide: RESEND_WEBHOOK_SECRET, useValue: SECRET },
      { provide: DeliveryWebhookService, useValue: { apply } },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  const post = (body: string, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/webhooks/resend`, { method: "POST", body, headers });
  return { apply, post };
}

// Spacing the provider might use: a body re-serialized by the framework would not match it.
const DELIVERED = '{ "type": "email.delivered", "created_at": "2026-11-13T10:00:00Z", "data": { "email_id": "re_1" } }';

describe("POST /webhooks/resend", () => {
  it("is public: the provider has no internal secret, its signature is the check", () => {
    expect(Reflect.getMetadata(IS_PUBLIC, ResendWebhookController.prototype.resend)).toBe(true);
  });

  it("applies a signed event and answers 200", async () => {
    const { apply, post } = await start();

    const response = await post(DELIVERED, signed(DELIVERED));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "applied" });
    expect(apply).toHaveBeenCalledWith({
      type: "email.delivered",
      emailId: "re_1",
      createdAt: new Date("2026-11-13T10:00:00Z"),
    });
  });

  it("refuses a request whose signature does not match, and applies nothing", async () => {
    const { apply, post } = await start();

    const response = await post(DELIVERED, signed(DELIVERED, { key: randomBytes(24) }));

    expect(response.status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuses a request without the signature headers", async () => {
    const { apply, post } = await start();

    const response = await post(DELIVERED, { "content-type": "application/json" });

    expect(response.status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });

  it("refuses an old signed request replayed later", async () => {
    const { apply, post } = await start();

    const response = await post(DELIVERED, signed(DELIVERED, { timestamp: Math.floor(Date.now() / 1000) - 3600 }));

    expect(response.status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 200 to a signed event that is not about an e-mail, so the provider stops sending it", async () => {
    const { apply, post } = await start();
    const body = '{"type":"contact.created","data":{"id":"c_1"}}';

    const response = await post(body, signed(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 200 to an id no delivery carries once the event is old enough", async () => {
    const { post } = await start(vi.fn<Apply>(() => Effect.succeed({ outcome: "unknown" })));
    const old = DELIVERED.replace("2026-11-13T10:00:00Z", new Date(Date.now() - 60 * 60_000).toISOString());

    const response = await post(old, signed(old));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "unknown" });
  });

  it("answers 409 to an unknown id of a fresh event: the sending step may not have stored it yet, and the provider retries", async () => {
    const { post } = await start(vi.fn<Apply>(() => Effect.succeed({ outcome: "unknown" })));
    const fresh = DELIVERED.replace("2026-11-13T10:00:00Z", new Date().toISOString());

    const response = await post(fresh, signed(fresh));

    expect(response.status).toBe(409);
  });

  it("answers 500 when the database fails, so the provider retries", async () => {
    const { post } = await start(vi.fn<Apply>(() => Effect.fail(new DeliveryWebhookFailed({ reason: "db down" }))));

    const response = await post(DELIVERED, signed(DELIVERED));

    expect(response.status).toBe(500);
  });
});
