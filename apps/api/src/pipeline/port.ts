import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Effect } from "effect";
import { bindPipeline, type PipelinePort } from "../mastra/workflows/context";
import { PrismaService } from "../prisma/prisma.service";
import { deliveryStatus } from "./delivery-status";
import { OwnerAlert } from "./owner-alert";
import { PipelineService, type SendRun, type StepRun } from "./pipeline.service";
import { RetentionService } from "./retention";
import { ScheduleRegistry, type ScheduleChange } from "./schedules";
import { SUNDAY_SCHEDULE, SUNDAY_SEND_SCHEDULE, TIMEZONE } from "./run";
import { EditionWatch } from "./watch";
import { WriteDataset } from "./write-dataset";

// The application as the Mastra side sees it: the workflows' steps and the operator's tools call
// these, and nothing else. Bound when the module starts, so a run the Studio or the scheduler starts
// finds the same services a run from the route does.
@Injectable()
export class PipelinePortAdapter implements PipelinePort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Heartbeat");

  constructor(
    private readonly pipeline: PipelineService,
    private readonly watchService: EditionWatch,
    private readonly retentionService: RetentionService,
    private readonly owners: OwnerAlert,
    private readonly registry: ScheduleRegistry,
    private readonly prisma: PrismaService,
    private readonly dataset: WriteDataset,
  ) {}

  onModuleInit(): void {
    bindPipeline(this);
  }

  onModuleDestroy(): void {
    bindPipeline(undefined);
  }

  collect = (run: StepRun) => this.pipeline.collect(run);
  write = (run: StepRun) => this.pipeline.write(run);
  build = (run: StepRun) => this.pipeline.build(run);
  send = (run: SendRun) => this.pipeline.send(run);
  watch = () => this.watchService.check();
  retention = () => this.retentionService.run();
  alert = (step: string, reason: string) => this.owners.send(step, reason);
  deliveryStatus = (date: string | undefined) => deliveryStatus(this.prisma, date);
  schedules = () => this.registry.list();
  changeSchedule = (change: ScheduleChange) => this.registry.change(change);
  runSchedule = (id: string) => this.registry.run(id);
  resetSchedules = (id: string | undefined) => this.registry.reset(id);
  addToWriteDataset = (date: string | undefined) => this.dataset.addEdition(date);

  // Sunday has no edition, but the CloudWatch alarms count `schedule fired` and `send finished` per
  // calendar day. The scheduler writes the first for every fire; the send's line is written here,
  // with nothing sent.
  heartbeat = (kind: "generate" | "send") =>
    Effect.sync(() => {
      if (kind === "generate") {
        this.logger.log({ msg: "no edition today", schedule: SUNDAY_SCHEDULE, timeZone: TIMEZONE, sunday: true });
        return;
      }
      this.logger.log({
        msg: "send finished",
        schedule: SUNDAY_SEND_SCHEDULE,
        timeZone: TIMEZONE,
        sunday: true,
        sent: 0,
      });
    });
}
