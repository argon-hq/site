import { Effect } from "effect";
import { EditionRenderError } from "../errors";
import type { BuiltEdition, EditionInput } from "../types";
import { renderEditionHtml } from "./render";
import { renderText } from "./text";

// Deterministic: same input, same output. No network, no environment, no LLM. React Email renders
// asynchronously, so the builder is an Effect the caller runs at the edge of Nest.
export function buildEdition(input: EditionInput): Effect.Effect<BuiltEdition, EditionRenderError> {
  return Effect.tryPromise({
    try: () => renderEditionHtml(input),
    catch: (cause) => new EditionRenderError({ cause }),
  }).pipe(Effect.map((html) => ({ subject: input.subject, html, text: renderText(input) })));
}
