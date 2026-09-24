import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { UNSUBSCRIBE_SECRET } from "../subscriber/token";
import { ORIGINS } from "../subscriber/urls";
import { EditionLock } from "./lock";
import { OwnerAlert } from "./owner-alert";
import { PipelineController } from "./pipeline.controller";
import { PipelineService } from "./pipeline.service";
import { PipelineScheduler } from "./scheduler";
import { EditionWatch } from "./watch";

@Module({})
export class PipelineModule {
  // The building step puts the unsubscribe link in the stored HTML, so it needs the same origins
  // the subscriber module binds: they come from the environment, once, instead of being read
  // wherever a URL is built.
  static forRoot(config: Config): DynamicModule {
    return {
      module: PipelineModule,
      controllers: [PipelineController],
      providers: [
        { provide: ORIGINS, useValue: { web: config.WEB_ORIGIN, api: config.API_ORIGIN } },
        // The sending step derives each subscriber's unsubscribe token itself, as the confirmation does.
        { provide: UNSUBSCRIBE_SECRET, useValue: config.UNSUBSCRIBE_TOKEN_SECRET },
        PipelineService,
        OwnerAlert,
        // The lock opens a connection of its own, outside the pool, so it takes the URL directly.
        { provide: EditionLock, useFactory: () => new EditionLock(config.DATABASE_URL) },
        EditionWatch,
        // The clock is only wired where it should tick. An environment with it off has no timer at
        // all, instead of a timer nobody wanted: the run is still one POST /pipeline/run away.
        ...(config.SCHEDULER_ENABLED ? [PipelineScheduler] : []),
      ],
    };
  }
}
