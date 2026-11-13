import {
  BadRequestException,
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
    const raw = req.rawBody?.toString("utf8");
    if (
      raw === undefined ||
      !verifySignature(this.secret, { id: id ?? "", timestamp: timestamp ?? "", signature: signature ?? "" }, raw)
    ) {
      this.logger.warn({ msg: "delivery webhook refused: bad signature", svixId: id });
      throw new UnauthorizedException();
    }

    const event = parseEvent(parseJson(raw));
    if (!event) {
      this.logger.log({ msg: "delivery webhook ignored: not an e-mail event", svixId: id });
      return { status: "ignored" };
    }

    const result = await runEffect("delivery-webhook", this.deliveries.apply(event));
    return { status: result.outcome };
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestException("body is not JSON");
  }
}
