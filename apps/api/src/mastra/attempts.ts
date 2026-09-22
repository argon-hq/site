import { Effect } from "effect";

type Failure = { reason: string };

const REASON_CHARS = 400;

// Two attempts per generation, as the architecture decided: the second one carries the reason the
// first was rejected, so the agent corrects the answer instead of repeating it. A third costs more
// without a better result.
export const twoAttempts = <A, E extends Failure>(
  prompt: string,
  generate: (text: string) => Effect.Effect<A, E>,
  onRetry: (reason: string) => void,
): Effect.Effect<A, E> =>
  generate(prompt).pipe(
    Effect.catchAll((first) =>
      Effect.sync(() => onRetry(first.reason)).pipe(
        Effect.andThen(
          generate(
            `${prompt}\n\nA tentativa anterior foi rejeitada: ${first.reason.slice(0, REASON_CHARS)}. Corrija e responda de novo.`,
          ),
        ),
      ),
    ),
  );
