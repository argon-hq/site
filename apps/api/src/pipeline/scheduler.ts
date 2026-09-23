import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Effect } from "effect";
import { PipelineService } from "./pipeline.service";
import { SCHEDULE, TIMEZONE } from "./run";

// The clock of the generation, inside the API, which is a process that never goes to sleep. It only
// fires the run: the run logs the failure and alerts the owners by itself, so a bad day is ignored
// here and the timer stays alive for tomorrow.
@Injectable()
export class PipelineScheduler {
  private readonly logger = new Logger(PipelineScheduler.name);

  constructor(private readonly pipeline: PipelineService) {}

  @Cron(SCHEDULE, { name: "edition", timeZone: TIMEZONE })
  async generate(): Promise<void> {
    this.logger.log({ msg: "schedule fired", schedule: SCHEDULE, timeZone: TIMEZONE });
    await Effect.runPromise(Effect.ignore(this.pipeline.run()));
  }
}
