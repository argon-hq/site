import { Injectable, Logger } from "@nestjs/common";
import type { Mastra } from "@mastra/core/mastra";
import type { WorkflowSchedule } from "@mastra/core/schedules";
import { MastraService } from "@mastra/nestjs";
import { Data, Effect } from "effect";
import { CONFLICT, NOT_FOUND, type Failure } from "../effect/failure";
import type { Mode } from "./profile";
import { RETENTION_SCHEDULE } from "./retention";
import { SCHEDULE, SEND_SCHEDULE, SUNDAY_SCHEDULE, SUNDAY_SEND_SCHEDULE, TIMEZONE, WATCH_SCHEDULE } from "./run";

// The clocks of the day as the code knows them. The rows the scheduler fires from live in the
// `mastra` schema and are created from this table at boot, only when missing: from then on the row is
// what fires, so a change made in the Studio survives a restart and a deploy. The table is the
// default and what `schedule_reset` goes back to; the boot says so when a row has moved away from it.
export type CodeSchedule = {
  key: string;
  workflowId: string;
  cron: string;
  timezone: string;
  inputData: Record<string, unknown>;
  description: string;
};

export const CODE_SCHEDULES: readonly CodeSchedule[] = [
  {
    key: "retention",
    workflowId: "retention",
    cron: RETENTION_SCHEDULE,
    timezone: TIMEZONE,
    inputData: {},
    description: "Nightly trim, between the backup and the generation. Every day.",
  },
  {
    key: "edition",
    workflowId: "edition",
    cron: SCHEDULE,
    timezone: TIMEZONE,
    inputData: {},
    description: "The generation, Monday to Saturday, in the profile's mode.",
  },
  {
    key: "send",
    workflowId: "send",
    cron: SEND_SCHEDULE,
    timezone: TIMEZONE,
    inputData: {},
    description: "The send, an hour and a half after the generation starts.",
  },
  {
    key: "watch",
    workflowId: "watch",
    cron: WATCH_SCHEDULE,
    timezone: TIMEZONE,
    inputData: {},
    description: "An hour after the send: whatever is still mid-run is stuck.",
  },
  {
    key: "edition-sunday",
    workflowId: "heartbeat",
    cron: SUNDAY_SCHEDULE,
    timezone: TIMEZONE,
    inputData: { kind: "generate" },
    description: "Sunday has no edition; the beat keeps the generation alarm quiet.",
  },
  {
    key: "send-sunday",
    workflowId: "heartbeat",
    cron: SUNDAY_SEND_SCHEDULE,
    timezone: TIMEZONE,
    inputData: { kind: "send" },
    description: "Sunday has no send; the beat keeps the send alarm quiet.",
  },
];

// Mastra prefixes the id of a schedule created in code; the operator types the short one.
const PREFIX = "schedule_";
export const rowId = (key: string) => (key.startsWith(PREFIX) ? key : `${PREFIX}${key}`);
export const keyOf = (id: string) => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

// A schedule as the operator reads it: when, in which zone, what it runs, and whether it still says
// what the code says.
export type ScheduleView = {
  id: string;
  workflowId: string;
  description: string | null;
  cron: string;
  timezone: string | null;
  status: "active" | "paused";
  inputData: unknown;
  nextFireAt: string | null;
  lastFireAt: string | null;
  lastRunId: string | null;
  code: { cron: string; timezone: string; inputData: Record<string, unknown> } | null;
  differsFromCode: string[];
};

// What the operator may change. `mode` is the edition's only input worth a knob; `profile` clears it.
export type ScheduleChange = {
  id: string;
  cron?: string;
  timezone?: string;
  mode?: Mode | "profile";
  status?: "active" | "paused";
};

export class ScheduleFailed extends Data.TaggedError("ScheduleFailed")<Failure> {}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

// Which fields of a row no longer say what the code says. Empty for a row that matches, and for a
// row the code does not know (someone created it by hand): there is nothing to compare it with.
export function differsFromCode(row: WorkflowSchedule, code: CodeSchedule | undefined): string[] {
  if (!code) return [];
  const fields: string[] = [];
  if (row.cron !== code.cron) fields.push("cron");
  if ((row.timezone ?? null) !== code.timezone) fields.push("timezone");
  if (!same(row.inputData, code.inputData)) fields.push("inputData");
  return fields;
}

