import type { RequestContext } from "@mastra/core/request-context";
import { Data, Effect } from "effect";
import type { BuildReport, CollectReport, StepRun, WriteReport } from "../../pipeline/pipeline.service";

// What the workflow needs from the application to run one edition. The port lives here, on the
// Mastra side, and the pipeline service implements it: the Mastra instance is built at import time,
// before Nest exists, so a step cannot be injected. It reads the service from the run context, the
// same deal the tools already have in `tools/context.ts`.
export type EditionSteps = {
  collect(run: StepRun): Effect.Effect<CollectReport, { reason: string }>;
  write(run: StepRun): Effect.Effect<WriteReport, { reason: string }>;
  build(run: StepRun): Effect.Effect<BuildReport, { reason: string }>;
};

export type EditionContext = { pipeline: EditionSteps };
export type EditionRequestContext = RequestContext<EditionContext>;

export class MissingRunContext extends Data.TaggedError("MissingRunContext")<{ step: string; reason: string }> {}

// A run that reaches a step without the context fails here, named, instead of later inside a call
// to nothing. It is what a run started from the Studio hits: the Studio is another process and
// carries no service.
export const editionContext = (
  step: string,
  requestContext: EditionRequestContext | undefined,
): Effect.Effect<EditionContext, MissingRunContext> => {
  const pipeline = requestContext?.get("pipeline");
  return pipeline
    ? Effect.succeed({ pipeline })
    : new MissingRunContext({ step, reason: `step ${step} ran with no pipeline in the run context` });
};
