import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { DeliveryWebhookService } from "./delivery-webhook.service";
import { RESEND_WEBHOOK_SECRET, ResendWebhookController } from "./resend-webhook.controller";

@Module({})
export class WebhooksModule {
  // The route exists only where the environment has the signing secret: a public endpoint with
  // nothing to check a signature against would be worse than none.
  static forRoot(config: Config): DynamicModule {
    const secret = config.RESEND_WEBHOOK_SECRET;
    if (!secret) return { module: WebhooksModule };
    return {
      module: WebhooksModule,
      controllers: [ResendWebhookController],
      providers: [{ provide: RESEND_WEBHOOK_SECRET, useValue: secret }, DeliveryWebhookService],
    };
  }
}
