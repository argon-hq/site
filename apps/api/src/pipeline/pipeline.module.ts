import { DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { UNSUBSCRIBE_SECRET } from "../subscriber/token";
import { ORIGINS, originsFrom } from "../subscriber/urls";
import { DeliveryService } from "./delivery.service";
import { EditionLock } from "./lock";
import { OwnerAlert } from "./owner-alert";
import { PipelineController } from "./pipeline.controller";
import { PipelineService } from "./pipeline.service";
import { RetentionScheduler } from "./retention";
import { PipelineScheduler } from "./scheduler";
import { BackupJob } from "./backup";
import { JobsController } from "./jobs.controller";
import { MigrateJob } from "./migrate";
import { RestoreDrillJob } from "./restore-drill";
import { EditionWatch } from "./watch";

@Module({})
export class PipelineModule {
  // The building step puts the unsubscribe link in the stored HTML, so it needs the same origins
  // the subscriber module binds: they come from the environment, once, instead of being read
  // wherever a URL is built.
  static forRoot(config: Config): DynamicModule {
    return {
      module: PipelineModule,
      // The jobs route is only mounted on the Lambda that runs the jobs (JOBS_ENABLED).
      controllers: [PipelineController, ...(config.JOBS_ENABLED ? [JobsController] : [])],
      providers: [
        { provide: ORIGINS, useValue: originsFrom(config) },
        // The sending step derives each subscriber's unsubscribe token itself, as the confirmation does.
        { provide: UNSUBSCRIBE_SECRET, useValue: config.UNSUBSCRIBE_TOKEN_SECRET },
        PipelineService,
        DeliveryService,
        OwnerAlert,
        // The lock opens a connection of its own, outside the pool, so it takes the URL directly.
        { provide: EditionLock, useFactory: () => new EditionLock(config.DATABASE_URL) },
        {
          provide: EditionWatch,
          useFactory: (prisma: PrismaService, alert: OwnerAlert) =>
            new EditionWatch(prisma, alert, config.SCHEDULER_ENABLED),
          inject: [PrismaService, OwnerAlert],
        },
        // The methods of the day's jobs. They only tick where SCHEDULER_ENABLED loads the
        // ScheduleModule (app.module.ts); elsewhere nothing calls them but the jobs route, and an
        // environment with neither has no timer at all: the run is still one POST /pipeline/run away.
        PipelineScheduler,
        RetentionScheduler,
        MigrateJob,
        // The configuration comes from forRoot, as the lock's URL does.
        { provide: BackupJob, useFactory: (alert: OwnerAlert) => new BackupJob(config, alert), inject: [OwnerAlert] },
        {
          provide: RestoreDrillJob,
          useFactory: (alert: OwnerAlert) => new RestoreDrillJob(config, alert),
          inject: [OwnerAlert],
        },
      ],
    };
  }
}
