import { describe, expect, it, vi } from "vitest";
import { JobsController, jobBody } from "./jobs.controller";
import type { BackupJob } from "./backup";
import type { RetentionScheduler } from "./retention";
import type { PipelineScheduler } from "./scheduler";

function controller() {
  const pipeline = {
    generate: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    watchEditions: vi.fn(async () => undefined),
    sundayGenerate: vi.fn(),
    sundaySend: vi.fn(),
  };
  const retention = { nightly: vi.fn(async () => undefined) };
  const backup = { run: vi.fn(async () => undefined) };
  const jobs = new JobsController(
    pipeline as unknown as PipelineScheduler,
    retention as unknown as RetentionScheduler,
    backup as unknown as BackupJob,
  );
  return { jobs, pipeline, retention, backup };
}

describe("the jobs route", () => {
  it.each([
    ["edition", "generate"],
    ["send", "send"],
    ["watch", "watchEditions"],
    ["sunday-edition", "sundayGenerate"],
    ["sunday-send", "sundaySend"],
  ] as const)("runs %s with the clock's own method", async (job, method) => {
    const { jobs, pipeline } = controller();
    await expect(jobs.run({ job })).resolves.toEqual({ job, done: true });
    expect(pipeline[method]).toHaveBeenCalledOnce();
  });

  it("runs the retention with the retention clock's method", async () => {
    const { jobs, retention, pipeline } = controller();
    await jobs.run({ job: "retention" });
    expect(retention.nightly).toHaveBeenCalledOnce();
    expect(pipeline.generate).not.toHaveBeenCalled();
  });

  it("runs the backup with the backup job", async () => {
    const { jobs, backup } = controller();
    await jobs.run({ job: "backup" });
    expect(backup.run).toHaveBeenCalledOnce();
  });

  it("answers only after the job is over", async () => {
    const { jobs, pipeline } = controller();
    let finished = false;
    pipeline.generate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await jobs.run({ job: "edition" });
    expect(finished).toBe(true);
  });

  it("refuses a job it does not know", () => {
    expect(jobBody.safeParse({ job: "drop-everything" }).success).toBe(false);
    expect(jobBody.safeParse({}).success).toBe(false);
  });
});
