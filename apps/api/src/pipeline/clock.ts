import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import type { Event } from "@mastra/core/events";
import { MastraService } from "@mastra/nestjs";
import { Data, Duration, Effect, Fiber, Schedule } from "effect";
import { ScheduleRegistry } from "./schedules";

// The prefix Mastra gives the run id of every fire, by cron or by hand (`sched_<schedule>_<time>`).
const FIRED = /^sched_(.+)_(\d+)$/;

// How long the clock waits before trying to start again after a failure.
export const CLOCK_RETRY = Duration.seconds(30);

class ClockStartFailed extends Data.TaggedError("ClockStartFailed")<{ reason: string }> {}

// The clocks of the day, now Mastra's: the rows in `mastra.mastra_schedules`, which the Studio shows
// and pauses, and the operator's tools change. `@mastra/nestjs` starts none of it — only `mastra dev`
// and the deployer server call `startWorkers()` — so this does, where SCHEDULER_ENABLED says so. An
// environment with it off has no clock at all; a run is still one POST /pipeline/run away, or the
// Studio's own Run button.
@Injectable()
export class MastraClock implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MastraClock.name);
  private starting: Fiber.RuntimeFiber<void, never> | undefined;
  // How long to wait between attempts to start; a test shortens it.
  retryAfter: Duration.Duration = CLOCK_RETRY;

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

  // The rows first, so a fire missed while the process was down is skipped before the first tick can
  // send it; then the workers, which is where the database is first needed for good.
  private start(): Effect.Effect<void, ClockStartFailed> {
    return Effect.suspend(() => this.registry.sync()).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => this.logger.error({ msg: "schedule sync failed", reason: error.reason })),
      ),
      Effect.andThen(
        Effect.tryPromise({
          try: () => this.mastra.getMastra().startWorkers(),
          catch: (error) => new ClockStartFailed({ reason: error instanceof Error ? error.message : String(error) }),
        }),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          this.registry.running = true;
          this.logger.log({ msg: "clock started" });
        }),
      ),
    );
  }

  // The clock never takes the API down with it. A database that is not there at boot — a deploy
  // racing the Postgres container, a restart after a night down — used to leave the API up, with
  // /health saying so; a clock that failed its boot would instead end the process and put the
  // container in a restart loop. So it starts in the background and tries again until it can, and
  // each failure is an error line the alarm on errors counts.
  async onApplicationBootstrap(): Promise<void> {
    await this.mastra.getMastra().pubsub.subscribe("workflows", this.fired);
    this.starting = Effect.runFork(
      this.start().pipe(
        Effect.tapError((error) =>
          Effect.sync(() =>
            this.logger.error({
              msg: "clock start failed",
              reason: error.reason,
              retryInSeconds: Duration.toSeconds(this.retryAfter),
            }),
          ),
        ),
        Effect.retry(Schedule.spaced(this.retryAfter)),
        Effect.orDie,
      ),
    );
  }

  // Before the HTTP server closes, like the Studio's streams: a tick in flight finishes, and no new
  // fire is claimed by a process on its way out — the next container claims it instead.
  async beforeApplicationShutdown(): Promise<void> {
    if (this.starting) await Effect.runPromise(Fiber.interrupt(this.starting));
    const wasRunning = this.registry.running;
    this.registry.running = false;
    const mastra = this.mastra.getMastra();
    await mastra.pubsub.unsubscribe("workflows", this.fired);
    if (wasRunning) await mastra.stopWorkers();
  }
}
