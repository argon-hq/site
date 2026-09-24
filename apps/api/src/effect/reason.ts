import { HttpStatus } from "@nestjs/common";
import { Cause } from "effect";
import type { Failure } from "./failure";

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

// The status a failure asks for, or 500: a typed failure with nothing to say about it, and every
// defect, is the server's problem.
export function failureStatus<E extends Failure>(cause: Cause.Cause<E>): HttpStatus {
  const failure = Cause.failureOption(cause);
  return failure._tag === "Some" ? (failure.value.status ?? HttpStatus.INTERNAL_SERVER_ERROR) : HttpStatus.INTERNAL_SERVER_ERROR;
}

// Whether the cause is a declared failure at all. A defect is logged whole and answered in one word.
export function isTypedFailure<E extends Failure>(cause: Cause.Cause<E>): boolean {
  return Cause.failureOption(cause)._tag === "Some";
}
