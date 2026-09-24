import { createStep } from "@mastra/core/workflows";
import { Effect, Exit } from "effect";
import type { z } from "zod";
import { failureReason } from "../../effect/reason";
import { editionContext, type EditionRequestContext, type PipelinePort } from "./context";

type StepSpec<I extends z.ZodType, O extends z.ZodType> = {
  id: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  retries: number;
  // Whether the owners hear about this step giving up. The generation and the send say so; the
  // watch and the retention only log, as they did when Nest held the clock.
  alert: boolean;
  run: (pipeline: PipelinePort, input: z.infer<I>) => Effect.Effect<z.infer<O>, { reason: string }>;
};

// One shape for every step of every workflow: read the pipeline, run its effect, hand the result on.
// A step reports failure by throwing, which is also what makes Mastra try it again — the services
// speak Effect and never throw, so the conversion happens here, once.
//
// The alert lives here too, on the last attempt only: a run can start from the route, the Studio or
// the scheduler, and the scheduler runs on the evented engine, which never calls the workflow's
// `onError`. The step is the one place all three pass through, and the attempt count is what keeps
// a step that tried three times at one e-mail.
export const stepOf = <I extends z.ZodType, O extends z.ZodType>(spec: StepSpec<I, O>) =>
  createStep({
    id: spec.id,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    retries: spec.retries,
    execute: async ({ inputData, requestContext, retryCount }) => {
      // Parsed again on the way in: what Mastra types the input as depends on its zod version.
      const input = spec.inputSchema.parse(inputData);
      const lastAttempt = (retryCount ?? 0) >= spec.retries;

      const exit = await Effect.runPromiseExit(
        editionContext(spec.id, requestContext as EditionRequestContext).pipe(
          Effect.flatMap(({ pipeline }) =>
            spec
              .run(pipeline, input)
              .pipe(
                Effect.tapError((error) =>
                  spec.alert && lastAttempt ? pipeline.alert(spec.id, error.reason) : Effect.void,
                ),
              ),
          ),
        ),
      );
      if (Exit.isFailure(exit)) throw new Error(failureReason(exit.cause));
      return exit.value;
    },
  });
