import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { BuildReport, CollectReport, WriteReport } from "../../pipeline/pipeline.service";
import { runDate, STEP_RETRIES } from "../../pipeline/run";
import type { EditionContext, EditionSteps } from "./context";
import { buildStep, collectStep, editionRunSchema, editionWorkflow, writeStep, type EditionRun } from "./edition";

class StepFailed extends Data.TaggedError("StepFailed")<{ reason: string }> {}

const collectReport = { saved: 4, result: { candidates: [1, 2, 3, 4, 5], discarded: 7 }, durationMs: 90 } as unknown as CollectReport;
const writeReport = {
  editionId: "e1",
  status: "written",
  written: 4,
  rejected: 1,
  header: { subject: "Crédito, SELIC e IA" },
  durationMs: 80,
} as unknown as WriteReport;
const buildReport = {
  editionId: "e1",
  subject: "Crédito, SELIC e IA",
  items: 4,
  htmlBytes: 12472,
  textBytes: 1304,
  durationMs: 70,
} as unknown as BuildReport;

const steps = (over: Partial<EditionSteps> = {}): EditionSteps => ({
  collect: () => Effect.succeed(collectReport),
  write: () => Effect.succeed(writeReport),
  build: () => Effect.succeed(buildReport),
  ...over,
});

// The step only ever sees the run context, so the test hands it the same thing the run does.
const contextOf = (pipeline: EditionSteps) => {
  const requestContext = new RequestContext<EditionContext>();
  requestContext.set("pipeline", pipeline);
  return requestContext;
};

type Step = { execute: (args: unknown) => Promise<EditionRun>; retries?: number };

const execute = (step: unknown, inputData: EditionRun, pipeline = steps()): Promise<EditionRun> =>
  (step as Step).execute({ inputData, requestContext: contextOf(pipeline) });

const today = (over: Partial<EditionRun> = {}): EditionRun => ({ date: runDate(new Date()), ...over });

describe("the edition steps", () => {
  it("folds the collection into the run", async () => {
    const run = await execute(collectStep, today());

    expect(run.collect).toEqual({ saved: 4, evaluated: 5, discarded: 7, durationMs: 90 });
    expect(editionRunSchema.safeParse(run).success).toBe(true);
  });

  it("folds the writing into the run, keeping what came before", async () => {
    const run = await execute(writeStep, today({ collect: { saved: 4, evaluated: 5, discarded: 7, durationMs: 90 } }));

    expect(run.collect).toBeDefined();
    expect(run.write).toEqual({
      editionId: "e1",
      status: "written",
      written: 4,
      rejected: 1,
      subject: "Crédito, SELIC e IA",
      durationMs: 80,
    });
  });

  it("folds the building into the run", async () => {
    const run = await execute(buildStep, today({ write: { ...writeSummary() } }));

    expect(run.build).toEqual({
      editionId: "e1",
      subject: "Crédito, SELIC e IA",
      items: 4,
      htmlBytes: 12472,
      textBytes: 1304,
      durationMs: 70,
    });
  });

  it("builds nothing when the edition was skipped: there is no edition to build", async () => {
    const build = vi.fn(() => Effect.succeed(buildReport));
    const input = today({ write: { ...writeSummary(), status: "skipped", written: 1, subject: null } });

    const run = await execute(buildStep, input, steps({ build }));

    expect(build).not.toHaveBeenCalled();
    expect(run.build).toBeUndefined();
    expect(run).toEqual(input);
  });

  it("throws the reason when the step fails, which is what makes Mastra try again", async () => {
    const pipeline = steps({ collect: () => new StepFailed({ reason: "settings: boom" }) });

    await expect(execute(collectStep, today(), pipeline)).rejects.toThrow("settings: boom");
  });

  it("fails by name when the run carries no pipeline, as a run from the Studio does", async () => {
    const step = collectStep as unknown as Step;

    await expect(step.execute({ inputData: today(), requestContext: new RequestContext() })).rejects.toThrow(
      "no pipeline in the run context",
    );
  });

  it("refuses a run for another day, because the steps read the real clock", async () => {
    await expect(execute(collectStep, { date: "2020-01-01" })).rejects.toThrow("run is for 2020-01-01");
  });

  it("tries a failed step again before giving up", () => {
    expect((collectStep as unknown as Step).retries).toBe(STEP_RETRIES);
  });
});

describe("the edition workflow", () => {
  it("runs the three steps of the generation, in order", () => {
    expect(Object.keys(editionWorkflow.steps)).toEqual(["collect", "write", "build"]);
  });
});

function writeSummary() {
  return {
    editionId: "e1",
    status: "written" as const,
    written: 4,
    rejected: 1,
    subject: "Crédito, SELIC e IA" as string | null,
    durationMs: 80,
  };
}
