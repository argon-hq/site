import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import type { Event } from "@mastra/core/events";
import { MastraService } from "@mastra/nestjs";
import { Effect } from "effect";
import { ScheduleRegistry } from "./schedules";

// The prefix Mastra gives the run id of every fire, by cron or by hand (`sched_<schedule>_<time>`).
const FIRED = /^sched_(.+)_(\d+)$/;

// The clocks of the day, now Mastra's: the rows in `mastra.mastra_schedules`, which the Studio shows
// and pauses, and the operator's tools change. `@mastra/nestjs` starts none of it — only `mastra dev`
// and the deployer server call `startWorkers()` — so this does, where SCHEDULER_ENABLED says so. An
// environment with it off has no clock at all; a run is still one POST /pipeline/run away, or the
// Studio's own Run button.
@Injectable()
export class MastraClock implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MastraClock.name);

  constructor(
    private readonly mastra: MastraService,
    private readonly registry: ScheduleRegistry,
  ) {}

  // `schedule fired` is the line a CloudWatch alarm counts per day, so every fire writes it, from the
  // one place they all pass: the start event the scheduler publishes.
  private readonly fired = async (event: Event): Promise<void> => {
    if (event.type !== "workflow.start") return;
    const data = (event.data ?? {}) as { runId?: string; workflowId?: string };
    const runId = event.runId || data.runId || "";
    const match = FIRED.exec(runId);
    if (!match) return;
    this.logger.log({
      msg: "schedule fired",
      schedule: match[1]?.replace(/^schedule_/, ""),
      workflow: data.workflowId,
      runId,
    });
  };

  async onApplicationBootstrap(): Promise<void> {
    const mastra = this.mastra.getMastra();
    // The rows first, so a fire missed while the process was down is skipped before the first tick
    // can send it.
    await Effect.runPromise(
      this.registry
        .sync()
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => this.logger.error({ msg: "schedule sync failed", reason: error.reason })),
          ),
        ),
    );
    await mastra.pubsub.subscribe("workflows", this.fired);
    await mastra.startWorkers();
    this.registry.running = true;
    this.logger.log({ msg: "clock started" });
  }

  // Before the HTTP server closes, like the Studio's streams: a tick in flight finishes, and no new
  // fire is claimed by a process on its way out — the next container claims it instead.
  async beforeApplicationShutdown(): Promise<void> {
    this.registry.running = false;
    const mastra = this.mastra.getMastra();
    await mastra.pubsub.unsubscribe("workflows", this.fired);
    await mastra.stopWorkers();
  }
}