const iso = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : null);

export function toView(row: WorkflowSchedule, code: CodeSchedule | undefined): ScheduleView {
  return {
    id: keyOf(row.id),
    workflowId: row.workflowId,
    description: code?.description ?? null,
    cron: row.cron,
    timezone: row.timezone ?? null,
    status: row.status,
    inputData: row.inputData ?? {},
    nextFireAt: row.status === "active" ? iso(row.nextFireAt) : null,
    lastFireAt: iso(row.lastFireAt),
    lastRunId: row.lastRunId ?? null,
    code: code ? { cron: code.cron, timezone: code.timezone, inputData: code.inputData } : null,
    differsFromCode: differsFromCode(row, code),
  };
}

// The edition's input with the mode changed, or cleared back to the profile.
export function withMode(inputData: unknown, mode: ScheduleChange["mode"]): Record<string, unknown> {
  const rest = { ...((inputData ?? {}) as Record<string, unknown>) };
  delete rest.mode;
  return mode === undefined || mode === "profile" ? rest : { ...rest, mode };
}

type Schedules = Mastra["schedules"];

// The schedules as the operator works them, from the Studio's tools. Every change goes through
// Mastra's own service, so the scheduler and the Studio's schedule page see it at once.
@Injectable()
export class ScheduleRegistry {
  private readonly logger = new Logger(ScheduleRegistry.name);

  constructor(private readonly mastra: MastraService) {}

  // Whether this process runs the clock. A fire published with no worker to take it would sit in
  // memory and never run, so firing by hand waits for it too.
  running = false;

  private get schedules(): Schedules {
    return this.mastra.getMastra().schedules;
  }

  private call<A>(what: string, run: (schedules: Schedules) => Promise<A>): Effect.Effect<A, ScheduleFailed> {
    return Effect.tryPromise({
      try: () => run(this.schedules),
      catch: (error) =>
        new ScheduleFailed({ reason: `${what}: ${error instanceof Error ? error.message : String(error)}` }),
    });
  }

  private workflowRow(id: string): Effect.Effect<WorkflowSchedule, ScheduleFailed> {
    return this.call("read schedule", (s) => s.get(rowId(id))).pipe(
      Effect.flatMap((row) =>
        row && row.workflowId
          ? Effect.succeed(row)
          : Effect.fail(new ScheduleFailed({ reason: `no schedule ${keyOf(id)}`, status: NOT_FOUND })),
      ),
    );
  }

  private view(row: WorkflowSchedule): ScheduleView {
    return toView(
      row,
      CODE_SCHEDULES.find((code) => rowId(code.key) === row.id),
    );
  }

