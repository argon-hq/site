import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Effect } from "effect";
import { OwnerAlert } from "./owner-alert";
import { PipelineService } from "./pipeline.service";
import { SCHEDULE, SEND_SCHEDULE, TIMEZONE } from "./run";

// The two clocks of the day, inside the API, which is a process that never goes to sleep. They only
// fire: a bad day is ignored here, because the owners have already been told, and the timer stays
// alive for tomorrow.
@Injectable()
export class PipelineScheduler {
  private readonly logger = new Logger(PipelineScheduler.name);

  constructor(
    private readonly pipeline: PipelineService,
    private readonly alert: OwnerAlert,
  ) {}

  // The generation alerts the owners by itself, addressed to the step that broke.
  @Cron(SCHEDULE, { name: "edition", timeZone: TIMEZONE })
  async generate(): Promise<void> {
    this.logger.log({ msg: "schedule fired", schedule: SCHEDULE, timeZone: TIMEZONE });
    await Effect.runPromise(Effect.ignore(this.pipeline.run()));
  }

  // The send carries no alert of its own — the route adds one, and so does this. Without the wrap a
  // failed 7h send would be silent, which is a newsletter that stops going out and says nothing.
  @Cron(SEND_SCHEDULE, { name: "send", timeZone: TIMEZONE })
  async send(): Promise<void> {
    this.logger.log({ msg: "schedule fired", schedule: SEND_SCHEDULE, timeZone: TIMEZONE });
    await Effect.runPromise(Effect.ignore(this.alert.onFailure("send", this.pipeline.send())));
  }
}
