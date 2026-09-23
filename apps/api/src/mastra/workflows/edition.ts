import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Data, Effect, Exit } from "effect";
import { z } from "zod";
import { failureReason } from "../../effect/reason";
import { runDate, STEP_RETRIES } from "../../pipeline/run";
import { editionContext, type EditionRequestContext, type EditionSteps } from "./context";

// What one run carries: the day it is for and a summary per step, filled as it goes. The whole
// report, with the token cost, goes to the log — the architecture keeps cost out of storage — and
// the snapshot Mastra writes stays small.
const collectSummary = z.object({
  saved: z.number(),
  evaluated: z.number(),
  discarded: z.number(),
  durationMs: z.number(),
});

const writeSummary = z.object({
  editionId: z.string(),
  status: z.enum(["written", "skipped"]),
  written: z.number(),
  rejected: z.number(),
  subject: z.string().nullable(),
  durationMs: z.number(),
});

const buildSummary = z.object({
  editionId: z.string(),
  subject: z.string(),
  items: z.number(),
  htmlBytes: z.number(),
  textBytes: z.number(),
  durationMs: z.number(),
});

export const editionRunSchema = z.object({
  date: z.string(),
  // What this run pays for: `live` calls the model, `mock` works over the fixture. It travels with
  // the run so the Studio and the snapshot say later which one it was.
  mode: z.enum(["live", "mock"]),
  collect: collectSummary.optional(),
  write: writeSummary.optional(),
  build: buildSummary.optional(),
});

export type EditionRun = z.infer<typeof editionRunSchema>;

class StaleRun extends Data.TaggedError("StaleRun")<{ reason: string }> {}

// The run carries the edition date, but the collection window is relative to the clock (24h, 48h on
// Mondays), so the steps keep reading the real clock and the date is what says which day this run
// belongs to. A run for another day would collect into today and write into yesterday, so it stops
// here.
const forToday = (date: string): Effect.Effect<void, StaleRun> => {
  const today = runDate(new Date());
  return date === today ? Effect.void : new StaleRun({ reason: `run is for ${date} and today is ${today}` });
};

// One shape for the three steps: read the service from the run context, run its effect, fold the
// report into the run. A step reports failure by throwing, which is also what makes Mastra try it
// again — the services speak Effect and never throw, so the conversion happens here, once.
const stepOf = <A>(
  id: string,
  run: (pipeline: EditionSteps, input: EditionRun) => Effect.Effect<A, { reason: string }>,
  fold: (previous: EditionRun, report: A) => EditionRun,
  skip?: (previous: EditionRun) => boolean,
) =>
  createStep({
    id,
    inputSchema: editionRunSchema,
    outputSchema: editionRunSchema,
    retries: STEP_RETRIES,
    execute: async ({ inputData, requestContext }) => {
      if (skip?.(inputData)) return inputData;

      const exit = await Effect.runPromiseExit(
        editionContext(id, requestContext as EditionRequestContext).pipe(
          Effect.tap(() => forToday(inputData.date)),
          Effect.flatMap(({ pipeline }) => run(pipeline, inputData)),
          Effect.map((report) => fold(inputData, report)),
        ),
      );
      if (Exit.isFailure(exit)) throw new Error(failureReason(exit.cause));
      return exit.value;
    },
  });

export const collectStep = stepOf(
  "collect",
  (pipeline, run) => pipeline.collect({ mode: run.mode }),
  (previous, report) => ({
    ...previous,
    collect: {
      saved: report.saved,
      evaluated: report.result.candidates.length,
      discarded: report.result.discarded,
      durationMs: report.durationMs,
    },
  }),
);

export const writeStep = stepOf(
  "write",
  (pipeline, run) => pipeline.write({ mode: run.mode }),
  (previous, report) => ({
    ...previous,
    write: {
      editionId: report.editionId,
      status: report.status,
      written: report.written,
      rejected: report.rejected,
      subject: report.header?.subject ?? null,
      durationMs: report.durationMs,
    },
  }),
);

// An edition below the minimum was skipped on purpose, and there is nothing to build: building it
// would fail the validation and alert the owners over an outcome that is not a failure.
export const buildStep = stepOf(
  "build",
  (pipeline, run) => pipeline.build({ mode: run.mode }),
  (previous, report) => ({
    ...previous,
    build: {
      editionId: report.editionId,
      subject: report.subject,
      items: report.items,
      htmlBytes: report.htmlBytes,
      textBytes: report.textBytes,
      durationMs: report.durationMs,
    },
  }),
  (previous) => previous.write?.status === "skipped",
);

// The three steps of the generation, in order. The sending step is not here: it is a run of its own,
// at 7h, and the edition is ready before it.
export const editionWorkflow = createWorkflow({
  id: "edition",
  inputSchema: editionRunSchema,
  outputSchema: editionRunSchema,
})
  .then(collectStep)
  .then(writeStep)
  .then(buildStep)
  .commit();
