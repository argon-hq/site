import { createWorkflow } from "@mastra/core/workflows";
import { Data, Effect } from "effect";
import { z } from "zod";
import { DEPLOYMENT, resolveMode } from "../../pipeline/profile";
import { runDate, STEP_RETRIES } from "../../pipeline/run";
import type { PipelinePort } from "./context";
import { stepOf } from "./step";

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

export const modeSchema = z
  .enum(["live", "mock"])
  .describe(
    "live calls the model; mock works over the fixture. Empty: the environment's profile. Production is always live.",
  );

// What starts a run. Both fields are optional so a schedule row and the Studio's form can start one
// with nothing: the day is today in São Paulo and the mode is the profile's.
export const editionRequestSchema = z.object({
  date: z.iso.date().optional().describe("YYYY-MM-DD, São Paulo. Empty: today. A run for another day is refused."),
  mode: modeSchema.optional(),
});

export const editionRunSchema = z.object({
  date: z.string(),
  // What this run pays for. It travels with the run so the Studio and the snapshot say later which
  // one it was.
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

// A step of the generation: check the day, run, fold the report into the run.
const generationStep = <A>(
  id: string,
  description: string,
  run: (pipeline: PipelinePort, input: EditionRun) => Effect.Effect<A, { reason: string }>,
  fold: (previous: EditionRun, report: A) => EditionRun,
  skip?: (previous: EditionRun) => boolean,
) =>
  stepOf({
    id,
    description,
    inputSchema: editionRunSchema,
    outputSchema: editionRunSchema,
    retries: STEP_RETRIES,
    alert: true,
    run: (pipeline, input) =>
      skip?.(input)
        ? Effect.succeed(input)
        : forToday(input.date).pipe(
            Effect.andThen(run(pipeline, input)),
            Effect.map((report) => fold(input, report)),
          ),
  });

// The first step settles what the request left open, so every step after it reads a whole run.
export const collectStep = stepOf({
  id: "collect",
  description: "The Editor searches the sources, reads and scores; code stores what passes.",
  inputSchema: editionRequestSchema,
  outputSchema: editionRunSchema,
  retries: STEP_RETRIES,
  alert: true,
  run: (pipeline, request) => {
    const run: EditionRun = {
      date: request.date ?? runDate(new Date()),
      mode: resolveMode(DEPLOYMENT, request.mode),
    };
    return forToday(run.date).pipe(
      Effect.andThen(pipeline.collect({ mode: run.mode })),
      Effect.map((report): EditionRun => ({
        ...run,
        collect: {
          saved: report.saved,
          evaluated: report.result.candidates.length,
          discarded: report.result.discarded,
          durationMs: report.durationMs,
        },
      })),
    );
  },
});

export const writeStep = generationStep(
  "write",
  "The Editor writes each stored article and the header; below the minimum the edition is skipped.",
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
export const buildStep = generationStep(
  "build",
  "Builds and validates the e-mail of the day's edition. No model.",
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

// The three steps of the generation, in order. The send is a workflow of its own (`operations.ts`),
// at 7h: the edition is ready long before it.
export const editionWorkflow = createWorkflow({
  id: "edition",
  description: "The day's generation: collect → write → build. Leave the input empty for today, in the profile's mode.",
  inputSchema: editionRequestSchema,
  outputSchema: editionRunSchema,
})
  .then(collectStep)
  .then(writeStep)
  .then(buildStep)
  .commit();
