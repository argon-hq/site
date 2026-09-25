import { DynamicModule, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { SIGNUP_LIMIT } from "../auth/signup-throttle.guard";
import type { Config } from "../config";
import { ConfirmationMail } from "./confirmation-mail";
import { SubscriberController } from "./subscriber.controller";
import { SubscriberService } from "./subscriber.service";
import { UNSUBSCRIBE_SECRET } from "./token";
import { ORIGINS, originsFrom } from "./urls";

@Module({})
export class SubscriberModule {
  // The origins come from the environment and go into the links of every e-mail, so they are
  // bound once here instead of being read wherever a URL is built.
  static forRoot(config: Config): DynamicModule {
    return {
      module: SubscriberModule,
      // In-memory counters: one process, one counter. The guard is applied per route, never
      // globally, so the site's own calls to the internal routes are not counted.
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ...SIGNUP_LIMIT }] })],
      controllers: [SubscriberController],
      providers: [
        { provide: ORIGINS, useValue: originsFrom(config) },
        { provide: UNSUBSCRIBE_SECRET, useValue: config.UNSUBSCRIBE_TOKEN_SECRET },
        SubscriberService,
        ConfirmationMail,
      ],
      exports: [SubscriberService],
    };
  }
}
