import { InternalServerErrorException } from "@nestjs/common";
import { Cause, Effect, Exit } from "effect";

type Failure = { reason: string };

// The Nest boundary: every route runs its effect here. Typed failures become a 500 with the
// reason; defects keep the pretty cause. Controllers stay free of Effect plumbing.
export async function runEffect<A, E extends Failure>(step: string, effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      const reason = failure._tag === "Some" ? failure.value.reason : Cause.pretty(cause);
      throw new InternalServerErrorException({ step, reason });
    },
  });
}
