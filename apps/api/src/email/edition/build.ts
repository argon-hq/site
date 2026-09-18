import type { BuiltEdition, EditionInput } from "../types";
import { renderHtml } from "./html";
import { renderText } from "./text";

// Pure function: same input, same output. No network, no environment, no LLM.
export function buildEdition(input: EditionInput): BuiltEdition {
  return { subject: input.subject, html: renderHtml(input), text: renderText(input) };
}
