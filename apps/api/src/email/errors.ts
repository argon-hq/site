import { Data } from "effect";
import type { ValidationError } from "./types";

// Typed errors for the whole module. The caller matches on `_tag`; no `instanceof`, no thrown Error.

// The pipeline calls the builder only after the writer filled every field; this is a bug upstream.
export class EditionNotReadyError extends Data.TaggedError("EditionNotReadyError")<{
  readonly reason: string;
}> {}

// React Email failed to render. A template bug, never bad content.
export class EditionRenderError extends Data.TaggedError("EditionRenderError")<{
  readonly cause: unknown;
}> {}

// The rendered HTML could not be parsed back for validation. Also a template bug.
export class HtmlParseError extends Data.TaggedError("HtmlParseError")<{
  readonly cause: unknown;
}> {}

// The output broke at least one mechanical rule. Carries every error, not just the first.
export class EditionInvalidError extends Data.TaggedError("EditionInvalidError")<{
  readonly errors: readonly ValidationError[];
}> {}
