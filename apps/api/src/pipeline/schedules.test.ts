import type { WorkflowSchedule } from "@mastra/core/schedules";
import type { MastraService } from "@mastra/nestjs";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  CODE_SCHEDULES,
  differsFromCode,
  MISSED_GRACE_MS,
  rowId,
  ScheduleRegistry,
  withMode,
  type CodeSchedule,
} from "./schedules";

const now = new Date("2026-09-24T12:00:00Z");
const edition = CODE_SCHEDULES.find((code) => code.key === "edition") as CodeSchedule;

const rowOf = (code: CodeSchedule, over: Partial<WorkflowSchedule> = {}): WorkflowSchedule => ({
  id: rowId(code.key),
  workflowId: code.workflowId,
  cron: code.cron,
  timezone: code.timezone,
  status: "active",
  nextFireAt: now.getTime() + 60_000,
  inputData: code.inputData,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// Mastra's schedules service over a map, recording what was asked of it.
function registry(rows: WorkflowSchedule[] = []) {
  const table = new Map(rows.map((row) => [row.id, row]));
  const schedules = {
    get: vi.fn(async (id: string) => table.get(id) ?? null),
    list: vi.fn(async () => [...table.values()]),
    create: vi.fn(async (input: { id: string } & Partial<WorkflowSchedule>) => {
      const row = { ...rowOf(edition), ...input, id: rowId(input.id) } as WorkflowSchedule;
      table.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: Partial<WorkflowSchedule>) => {
      const row = { ...(table.get(id) as WorkflowSchedule), ...patch };
      table.set(id, row);
      return row;
    }),
    pause: vi.fn(async (id: string) => table.get(id)),
    resume: vi.fn(async (id: string) => table.get(id)),
    run: vi.fn(async (id: string) => ({ scheduleId: id, claimId: "c", scheduledFireAt: 42 })),
  };
  const mastra = { getMastra: () => ({ schedules }) } as unknown as MastraService;
  return { service: new ScheduleRegistry(mastra), schedules, table };
}

const failureOf = (exit: Exit.Exit<unknown, { reason: string; status?: number }>) =>
  Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : null;

describe("the boot sync", () => {
  it("creates every clock the code knows and the database does not, under the short id", async () => {
    const { service, schedules } = registry();

    await Effect.runPromise(service.sync(now));

    expect(schedules.create).toHaveBeenCalledTimes(CODE_SCHEDULES.length);
    expect(schedules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "edition",
        workflowId: "edition",
        cron: "30 5 * * 1-6",
        timezone: "America/Sao_Paulo",
      }),
    );
  });

  it("leaves a clock the operator changed as it is", async () => {
    const changed = rowOf(edition, { cron: "0 6 * * 1-6" });
    const { service, schedules } = registry(CODE_SCHEDULES.map((code) => (code === edition ? changed : rowOf(code))));

    await Effect.runPromise(service.sync(now));

    expect(schedules.create).not.toHaveBeenCalled();
    expect(schedules.update).not.toHaveBeenCalled();
  });

  it("skips a fire missed while the process was down, and keeps one inside the grace", async () => {
    const missed = rowOf(edition, { nextFireAt: now.getTime() - MISSED_GRACE_MS - 1 });
    const send = CODE_SCHEDULES.find((code) => code.key === "send") as CodeSchedule;
    const late = rowOf(send, { nextFireAt: now.getTime() - 60_000 });
    const { service, schedules } = registry([missed, late]);

    await Effect.runPromise(service.sync(now));

    expect(schedules.pause).toHaveBeenCalledExactlyOnceWith(missed.id);
    expect(schedules.resume).toHaveBeenCalledExactlyOnceWith(missed.id);
  });

  it("does not wake a paused clock over a missed fire", async () => {
    const paused = rowOf(edition, { status: "paused", nextFireAt: 0 });
    const { service, schedules } = registry([paused]);

    await Effect.runPromise(service.sync(now));

    expect(schedules.resume).not.toHaveBeenCalled();
  });
});

describe("what the operator changes", () => {
  it("changes the cron and says the clock no longer matches the code", async () => {
    const { service } = registry([rowOf(edition)]);

    const view = await Effect.runPromise(service.change({ id: "edition", cron: "*/5 * * * *" }));

    expect(view).toMatchObject({ id: "edition", cron: "*/5 * * * *", differsFromCode: ["cron"] });
    expect(view.code?.cron).toBe("30 5 * * 1-6");
  });

  it("sets the edition's mode, and clears it back to the profile", async () => {
    const { service } = registry([rowOf(edition)]);

    const live = await Effect.runPromise(service.change({ id: "edition", mode: "live" }));
    expect(live.inputData).toEqual({ mode: "live" });

    const profile = await Effect.runPromise(service.change({ id: "edition", mode: "profile" }));
    expect(profile.inputData).toEqual({});
    expect(profile.differsFromCode).toEqual([]);
  });

  it("refuses a mode on a clock that is not the edition", async () => {
    const send = CODE_SCHEDULES.find((code) => code.key === "send") as CodeSchedule;
    const { service } = registry([rowOf(send)]);

    const exit = await Effect.runPromiseExit(service.change({ id: "send", mode: "live" }));

    expect(failureOf(exit)?.reason).toContain("mode only applies to the edition");
  });

  it("answers 404 for a clock that does not exist", async () => {
    const { service } = registry();

    const exit = await Effect.runPromiseExit(service.change({ id: "nope", cron: "* * * * *" }));

    expect(failureOf(exit)).toMatchObject({ reason: "no schedule nope", status: 404 });
  });

  it("refuses to fire by hand where the clock is off: the fire would sit in memory with nobody to run it", async () => {
    const { service, schedules } = registry([rowOf(edition)]);

    const exit = await Effect.runPromiseExit(service.run("edition"));

    expect(failureOf(exit)).toMatchObject({ status: 409 });
    expect(schedules.run).not.toHaveBeenCalled();
  });

  it("fires by hand where the clock runs, and names the run to follow", async () => {
    const { service } = registry([rowOf(edition)]);
    service.running = true;

    const fired = await Effect.runPromise(service.run("edition"));

    expect(fired).toEqual({ scheduleId: "edition", runId: "sched_schedule_edition_42" });
  });

  it("puts every clock back to the code", async () => {
    const { service } = registry(
      CODE_SCHEDULES.map((code) => rowOf(code, { cron: "* * * * *", inputData: { mode: "live" } })),
    );

    const views = await Effect.runPromise(service.reset(undefined));

    expect(views).toHaveLength(CODE_SCHEDULES.length);
    expect(views.every((view) => view.differsFromCode.length === 0)).toBe(true);
  });
});

describe("the comparison with the code", () => {
  it("names each field that moved", () => {
    const row = rowOf(edition, { cron: "0 6 * * *", timezone: "UTC", inputData: { mode: "live" } });

    expect(differsFromCode(row, edition)).toEqual(["cron", "timezone", "inputData"]);
  });

  it("has nothing to say about a clock the code does not know", () => {
    expect(differsFromCode(rowOf(edition), undefined)).toEqual([]);
  });

  it("keeps the rest of the input when the mode changes", () => {
    expect(withMode({ date: "2026-09-24", mode: "mock" }, "live")).toEqual({ date: "2026-09-24", mode: "live" });
    expect(withMode({ mode: "mock" }, "profile")).toEqual({});
  });
});
