import { Cause } from "effect";

type Failure = { reason: string; step?: string };

// What a failed effect has to say, in one string: the typed reason when the failure is one of ours,
// the pretty cause when the effect died of something it never declared. Both boundaries — the Nest
// route and the workflow step — report a failure through this, so they never disagree.
export function failureReason<E extends Failure>(cause: Cause.Cause<E>): string {
  const failure = Cause.failureOption(cause);
  return failure._tag === "Some" ? failure.value.reason : Cause.pretty(cause);
}

// The step a failure names, when it carries one. A failed run knows which of its steps broke, and
// the boundary says that instead of repeating the name of the route it came in by.
export function failureStep<E extends Failure>(cause: Cause.Cause<E>): string | undefined {
  const failure = Cause.failureOption(cause);
  return failure._tag === "Some" ? failure.value.step : undefined;
}
