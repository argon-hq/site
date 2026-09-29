import { HttpException, Logger } from "@nestjs/common";
import { Cause, Effect, Exit } from "effect";
import type { Failure } from "./failure";
import { failureReason, failureStatus, failureStep, isTypedFailure } from "./reason";

const logger = new Logger("runEffect");

// The Nest boundary: every route runs its effect here. Typed failures become the status they ask
// for, 500 by default, carrying the reason; a failure that names its own step — a run says which
// step broke — answers with that one, not with the name of the route. A defect is something the
// effect never declared: its whole cause goes to the log, where a stack trace belongs, and the
// caller gets one word for it. Controllers stay free of Effect plumbing.
export async function runEffect<A, E extends Failure>(step: string, effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      if (!isTypedFailure(cause)) {
        logger.error({ msg: "defect at the route", step, cause: Cause.pretty(cause) });
        throw new HttpException({ step, reason: "internal error" }, 500);
      }
      throw new HttpException({ step: failureStep(cause) ?? step, reason: failureReason(cause) }, failureStatus(cause));
    },
  });
}
