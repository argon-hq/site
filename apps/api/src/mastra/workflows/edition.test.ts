import { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildReport, IngestReport, WriteReport } from "../../pipeline/pipeline.service";
import { runDate, STEP_RETRIES } from "../../pipeline/run";
import { bindPipeline, type EditionContext, type PipelinePort } from "./context";
import { buildStep, editionRunSchema, editionWorkflow, ingestStep, writeStep, type EditionRun } from "./edition";

class StepFailed extends Data.TaggedError("StepFailed")<{ reason: string }> {}

const ingestReport = {
  sources: 6,
  sourcesFailed: ["gartner.com"],
  listed: 870,
  inWindow: 579,
  groups: 388,
  fichas: 166,
  items: [{}],
  durationMs: 90,
} as unknown as IngestReport;
const ingestSummary = {
  sources: 6,
  sourcesFailed: ["gartner.com"],
  listed: 870,
  inWindow: 579,
  groups: 388,
  fichas: 166,
  durationMs: 90,
};
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

const unused = () => Effect.die("not part of the generation");

const steps = (over: Partial<PipelinePort> = {}): PipelinePort => ({
  ingest: () => Effect.succeed(ingestReport),
  write: () => Effect.succeed(writeReport),
  build: () => Effect.succeed(buildReport),
  alert: () => Effect.void,
  send: unused,
  deliveryStatus: unused,
  editionHtml: unused,
  addToWriteDataset: unused,
  ...over,
});

// The step only ever sees the run context, so the test hands it the same thing the run does.
const contextOf = (pipeline: PipelinePort) => {
  const requestContext = new RequestContext<EditionContext>();
  requestContext.set("pipeline", pipeline);
  return requestContext;
};

type Step = { execute: (args: unknown) => Promise<EditionRun>; retries?: number };

const execute = (step: unknown, inputData: unknown, pipeline = steps(), retryCount = 0): Promise<EditionRun> =>
  (step as Step).execute({ inputData, requestContext: contextOf(pipeline), runId: "run-1", retryCount });

afterEach(() => bindPipeline(undefined));

const today = (over: Partial<EditionRun> = {}): EditionRun => ({ date: runDate(new Date()), mode: "live", ...over });

describe("the edition steps", () => {
  it("folds the ingestion's counts into the run, without the items", async () => {
    const run = await execute(ingestStep, today());

    expect(run.ingest).toEqual(ingestSummary);
    expect(editionRunSchema.safeParse(run).success).toBe(true);
  });

  it("hands every step the workflow's run id, for its log lines", async () => {
    const ingest = vi.fn(() => Effect.succeed(ingestReport));
    await execute(ingestStep, today({ mode: "mock" }), steps({ ingest }));
    expect(ingest).toHaveBeenCalledWith({ mode: "mock", runId: "run-1", tracingContext: undefined });
  });

  it("folds the writing into the run, keeping what came before", async () => {
    const run = await execute(writeStep, today({ ingest: ingestSummary }));

    expect(run.ingest).toBeDefined();
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
    const pipeline = steps({ ingest: () => new StepFailed({ reason: "settings: boom" }) });

    await expect(execute(ingestStep, today(), pipeline)).rejects.toThrow("settings: boom");
  });

  it("settles the day and the mode the Studio's form left empty", async () => {
    const run = await execute(ingestStep, {});

    expect(run.date).toBe(runDate(new Date()));
    // A development machine's profile is mocked.
    expect(run.mode).toBe("mock");
  });

  it("finds the pipeline the process bound when the run carries none, as a run from the Studio does", async () => {
    bindPipeline(steps());
    const step = ingestStep as unknown as Step;

    const run = await step.execute({ inputData: today(), requestContext: new RequestContext(), runId: "run-1" });

    expect(run.ingest).toEqual(ingestSummary);
  });

  it("fails by name when neither the run nor the process has a pipeline", async () => {
    const step = ingestStep as unknown as Step;

    await expect(step.execute({ inputData: today(), requestContext: new RequestContext() })).rejects.toThrow(
      "no pipeline in the run context",
    );
  });

  it("alerts the owners on the last attempt only, so a step that tried three times costs one e-mail", async () => {
    const alert = vi.fn(() => Effect.void);
    const pipeline = steps({ ingest: () => new StepFailed({ reason: "settings: boom" }), alert });

    for (let attempt = 0; attempt < STEP_RETRIES; attempt++) {
      await expect(execute(ingestStep, today(), pipeline, attempt)).rejects.toThrow("settings: boom");
    }
    expect(alert).not.toHaveBeenCalled();

    await expect(execute(ingestStep, today(), pipeline, STEP_RETRIES)).rejects.toThrow("settings: boom");
    expect(alert).toHaveBeenCalledExactlyOnceWith("ingest", "settings: boom");
  });

  it("refuses a run for another day, because the steps read the real clock", async () => {
    await expect(execute(ingestStep, { date: "2020-01-01", mode: "live" })).rejects.toThrow("run is for 2020-01-01");
  });

  it("tries a failed step again before giving up", () => {
    expect((ingestStep as unknown as Step).retries).toBe(STEP_RETRIES);
  });
});

describe("the edition workflow", () => {
  it("runs the three steps of the generation, in order", () => {
    expect(Object.keys(editionWorkflow.steps)).toEqual(["ingest", "write", "build"]);
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
