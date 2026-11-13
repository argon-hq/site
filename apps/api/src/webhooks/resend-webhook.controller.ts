import {
  BadRequestException,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { runEffect } from "../effect/nest";
import { parseEvent } from "./delivery-event";
import { DeliveryWebhookService } from "./delivery-webhook.service";
import { verifySignature } from "./signature";

// Injection token: the endpoint's signing secret (RESEND_WEBHOOK_SECRET).
export const RESEND_WEBHOOK_SECRET = "RESEND_WEBHOOK_SECRET";

// How long an unknown provider id is worth a retry. The sending step stores the ids only when the
// provider has answered the whole batch (send.ts, recordBatch), so an early event — a failure or a
// suppression comes within milliseconds — can arrive before its row has one. A 409 makes the
// provider retry (seconds, then minutes later); past this window the id is taken as not ours — a
// confirmation e-mail, an edition already trimmed — and answered 200 so it stops.
export const UNKNOWN_RETRY_WINDOW_MS = 15 * 60_000;

@Controller("webhooks")
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    @Inject(RESEND_WEBHOOK_SECRET) private readonly secret: string,
    @Inject(DeliveryWebhookService) private readonly deliveries: DeliveryWebhookService,
  ) {}

  // POST /webhooks/resend: what the provider says happened to each message after accepting it.
  // Public, because the provider cannot send the internal secret; the signature over the raw body
  // is the check instead, and nothing is read from the body before it passes. The answer is 200
  // for anything signed that is not a database failure — an event we do not use, an id no delivery
  // carries — since anything else makes the provider retry it for days.
  @Public()
  @Post("resend")
  @HttpCode(200)
  async resend(
    @Req() req: RawBodyRequest<Request>,
    @Headers("svix-id") id: string | undefined,
    @Headers("svix-timestamp") timestamp: string | undefined,
    @Headers("svix-signature") signature: string | undefined,
  ) {
    // main.ts keeps the raw body (`rawBody: true`); the signature is over those bytes, not over a
    // re-serialized object.
    const raw = req.rawBody;
    // Header-controlled and logged before it is trusted: bounded.
    const svixId = id?.slice(0, 100);
    if (
      raw === undefined ||
      !verifySignature(this.secret, { id: id ?? "", timestamp: timestamp ?? "", signature: signature ?? "" }, raw)
    ) {
      this.logger.warn({ msg: "delivery webhook refused: bad signature", svixId });
      throw new UnauthorizedException();
    }

    const event = parseEvent(parseJson(raw.toString("utf8")));
    if (!event) {
      this.logger.log({ msg: "delivery webhook ignored: not an e-mail event", svixId });
      return { status: "ignored" };
    }

    const result = await runEffect("delivery-webhook", this.deliveries.apply(event));
    if (result.outcome === "unknown" && isRecent(event.createdAt)) {
      throw new ConflictException({ status: "unknown", retry: true });
    }
    return { status: result.outcome };
  }
}

function isRecent(createdAt: Date | undefined, now: Date = new Date()): boolean {
  return createdAt !== undefined && now.getTime() - createdAt.getTime() < UNKNOWN_RETRY_WINDOW_MS;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestException("body is not JSON");
  }
}
