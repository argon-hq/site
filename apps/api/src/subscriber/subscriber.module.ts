import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { ConfirmationMail } from "./confirmation-mail";
import { SubscriberController } from "./subscriber.controller";
import { SubscriberService } from "./subscriber.service";
import { ORIGINS } from "./urls";

@Module({})
export class SubscriberModule {
  // The origins come from the environment and go into the links of every e-mail, so they are
  // bound once here instead of being read wherever a URL is built.
  static forRoot(config: Config): DynamicModule {
    return {
      module: SubscriberModule,
      controllers: [SubscriberController],
      providers: [
        { provide: ORIGINS, useValue: { web: config.WEB_ORIGIN, api: config.API_ORIGIN } },
        SubscriberService,
        ConfirmationMail,
      ],
      exports: [SubscriberService],
    };
  }
}
