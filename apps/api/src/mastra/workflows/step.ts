import type { TracingContext } from "@mastra/core/observability";
import { createStep } from "@mastra/core/workflows";
import { Effect, Exit } from "effect";
import type { z } from "zod";
import { failureReason } from "../../effect/reason";
import { editionContext, type EditionRequestContext, type PipelinePort } from "./context";

// What a step is handed besides its input: the run it belongs to, and the span of the step, for the
// agent's calls to hang under in the trace instead of being traces of their own.
export type StepCall = { runId: string; tracingContext: TracingContext | undefined };

type StepSpec<I extends z.ZodType, O extends z.ZodType> = {
  id: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  retries: number;
  run: (pipeline: PipelinePort, input: z.infer<I>, call: StepCall) => Effect.Effect<z.infer<O>, { reason: string }>;
};

// One shape for every step: read the pipeline, run its effect, hand the result on. A step reports
// failure by throwing, which is also what makes Mastra try it again — the services speak Effect and
// never throw, so the conversion happens here, once.
//
// The alert to the owners lives here too, on the last attempt only: a run starts from the jobs
// route or from the Studio, and the step is the one place both pass through. The attempt count is
// what keeps a step that tried three times at one e-mail.
export const stepOf = <I extends z.ZodType, O extends z.ZodType>(spec: StepSpec<I, O>) =>
  createStep({
    id: spec.id,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    retries: spec.retries,
    execute: async ({ inputData, requestContext, runId, retryCount, tracingContext }) => {
      // Parsed again on the way in: what Mastra types the input as depends on its zod version.
      const input = spec.inputSchema.parse(inputData);
      const lastAttempt = (retryCount ?? 0) >= spec.retries;

      const exit = await Effect.runPromiseExit(
        editionContext(spec.id, requestContext as EditionRequestContext).pipe(
          Effect.flatMap(({ pipeline }) =>
            spec
              .run(pipeline, input, { runId, tracingContext })
              .pipe(Effect.tapError((error) => (lastAttempt ? pipeline.alert(spec.id, error.reason) : Effect.void))),
          ),
        ),
      );
      if (Exit.isFailure(exit)) throw new Error(failureReason(exit.cause));
      return exit.value;
    },
  });
