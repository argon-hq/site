import { InternalServerErrorException } from "@nestjs/common";
import { Effect, Exit } from "effect";
import { failureReason, failureStep } from "./reason";

type Failure = { reason: string; step?: string };

// The Nest boundary: every route runs its effect here. Typed failures become a 500 with the
// reason; defects keep the pretty cause. A failure that names its own step — a run says which step
// broke — answers with that one, not with the name of the route. Controllers stay free of Effect
// plumbing.
export async function runEffect<A, E extends Failure>(step: string, effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      throw new InternalServerErrorException({ step: failureStep(cause) ?? step, reason: failureReason(cause) });
    },
  });
}