  list(): Effect.Effect<ScheduleView[], ScheduleFailed> {
    return this.call("list schedules", (s) => s.list()).pipe(
      Effect.map((rows) =>
        rows
          .filter((row): row is WorkflowSchedule => Boolean(row.workflowId))
          .map((row) => this.view(row))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    );
  }

  change(change: ScheduleChange): Effect.Effect<ScheduleView, ScheduleFailed> {
    return Effect.gen(this, function* () {
      const row = yield* this.workflowRow(change.id);
      if (change.mode !== undefined && row.workflowId !== "edition") {
        return yield* new ScheduleFailed({ reason: `mode only applies to the edition, not ${row.workflowId}` });
      }
      const updated = yield* this.call("update schedule", (s) =>
        s.update(row.id, {
          ...(change.cron !== undefined ? { cron: change.cron } : {}),
          ...(change.timezone !== undefined ? { timezone: change.timezone } : {}),
          ...(change.mode !== undefined ? { inputData: withMode(row.inputData, change.mode) } : {}),
          ...(change.status !== undefined ? { status: change.status } : {}),
        }),
      );
      const view = this.view(updated as WorkflowSchedule);
      this.logger.log({ msg: "schedule changed", ...change, differsFromCode: view.differsFromCode });
      return view;
    });
  }

  // Fires now, outside the cron: recorded in the schedule's history as `manual`, next fire untouched.
  run(id: string): Effect.Effect<{ scheduleId: string; runId: string }, ScheduleFailed> {
    return Effect.gen(this, function* () {
      if (!this.running) {
        return yield* new ScheduleFailed({
          reason: "the scheduler is off in this process (SCHEDULER_ENABLED); run the workflow from its own page",
          status: CONFLICT,
        });
      }
      const row = yield* this.workflowRow(id);
      const fired = yield* this.call("run schedule", (s) => s.run(row.id));
      const runId = `sched_${fired.scheduleId}_${fired.scheduledFireAt}`;
      this.logger.log({ msg: "schedule run by hand", schedule: keyOf(row.id), runId });
      return { scheduleId: keyOf(row.id), runId };
    });
  }

  // Back to what the code says: one schedule, or every one the code knows. The status is kept — a
  // paused clock stays paused until someone resumes it.
  reset(id: string | undefined): Effect.Effect<ScheduleView[], ScheduleFailed> {
    const codes = id ? CODE_SCHEDULES.filter((code) => code.key === keyOf(id)) : CODE_SCHEDULES;
    if (codes.length === 0) {
      return Effect.fail(
        new ScheduleFailed({ reason: `no schedule ${keyOf(id ?? "")} in the code`, status: NOT_FOUND }),
      );
    }
    return Effect.forEach(codes, (code) =>
      this.call("reset schedule", (s) =>
        s.update(rowId(code.key), { cron: code.cron, timezone: code.timezone, inputData: code.inputData }),
      ).pipe(Effect.map((row) => this.view(row as WorkflowSchedule))),
    ).pipe(
      Effect.tap((views) =>
        Effect.sync(() => this.logger.log({ msg: "schedules reset", ids: views.map((v) => v.id) })),
      ),
    );
  }

  // At boot, before the clock starts: create what is missing, say which rows moved away from the
  // code, and skip what was missed. Nothing that exists is overwritten — that is the operator's
  // change, and `reset` is how it is undone.
  sync(now: Date = new Date()): Effect.Effect<void, ScheduleFailed> {
    return Effect.forEach(CODE_SCHEDULES, (code) => this.syncOne(code, now), { discard: true });
  }

  private syncOne(code: CodeSchedule, now: Date): Effect.Effect<void, ScheduleFailed> {
    return Effect.gen(this, function* () {
      const row = yield* this.call("read schedule", (s) => s.get(rowId(code.key)));
      if (!row) {
        yield* this.call("create schedule", (s) =>
          s.create({
            id: code.key,
            workflowId: code.workflowId,
            cron: code.cron,
            timezone: code.timezone,
            inputData: code.inputData,
            metadata: { description: code.description },
          }),
        );
        this.logger.log({ msg: "schedule created", id: code.key, cron: code.cron });
        return;
      }
      if (!row.workflowId) return;
      yield* this.skipMissed(row, now);
      const moved = differsFromCode(row, code);
      if (moved.length > 0) {
        this.logger.warn({
          msg: "schedule differs from code",
          id: code.key,
          fields: moved,
          row: { cron: row.cron, timezone: row.timezone, inputData: row.inputData },
          code: { cron: code.cron, timezone: code.timezone, inputData: code.inputData },
        });
      }
    });
  }

  // The scheduler fires a time that passed while nobody was running, once, on its first tick. After
  // a night down that is the generation, the send and the watch all at once, and the send racing a
  // generation that has not started. The Nest clock this replaces just missed them, and so does this:
  // a fire older than the grace is skipped — pausing and resuming recomputes it from now — and the
  // line says so. A restart inside the grace, a deploy at 5h29, still fires late.
  private skipMissed(row: WorkflowSchedule, now: Date): Effect.Effect<void, ScheduleFailed> {
    const missed = row.status === "active" && row.nextFireAt < now.getTime() - MISSED_GRACE_MS;
    if (!missed) return Effect.void;
    return this.call("skip missed fire", async (s) => {
      await s.pause(row.id);
      await s.resume(row.id);
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() =>
          this.logger.warn({
            msg: "schedule missed",
            id: keyOf(row.id),
            missedAt: new Date(row.nextFireAt).toISOString(),
          }),
        ),
      ),
    );
  }
}

// How late a fire may still go out after a restart.
export const MISSED_GRACE_MS = 10 * 60 * 1000;
