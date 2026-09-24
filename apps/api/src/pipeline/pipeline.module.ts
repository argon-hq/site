import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { UNSUBSCRIBE_SECRET } from "../subscriber/token";
import { ORIGINS, originsFrom } from "../subscriber/urls";
import { MastraClock } from "./clock";
import { DeliveryService } from "./delivery.service";
import { EditionLock } from "./lock";
import { OwnerAlert } from "./owner-alert";
import { PipelineController } from "./pipeline.controller";
import { PipelineService } from "./pipeline.service";
import { PipelinePortAdapter } from "./port";
import { RetentionService } from "./retention";
import { ScheduleRegistry } from "./schedules";
import { WriteDataset } from "./write-dataset";
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
        { provide: ORIGINS, useValue: originsFrom(config) },
        // The sending step derives each subscriber's unsubscribe token itself, as the confirmation does.
        { provide: UNSUBSCRIBE_SECRET, useValue: config.UNSUBSCRIBE_TOKEN_SECRET },
        PipelineService,
        DeliveryService,
        OwnerAlert,
        // The lock opens a connection of its own, outside the pool, so it takes the URL directly.
        { provide: EditionLock, useFactory: () => new EditionLock(config.DATABASE_URL) },
        EditionWatch,
        RetentionService,
        ScheduleRegistry,
        WriteDataset,
        // What the workflows and the operator's tools reach the application through.
        PipelinePortAdapter,
        // The clock is only started where it should tick. An environment with it off has no timer at
        // all, instead of a timer nobody wanted: the run is still one POST /pipeline/run away, and the
        // schedule rows are still there for the Studio to show.
        ...(config.SCHEDULER_ENABLED ? [MastraClock] : []),
      ],
    };
  }
}
