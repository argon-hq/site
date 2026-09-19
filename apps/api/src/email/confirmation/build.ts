import { Effect } from "effect";
import { copy } from "../copy";
import { ConfirmationRenderError } from "../errors";
import type { BuiltEmail, ConfirmationInput } from "../types";
import { renderConfirmationHtml } from "./render";
import { renderText } from "./text";

// Deterministic: same input, same output. No network, no environment. React Email renders
// asynchronously, so the builder is an Effect the caller runs at the edge of Nest.
export function buildConfirmation(input: ConfirmationInput): Effect.Effect<BuiltEmail, ConfirmationRenderError> {
  return Effect.tryPromise({
    try: () => renderConfirmationHtml(input),
    catch: (cause) => new ConfirmationRenderError({ cause }),
  }).pipe(Effect.map((html) => ({ subject: copy.confirmation.subject, html, text: renderText(input) })));
}
